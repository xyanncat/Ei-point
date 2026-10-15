"""Music bot service: discord.py + yt-dlp + FFmpeg (§2, §3, §4, §5, §8).

Full playback engine, yt-dlp resolution, FFmpeg streaming,
queue advancement loop, seeking, autoplay, DJ/Master permissions,
search track picker UI, bounded concurrency (2 resolutions, 2 voice sessions),
periodic 15s PostgreSQL snapshot flush to music.queue_snapshots,
queue restoration, daemon HTTP health server on port 3105,
and status heartbeat into ops.service_status.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import threading
import time
import uuid
from media_cache import AudioCache
from http.server import BaseHTTPRequestHandler, HTTPServer

import discord
from discord import app_commands
from discord.ext import commands

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

try:
    from queue_state import QueueState, Track
except ImportError:
    from src.queue_state import QueueState, Track

try:
    from url_utils import is_safe_url
except ImportError:
    from src.url_utils import is_safe_url


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("bot-music")

BOT_TOKEN = os.environ.get("BOT_TOKEN") or os.environ.get("DISCORD_ROBIN_BOT_TOKEN") or os.environ.get("DISCORD_MUSIC_BOT_TOKEN")
BOT_KEY = os.environ.get("BOT_KEY") or "robin"
DATABASE_URL = os.environ.get("DATABASE_URL")
RAW_ALLOWLIST = (
    os.environ.get("GUILD_ALLOWLIST")
    or os.environ.get("COMMUNITY_GUILD_ALLOWLIST")
    or ",".join(filter(None, [os.environ.get("DISCORD_TEST_GUILD_ID"), os.environ.get("DISCORD_MAIN_GUILD_ID")]))
)
ALLOWED_GUILDS = set(x.strip() for x in RAW_ALLOWLIST.split(",") if x.strip())
HEALTH_PORT = int(os.environ.get("MUSIC_HEALTH_PORT") or 3105)
MAX_VOICE_SESSIONS = 2
VOICE_OWNER_PREFIX = f"music:{uuid.uuid4()}:"
MUSIC_CACHE = AudioCache(os.environ.get('CACHE_DIR', '/srv/music-cache'),
    max_bytes=int(os.environ.get('CACHE_MAX_BYTES', 10*1024**3)),
    max_item_bytes=int(os.environ.get('CACHE_ITEM_MAX_BYTES', 50*1024**2)),
    ttl_seconds=int(os.environ.get('CACHE_TTL_SECONDS', 7*86400)))

# In-memory guild queues: guild_id (str) -> QueueState
guild_queues: dict[str, QueueState] = {}
# Active playback tracking
track_started_at: dict[str, float] = {}  # guild_id -> float (start timestamp)
guild_autoplay: dict[str, bool] = {}    # guild_id -> bool
active_sessions: set[str] = set()       # guild_ids currently playing
playback_generations: dict[str, int] = {}  # guild_id -> current playback generation counter
playback_failure_count: dict[str, int] = {} # guild_id -> consecutive playback failure count
# PostgreSQL connection holder (psycopg if installed, else fallback)
db_conn = None
db_ready = False
db_lock = threading.Lock()
is_stopping = False
identity_verified = False


# Concurrency limits (§5): max 2 concurrent metadata resolutions
metadata_semaphore = asyncio.Semaphore(2)

FFMPEG_OPTIONS: dict[str, str] = {
    "before_options": "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5",
    "options": "-vn",
}


def get_or_create_queue(guild_id: str) -> QueueState:
    if guild_id not in guild_queues:
        guild_queues[guild_id] = QueueState()
    return guild_queues[guild_id]


# --- Database Persistence ---
def init_db():
    global db_conn, db_ready
    if not DATABASE_URL:
        log.warning("DATABASE_URL not set; running with in-memory persistence only.")
        return
    with db_lock:
        try:
            import psycopg

            if db_conn:
                try:
                    db_conn.close()
                except Exception:
                    pass
                db_conn = None

            db_conn = psycopg.connect(
                DATABASE_URL,
                autocommit=True,
                connect_timeout=5,
                options="-c statement_timeout=5000",
            )
            db_ready = True
            log.info("Connected to PostgreSQL for queue snapshots.")
        except Exception as exc:
            db_ready = False
            log.warning("PostgreSQL connection failed (%s); persistence will retry.", exc)


def build_queue_snapshots() -> list[tuple[str, dict]]:
    """Build immutable snapshots of all guild queues on the event loop thread."""
    now = time.time()
    snapshots: list[tuple[str, dict]] = []
    for guild_id, started in list(track_started_at.items()):
        q = guild_queues.get(guild_id)
        if q and q.tracks and q.position < len(q.tracks):
            elapsed = max(0.0, now - started)
            q.position_ms = int(elapsed * 1000)
    for guild_id, q in list(guild_queues.items()):
        snapshots.append((guild_id, q.snapshot()))
    return snapshots


def flush_snapshots_sync(snapshots: list[tuple[str, dict]] | None = None):
    """Flush queue snapshots to music.queue_snapshots inside the database lock."""
    global db_conn, db_ready
    if snapshots is None:
        snapshots = build_queue_snapshots()

    with db_lock:
        if not db_conn or not db_ready:
            return
        try:
            with db_conn.cursor() as cur:
                for guild_id, snap in snapshots:
                    cur.execute(
                        """
                        INSERT INTO music.queue_snapshots (guild_id, queue, position, position_ms, loop_mode, volume, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, now())
                        ON CONFLICT (guild_id) DO UPDATE SET
                          queue = EXCLUDED.queue,
                          position = EXCLUDED.position,
                          position_ms = EXCLUDED.position_ms,
                          loop_mode = EXCLUDED.loop_mode,
                          volume = EXCLUDED.volume,
                          updated_at = now()
                        """,
                        (
                            guild_id,
                            json.dumps(snap.get("queue", [])),
                            int(snap.get("position", 0)),
                            int(snap.get("position_ms", 0)),
                            str(snap.get("loop_mode", "off")),
                            int(snap.get("volume", 100)),
                        ),
                    )
        except Exception as exc:
            log.error("Failed to flush queue snapshots: %s", exc)
            db_ready = False


def update_service_status_sync(ping_ms: float):
    global db_conn, db_ready
    with db_lock:
        if not db_conn or not db_ready:
            return
        try:
            with db_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ops.service_status (service, liveness, gateway, db_ready, latency_ms, updated_at)
                    VALUES (%s, 'ok', 'ok', true, %s, now())
                    ON CONFLICT (service) DO UPDATE SET
                      liveness = 'ok',
                      gateway = 'ok',
                      db_ready = true,
                      latency_ms = EXCLUDED.latency_ms,
                      updated_at = now()
                    """,
                    (f'bot-{BOT_KEY}', max(0, round(ping_ms))),
                )
        except Exception as exc:
            log.debug("Failed to record service status: %s", exc)


def restore_guild_queue(guild_id: str) -> QueueState:
    global db_conn, db_ready
    with db_lock:
        if not db_conn or not db_ready:
            return get_or_create_queue(guild_id)
        try:
            with db_conn.cursor() as cur:
                cur.execute(
                    "SELECT queue, position, position_ms, loop_mode, volume FROM music.queue_snapshots WHERE guild_id = %s",
                    (guild_id,),
                )
                row = cur.fetchone()
                if row:
                    queue_data, position, pos_ms, loop_mode, volume = row
                    if isinstance(queue_data, str):
                        queue_data = json.loads(queue_data)
                    q = QueueState.restore({
                        "queue": queue_data,
                        "position": position,
                        "position_ms": pos_ms,
                        "loop_mode": loop_mode,
                        "volume": volume,
                    })
                    guild_queues[guild_id] = q
                    log.info("Restored queue for guild %s with %d tracks.", guild_id, len(q.tracks))
                    return q
        except Exception as exc:
            log.warning("Could not restore snapshot for guild %s: %s", guild_id, exc)
    return get_or_create_queue(guild_id)


async def check_dj_permission(interaction: discord.Interaction) -> bool:
    """Enforce DJ/Master permission requirements from music.permissions (§2)."""
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        return False
    member: discord.Member = interaction.user
    if member.guild_permissions.manage_guild or member.guild_permissions.administrator or member.id == interaction.guild.owner_id:
        return True

    # Interaction might time out during DB I/O, so defer before running database check
    if not interaction.response.is_done():
        await interaction.response.defer(ephemeral=True)

    guild_id = str(interaction.guild_id)

    def _query():
        with db_lock:
            if not db_conn or not db_ready:
                return None
            with db_conn.cursor() as cur:
                cur.execute("SELECT role_id FROM music.permissions WHERE guild_id = %s", (guild_id,))
                return cur.fetchall()

    try:
        rows = await asyncio.to_thread(_query)
        if rows is None:
            log.warning("Database unavailable during DJ permission check; failing closed for non-manager.")
            return False
        if not rows:
            return True
        dj_role_ids = {str(r[0]) for r in rows}
        user_role_ids = {str(r.id) for r in member.roles}
        return bool(dj_role_ids.intersection(user_role_ids))
    except Exception as exc:
        log.error("DJ permission check error: %s; failing closed for non-manager.", exc)
        return False


# --- yt-dlp Audio Resolution (§5: max 2 concurrent) ---
async def extract_tracks(query: str, max_results: int = 1) -> list[dict]:
    """Resolve track metadata and direct streaming URLs via yt-dlp."""
    if not yt_dlp:
        log.warning("yt_dlp is not installed; audio extraction unavailable.")
        return []

    # Streaming only: no downloaded media cache is claimed or populated.
    if query.startswith(("http://", "https://")) and not is_safe_url(query):
        return []
    target = query if query.startswith(("http://", "https://")) else f"ytsearch{min(5,max_results)}:{query}"
    try:
        async with asyncio.timeout(30):
            async with metadata_semaphore:
                process = await asyncio.create_subprocess_exec(
                    sys.executable, "-m", "yt_dlp", "--dump-single-json", "--skip-download",
                    "--no-playlist", "--socket-timeout", "10", "--retries", "1",
                    "--extractor-retries", "1", "--format", "bestaudio/best", "--", target,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                )
                try:
                    output, _ = await asyncio.wait_for(process.communicate(), timeout=30)
                    if process.returncode != 0 or len(output) > 4_000_000:
                        return []
                    data = json.loads(output)
                    return [e for e in data.get("entries", [data]) if e][:max_results]
                except (asyncio.TimeoutError, ValueError):
                    return []
                finally:
                    if process.returncode is None:
                        process.kill()
                        await process.wait()
    except asyncio.TimeoutError:
        return []


# --- Playback Engine ---
async def download_media(url, destination):
    """A bounded subprocess; no worker survives timeout or cancellation."""
    code = '''import sys,yt_dlp
limit=int(sys.argv[3])
def progress(event):
 if event.get("downloaded_bytes",0)>limit: raise yt_dlp.utils.DownloadError("cache item limit")
with yt_dlp.YoutubeDL({"format":"bestaudio/best","outtmpl":sys.argv[2],"noplaylist":True,"quiet":True,"no_warnings":True,"nopart":True,"max_filesize":limit,"progress_hooks":[progress],"cachedir":False}) as ydl:
 ydl.download([sys.argv[1]])
'''
    process = await asyncio.create_subprocess_exec(sys.executable, '-c', code, url, str(destination), str(MUSIC_CACHE.max_item_bytes), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=os.name != 'nt')
    try:
        await asyncio.wait_for(process.wait(), 30)
        if process.returncode != 0: raise ValueError('Audio download failed')
    finally:
        if process.returncode is None:
            if os.name != 'nt': os.killpg(process.pid, signal.SIGKILL)
            else: process.kill()
            await process.wait()

def play_track(guild_id: str, start_sec: int = 0):
    """Play the current track in guild voice client via FFmpeg with volume control."""
    q = guild_queues.get(guild_id)
    if not q or not q.tracks or q.position >= len(q.tracks):
        active_sessions.discard(guild_id)
        track_started_at.pop(guild_id, None)
        return

    current_gen = playback_generations.get(guild_id, 0) + 1
    playback_generations[guild_id] = current_gen

    guild = bot.get_guild(int(guild_id))
    if not guild or not guild.voice_client:
        active_sessions.discard(guild_id)
        track_started_at.pop(guild_id, None)
        return

    vc: discord.VoiceClient = guild.voice_client
    if vc.is_playing() or vc.is_paused():
        vc.stop()

    def _fail_and_advance():
        active_sessions.discard(guild_id)
        track_started_at.pop(guild_id, None)
        fails = playback_failure_count.get(guild_id, 0) + 1
        playback_failure_count[guild_id] = fails
        if fails >= max(1, len(q.tracks)):
            log.warning("Repeated playback failures exceeded queue length (%d) in guild %s; stopping.", fails, guild_id)
            playback_failure_count[guild_id] = 0
            q.position_ms = 0
            return
        force_next = (q.loop_mode == "track")
        asyncio.run_coroutine_threadsafe(handle_track_finished(guild_id, force_next=force_next), bot.loop)

    current_track = q.tracks[q.position]
    stream_url = current_track.url or current_track.webpage_url

    if not stream_url:
        log.warning("No playable stream URL for track %s", current_track.track_id)
        _fail_and_advance()
        return

    if stream_url.startswith(("http://", "https://")) and not is_safe_url(stream_url):
        log.warning("Blocked playback of unsafe stream URL: %s", stream_url)
        _fail_and_advance()
        return

    cached = MUSIC_CACHE.managed_path(stream_url)
    if not cached and not stream_url.startswith(('http://', 'https://')):
        _fail_and_advance()
        return
    before_opts = '-nostdin' if cached else FFMPEG_OPTIONS["before_options"]
    if start_sec > 0:
        before_opts = f"-ss {start_sec} " + before_opts
        q.position_ms = start_sec * 1000
    else:
        q.position_ms = 0

    try:
        source = discord.FFmpegPCMAudio(stream_url, before_options=before_opts, options=FFMPEG_OPTIONS["options"])
        transformed = discord.PCMVolumeTransformer(source, volume=max(0.0, min(1.5, q.volume / 100.0)))
    except Exception as exc:
        log.warning("FFmpeg source instantiation error: %s", exc)
        _fail_and_advance()
        return

    if not transformed or not vc.is_connected():
        _fail_and_advance()
        return

    def after_playback(error):
        if cached: MUSIC_CACHE.unpin(stream_url)
        if playback_generations.get(guild_id) != current_gen:
            log.debug("Stale playback callback for guild %s (gen %d vs %s); skipping.", guild_id, current_gen, playback_generations.get(guild_id))
            return

        started = track_started_at.get(guild_id)
        elapsed = (time.time() - (started or time.time())) if started else 0.0

        if error:
            log.error("Playback error in guild %s after %.1fs: %s", guild_id, elapsed, error)

        # Count errors or playback lasting under 2 seconds as failures
        if error or elapsed < 2.0:
            log.warning("Playback ended prematurely (%.1fs) in guild %s; routing through failure handler.", elapsed, guild_id)
            _fail_and_advance()
            return

        playback_failure_count[guild_id] = 0

        def _on_done(f):
            try:
                f.result()
            except Exception as e:
                log.error("Error in handle_track_finished callback for %s: %s", guild_id, e)

        fut = asyncio.run_coroutine_threadsafe(handle_track_finished(guild_id), bot.loop)
        fut.add_done_callback(_on_done)

    try:
        if cached: MUSIC_CACHE.pin(stream_url)
        vc.play(transformed, after=after_playback)
        track_started_at[guild_id] = time.time() - start_sec
        active_sessions.add(guild_id)
    except Exception as exc:
        if cached: MUSIC_CACHE.unpin(stream_url)
        log.warning("VoiceClient.play failed: %s; scheduling next track.", exc)
        _fail_and_advance()


async def start_playback(guild_id: str, start_sec: int = 0):
    """Ensure track stream URL is resolved before handing off to play_track."""
    q = guild_queues.get(guild_id)
    if not q or not q.tracks or q.position >= len(q.tracks):
        active_sessions.discard(guild_id)
        track_started_at.pop(guild_id, None)
        return

    current_track = q.tracks[q.position]
    cache_key = current_track.webpage_url or current_track.track_id
    cached = MUSIC_CACHE.lookup(cache_key)
    if cached:
        current_track.url = cached
        play_track(guild_id, start_sec=start_sec)
        return
    if current_track.webpage_url:
        resolved = await extract_tracks(current_track.webpage_url, max_results=1)
        if resolved:
            current_track.url = resolved[0].get("url", "")
            if not current_track.title and resolved[0].get("title"):
                current_track.title = resolved[0].get("title", "")
    elif not current_track.url and current_track.title:
        resolved = await extract_tracks(current_track.title, max_results=1)
        if resolved:
            current_track.url = resolved[0].get("url", "")
            if not current_track.title and resolved[0].get("title"):
                current_track.title = resolved[0].get("title", "")

    download_url = current_track.webpage_url or current_track.url
    if download_url and is_safe_url(download_url):
        try:
            current_track.url = await MUSIC_CACHE.fetch(cache_key, lambda path: download_media(download_url, path))
        except (OSError, ValueError, asyncio.TimeoutError):
            log.info('Optional audio cache unavailable; using the resolved stream')
    play_track(guild_id, start_sec=start_sec)


async def handle_track_finished(guild_id: str, force_next: bool = False):
    """Advance queue upon track completion honoring loop_mode and autoplay (§2, §8)."""
    if not await asyncio.to_thread(guild_runtime_allowed_sync, guild_id):
        return
    q = guild_queues.get(guild_id)
    if not q:
        active_sessions.discard(guild_id)
        track_started_at.pop(guild_id, None)
        return

    if force_next:
        if q.position + 1 < len(q.tracks):
            q.position += 1
            q.position_ms = 0
            next_track = q.tracks[q.position]
        elif q.loop_mode == "queue":
            q.position = 0
            q.position_ms = 0
            next_track = q.tracks[0] if q.tracks else None
        else:
            next_track = None
    else:
        next_track = q.advance()

    if next_track:
        await start_playback(guild_id)
    else:
        # Check autoplay if queue drained
        if guild_autoplay.get(guild_id, False) and q.tracks:
            last_track = q.tracks[-1]
            recs = await extract_tracks(f"recommendation after {last_track.title}", max_results=1)
            if recs:
                rec_info = recs[0]
                new_track = Track(
                    track_id=f"auto-{rec_info.get('id', 'r1')}",
                    title=rec_info.get("title", "Autoplay Track"),
                    duration_ms=int(rec_info.get("duration", 180) or 180) * 1000,
                    url=rec_info.get("url", ""),
                    webpage_url=rec_info.get("webpage_url", ""),
                )
                q.add(new_track)
                q.advance()
                await start_playback(guild_id)
                return
        track_started_at.pop(guild_id, None)
        active_sessions.discard(guild_id)
        q.position_ms = 0


# --- HTTP Health Server ---
class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health/live":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"service":"bot-music","status":"alive"}')
        elif self.path == "/health/ready":
            db_ok = db_ready and bool(DATABASE_URL)
            is_ready = identity_verified and bot.is_ready() and not bot.is_closed() and db_ok and not is_stopping
            status = 200 if is_ready else 503
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            payload = f'{{"service":"bot-music","status":"{"ready" if is_ready else "degraded"}"}}'.encode()
            self.wfile.write(payload)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress normal health check access logs


def run_health_server():
    server = HTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    server.serve_forever()


# --- UI Select Component: Search Track Picker (§2, Matrix #54) ---
class SearchPickerSelect(discord.ui.Select):
    def __init__(self, tracks: list[dict], guild_id: str, member: discord.Member):
        options = []
        for idx, t in enumerate(tracks[:5]):
            raw_title = t.get("title")
            title = (raw_title if isinstance(raw_title, str) and raw_title.strip() else f"Track {idx + 1}")[:95]
            duration_s = int(t.get("duration", 0) or 0)
            mins, secs = divmod(duration_s, 60)
            raw_uploader = t.get("uploader")
            uploader = (raw_uploader if isinstance(raw_uploader, str) and raw_uploader.strip() else "Unknown")[:40]
            desc = f"{mins}:{secs:02d} | {uploader}"
            options.append(discord.SelectOption(label=f"{idx + 1}. {title}", value=str(idx), description=desc))
        super().__init__(placeholder="Select a track to play...", min_values=1, max_values=1, options=options)
        self.tracks = tracks
        self.guild_id = guild_id
        self.member = member

    async def callback(self, interaction: discord.Interaction):
        if interaction.user.id != self.member.id:
            await interaction.response.send_message("❌ Only the person who searched can pick a track.", ephemeral=True)
            return

        await interaction.response.defer()

        vc = await ensure_voice_connection(interaction, self.member)
        if not vc:
            return

        idx = int(self.values[0])
        chosen = self.tracks[idx]
        q = get_or_create_queue(self.guild_id)
        track = Track(
            track_id=f"t-{len(q.tracks) + 1}-{abs(hash(chosen.get('title', ''))) % 10000}",
            title=chosen.get("title", "Selected Song")[:100],
            duration_ms=int(chosen.get("duration", 180) or 180) * 1000,
            url=chosen.get("url", ""),
            webpage_url=chosen.get("webpage_url", ""),
        )
        pos = q.add(track)

        if not vc.is_playing() and not vc.is_paused():
            await start_playback(self.guild_id)

        await interaction.edit_original_response(
            content=f"🎵 **Added to queue** (#{pos}): `{track.title}`",
            view=None,
        )


class SearchPickerView(discord.ui.View):
    def __init__(self, tracks: list[dict], guild_id: str, member: discord.Member):
        super().__init__(timeout=60.0)
        self.add_item(SearchPickerSelect(tracks, guild_id, member))


# --- Discord Bot Client ---
intents = discord.Intents.default()
intents.guilds = True
intents.voice_states = True

bot = commands.Bot(command_prefix="!", intents=intents)


def guild_runtime_allowed_sync(guild_id: str) -> bool:
    with db_lock:
        if not db_conn or not db_ready:
            return False
        with db_conn.cursor() as cur:
            cur.execute("""SELECT g.approved AND NOT COALESCE(c.server_paused,false)
                AND COALESCE(s.enabled,true) AND NOT COALESCE(s.paused,false)
                AND b.application_id=%s
                FROM access.guilds g JOIN config.bots b ON b.bot_key=%s AND g.guild_id=ANY(b.guild_ids)
                LEFT JOIN config.guild_controls c ON c.guild_id=g.guild_id
                LEFT JOIN config.bot_states s ON s.guild_id=g.guild_id AND s.bot_key=b.bot_key
                WHERE g.guild_id=%s""", (str(bot.user.id), BOT_KEY, guild_id))
            row = cur.fetchone()
            return bool(row and row[0])


def reserve_voice_sync(guild_id: str) -> bool:
    with db_lock:
        if not db_conn or not db_ready:
            return False
        with db_conn.transaction():
            with db_conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(810208)")
                cur.execute("DELETE FROM ai.voice_leases WHERE expires_at<=now()")
                cur.execute("SELECT count(*) FROM ai.voice_leases WHERE owner<>%s", (VOICE_OWNER_PREFIX+guild_id,))
                if cur.fetchone()[0] >= 2:
                    return False
                cur.execute("INSERT INTO ai.voice_leases VALUES(%s,now()+interval '60 seconds') ON CONFLICT(owner) DO UPDATE SET expires_at=EXCLUDED.expires_at", (VOICE_OWNER_PREFIX+guild_id,))
                return True


async def runtime_allowed(interaction: discord.Interaction) -> bool:
    if str(interaction.guild_id) not in ALLOWED_GUILDS or not isinstance(interaction.user, discord.Member):
        return False
    def query():
        with db_lock:
            if not db_conn or not db_ready:
                return False
            with db_conn.cursor() as cur:
                cur.execute("""SELECT g.approved, COALESCE(c.server_paused,false),
                  COALESCE(s.enabled,true), COALESCE(s.paused,false), p.enabled, p.role_ids,
                  b.application_id
                  FROM access.guilds g JOIN config.bots b ON b.bot_key=%s AND g.guild_id=ANY(b.guild_ids)
                  LEFT JOIN config.guild_controls c ON c.guild_id=g.guild_id
                  LEFT JOIN config.bot_states s ON s.guild_id=g.guild_id AND s.bot_key=b.bot_key
                  LEFT JOIN config.command_permissions p ON p.guild_id=g.guild_id AND p.bot_key=b.bot_key AND p.command=%s
                  WHERE g.guild_id=%s""", (BOT_KEY, interaction.command.name if interaction.command else "play", str(interaction.guild_id)))
                row = cur.fetchone()
                return bool(row and row[0] and not row[1] and row[2] and not row[3] and row[4] is not False
                    and (not row[5] or set(row[5]).intersection(str(r.id) for r in interaction.user.roles))
                    and str(row[6]) == str(bot.user.id))
    try:
        return await asyncio.to_thread(query)
    except Exception:
        return False


async def global_interaction_check(interaction: discord.Interaction) -> bool:
    if await runtime_allowed(interaction):
        return True
    await respond(interaction, "This bot, server, or command is disabled for your roles.", ephemeral=True)
    return False


bot.tree.interaction_check = global_interaction_check


async def ensure_voice_connection(interaction: discord.Interaction, member: discord.Member) -> discord.VoiceClient | None:
    """Connect to or relocate to member voice channel while enforcing MAX_VOICE_SESSIONS."""
    if not member.voice or not member.voice.channel:
        msg = "❌ You must be connected to a voice channel to play music."
        if interaction.response.is_done():
            await interaction.followup.send(msg)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
        return None

    if not await runtime_allowed(interaction):
        await respond(interaction, "Music is disabled for this server or your roles.", ephemeral=True)
        return None
    voice_channel = member.voice.channel
    voice_client: discord.VoiceClient | None = interaction.guild.voice_client if interaction.guild else None

    # Enforce voice session budget (§5: max 2 simultaneous sessions across bot voice clients)
    if not voice_client and len(bot.voice_clients) >= MAX_VOICE_SESSIONS:
        msg = "❌ Voice capacity limit reached (max 2 simultaneous server sessions on VPS envelope). Please try again later."
        if interaction.response.is_done():
            await interaction.followup.send(msg)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
        return None

    if not voice_client:
        if not await asyncio.to_thread(reserve_voice_sync, str(interaction.guild_id)):
            await respond(interaction, "Fleet voice capacity is full or unavailable.", ephemeral=True)
            return None
        try:
            voice_client = await voice_channel.connect(timeout=10.0, reconnect=True)
        except Exception as exc:
            log.error("Failed to connect to voice channel: %s", exc)
            msg = "❌ Failed to connect to voice channel. Please check bot permissions and try again."
            if interaction.response.is_done():
                await interaction.followup.send(msg)
            else:
                await interaction.response.send_message(msg, ephemeral=True)
            return None
    elif voice_client.channel != voice_channel:
        await voice_client.move_to(voice_channel)

    return voice_client


@bot.event
async def on_ready():
    global identity_verified
    def verify_identity():
        with db_lock:
            if not db_conn or not db_ready:
                return False
            with db_conn.cursor() as cur:
                cur.execute("SELECT application_id FROM config.bots WHERE bot_key=%s", (BOT_KEY,))
                row = cur.fetchone()
                return bool(row and str(row[0]) == str(bot.user.id))
    identity_verified = await asyncio.to_thread(verify_identity)
    if not identity_verified:
        log.error("Registered bot application identity is not approved")
        return
    log.info("Music bot logged in as %s (ID: %s)", bot.user, bot.user.id)
    for guild in bot.guilds:
        if ALLOWED_GUILDS and str(guild.id) not in ALLOWED_GUILDS:
            log.warning("Leaving unapproved guild: %s (%s)", guild.name, guild.id)
            await guild.leave()
            continue
        if str(guild.id) not in guild_queues:
            await asyncio.to_thread(restore_guild_queue, str(guild.id))

    try:
        synced = await bot.tree.sync()
        log.info("Synced %d slash commands globally.", len(synced))
    except Exception as exc:
        log.error("Failed to sync slash commands: %s", exc)


@bot.event
async def on_guild_join(guild: discord.Guild):
    if ALLOWED_GUILDS and str(guild.id) not in ALLOWED_GUILDS:
        log.warning("Auto-leaving unapproved newly joined guild: %s (%s)", guild.name, guild.id)
        await guild.leave()
        return
    if str(guild.id) not in guild_queues:
        await asyncio.to_thread(restore_guild_queue, str(guild.id))


async def respond(interaction: discord.Interaction, message: str, ephemeral: bool = False, **kwargs):
    """Safely respond to an interaction whether deferred or not."""
    if interaction.response.is_done():
        return await interaction.followup.send(message, ephemeral=ephemeral, **kwargs)
    return await interaction.response.send_message(message, ephemeral=ephemeral, **kwargs)


# --- Music Slash Commands (§2, §8, Feature Matrix #46–54) ---
@bot.tree.command(name="play", description="Play or enqueue a song from a URL or search query")
@app_commands.describe(query="Song title, artist, or streaming URL")
async def cmd_play(interaction: discord.Interaction, query: str):
    guild_id = str(interaction.guild_id)
    if ALLOWED_GUILDS and guild_id not in ALLOWED_GUILDS:
        await interaction.response.send_message("❌ This server is not approved for Ei Point.", ephemeral=True)
        return

    await interaction.response.defer()

    member = interaction.user
    if not isinstance(member, discord.Member):
        await interaction.followup.send("❌ Could not verify member.")
        return

    voice_client = await ensure_voice_connection(interaction, member)
    if not voice_client:
        return

    # Extract metadata using yt-dlp
    tracks_info = await extract_tracks(query, max_results=1)
    if not tracks_info:
        await interaction.followup.send("❌ Could not resolve audio for that query. Please try another search.")
        return

    info = tracks_info[0]
    q = get_or_create_queue(guild_id)
    track_id = f"t-{len(q.tracks) + 1}-{abs(hash(query)) % 10000}"
    track = Track(
        track_id=track_id,
        title=info.get("title", query[:80]),
        duration_ms=int(info.get("duration", 180) or 180) * 1000,
        url=info.get("url", ""),
        webpage_url=info.get("webpage_url", query),
    )
    pos = q.add(track)

    # If voice client is idle, immediately start playback
    if not voice_client.is_playing() and not voice_client.is_paused():
        await start_playback(guild_id)

    await interaction.followup.send(f"🎵 **Added to queue** (#{pos}): `{track.title}`")


@bot.tree.command(name="search", description="Search tracks and pick from a 5-item menu (Matrix #54)")
@app_commands.describe(query="Search keywords")
async def cmd_search(interaction: discord.Interaction, query: str):
    guild_id = str(interaction.guild_id)
    if ALLOWED_GUILDS and guild_id not in ALLOWED_GUILDS:
        await interaction.response.send_message("❌ This server is not approved for Ei Point.", ephemeral=True)
        return

    await interaction.response.defer()

    member = interaction.user
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        await interaction.followup.send("❌ You must be connected to a voice channel to search music.")
        return

    tracks = await extract_tracks(query, max_results=5)
    if not tracks:
        await interaction.followup.send("❌ No search results found for that query.")
        return

    view = SearchPickerView(tracks, guild_id, member)
    await interaction.followup.send(f"🔍 **Search Results for:** `{query}` (expires in 60s)", view=view)


@bot.tree.command(name="pause", description="Pause current playback")
async def cmd_pause(interaction: discord.Interaction):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to pause music.", ephemeral=True)
        return

    vc = interaction.guild.voice_client if interaction.guild else None
    if vc and vc.is_playing():
        build_queue_snapshots()
        track_started_at.pop(str(interaction.guild_id), None)
        vc.pause()
        await respond(interaction, "⏸️ Playback paused.")
    else:
        await respond(interaction, "❌ Nothing is currently playing.", ephemeral=True)


@bot.tree.command(name="resume", description="Resume paused playback")
async def cmd_resume(interaction: discord.Interaction):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to resume music.", ephemeral=True)
        return

    vc = interaction.guild.voice_client if interaction.guild else None
    if vc and vc.is_paused():
        q = get_or_create_queue(str(interaction.guild_id))
        track_started_at[str(interaction.guild_id)] = time.time() - q.position_ms / 1000
        vc.resume()
        await respond(interaction, "▶️ Playback resumed.")
    else:
        await respond(interaction, "❌ Playback is not paused.", ephemeral=True)


@bot.tree.command(name="skip", description="Skip the current track")
async def cmd_skip(interaction: discord.Interaction):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to skip tracks.", ephemeral=True)
        return

    if not interaction.response.is_done():
        await interaction.response.defer()

    guild_id = str(interaction.guild_id)
    playback_failure_count[guild_id] = 0
    q = get_or_create_queue(guild_id)
    # /skip must always advance even in track-loop mode (same force_next
    # logic as handle_track_finished, which repeats the current track).
    if q.position + 1 < len(q.tracks):
        q.position += 1
        q.position_ms = 0
        next_track = q.tracks[q.position]
    elif q.loop_mode == "queue" and q.tracks:
        q.position = 0
        q.position_ms = 0
        next_track = q.tracks[0]
    else:
        q.position_ms = 0
        next_track = None

    vc = interaction.guild.voice_client if interaction.guild else None
    if vc and (vc.is_playing() or vc.is_paused()):
        playback_generations[guild_id] = playback_generations.get(guild_id, 0) + 1
        vc.stop()

    if next_track:
        await start_playback(guild_id)
        await interaction.followup.send(f"⏭️ Skipped to: `{next_track.title}`")
    else:
        active_sessions.discard(guild_id)
        await interaction.followup.send("⏭️ Skipped. Queue is now empty.")


@bot.tree.command(name="stop", description="Stop music and clear the queue")
async def cmd_stop(interaction: discord.Interaction):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to stop music.", ephemeral=True)
        return

    guild_id = str(interaction.guild_id)
    playback_generations[guild_id] = playback_generations.get(guild_id, 0) + 1
    playback_failure_count[guild_id] = 0
    q = get_or_create_queue(guild_id)
    q.tracks.clear()
    q.position = 0
    q.position_ms = 0
    active_sessions.discard(guild_id)
    track_started_at.pop(guild_id, None)

    vc = interaction.guild.voice_client if interaction.guild else None
    if vc:
        if vc.is_playing() or vc.is_paused():
            vc.stop()
        await vc.disconnect()
    await respond(interaction, "⏹️ Stopped playback and cleared queue.")


@bot.tree.command(name="seek", description="Seek to a timestamp (in seconds) in the current track (§2, Matrix #51)")
@app_commands.describe(seconds="Timestamp in seconds to jump to")
async def cmd_seek(interaction: discord.Interaction, seconds: int):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to seek playback.", ephemeral=True)
        return

    guild_id = str(interaction.guild_id)
    q = get_or_create_queue(guild_id)
    if not q.tracks or q.position >= len(q.tracks):
        await respond(interaction, "❌ Nothing is currently playing to seek in.", ephemeral=True)
        return

    curr = q.tracks[q.position]
    max_sec = curr.duration_ms // 1000
    if seconds < 0 or (max_sec > 0 and seconds > max_sec):
        await respond(interaction, f"❌ Timestamp must be between 0 and {max_sec}s.", ephemeral=True)
        return

    if not interaction.response.is_done():
        await interaction.response.defer()
    await start_playback(guild_id, start_sec=seconds)
    mins, secs = divmod(seconds, 60)
    await interaction.followup.send(f"⏩ Seeked to `{mins}:{secs:02d}`.")


@bot.tree.command(name="autoplay", description="Toggle autoplay recommendations when queue drains (§2, Matrix #52)")
@app_commands.describe(enabled="Enable or disable autoplay mode")
async def cmd_autoplay(interaction: discord.Interaction, enabled: bool):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to configure autoplay.", ephemeral=True)
        return

    guild_id = str(interaction.guild_id)
    guild_autoplay[guild_id] = enabled
    state_str = "enabled" if enabled else "disabled"
    await respond(interaction, f"📻 Autoplay mode has been **{state_str}**.")


@bot.tree.command(name="queue", description="Display upcoming tracks in the queue")
async def cmd_queue(interaction: discord.Interaction):
    guild_id = str(interaction.guild_id)
    q = get_or_create_queue(guild_id)
    if not q.tracks:
        await interaction.response.send_message("📭 The music queue is currently empty.")
        return

    lines = []
    for idx, t in enumerate(q.tracks[:15]):
        current_indicator = " ▶️" if idx == q.position else ""
        mins, secs = divmod(t.duration_ms // 1000, 60)
        lines.append(f"`{idx + 1}.` {t.title} ({mins}:{secs:02d}){current_indicator}")

    more = f"\n*...and {len(q.tracks) - 15} more*" if len(q.tracks) > 15 else ""
    ap = "on" if guild_autoplay.get(guild_id, False) else "off"
    status = f"\n\n**Loop**: `{q.loop_mode}` | **Volume**: `{q.volume}%` | **Autoplay**: `{ap}`"
    await interaction.response.send_message(f"📜 **Music Queue ({len(q.tracks)} tracks):**\n" + "\n".join(lines) + more + status)


@bot.tree.command(name="nowplaying", description="Show details about the currently playing song")
async def cmd_nowplaying(interaction: discord.Interaction):
    guild_id = str(interaction.guild_id)
    q = get_or_create_queue(guild_id)
    if not q.tracks or q.position >= len(q.tracks):
        await interaction.response.send_message("❌ Nothing is currently playing.", ephemeral=True)
        return

    curr = q.tracks[q.position]
    now = time.time()
    started = track_started_at.get(guild_id, now)
    elapsed_sec = int(max(0, now - started)) if guild_id in track_started_at else q.position_ms // 1000
    total_sec = max(1, curr.duration_ms // 1000)

    # Visual progress bar
    progress = min(1.0, elapsed_sec / total_sec)
    bar_len = 12
    filled = int(progress * bar_len)
    bar = "🔘" + "▬" * (bar_len - 1) if filled == 0 else "▬" * filled + "🔘" + "▬" * max(0, bar_len - filled - 1)

    mins, secs = divmod(total_sec, 60)
    pos_mins, pos_secs = divmod(elapsed_sec, 60)
    await interaction.response.send_message(
        f"🎧 **Now Playing:** `{curr.title}`\n"
        f"`[{bar}]` `{pos_mins}:{pos_secs:02d}` / `{mins}:{secs:02d}`\n"
        f"🔄 Loop: `{q.loop_mode}` | 🔊 Volume: `{q.volume}%`"
    )


@bot.tree.command(name="shuffle", description="Shuffle tracks in the queue")
async def cmd_shuffle(interaction: discord.Interaction):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to shuffle the queue.", ephemeral=True)
        return

    guild_id = str(interaction.guild_id)
    q = get_or_create_queue(guild_id)
    if len(q.tracks) <= 1:
        await respond(interaction, "❌ Not enough tracks in queue to shuffle.", ephemeral=True)
        return

    q.shuffle()
    await respond(interaction, "🔀 Queue shuffled (current song preserved).")


@bot.tree.command(name="loop", description="Toggle loop mode between off, track, and queue")
@app_commands.choices(
    mode=[
        app_commands.Choice(name="Off", value="off"),
        app_commands.Choice(name="Track", value="track"),
        app_commands.Choice(name="Queue", value="queue"),
    ]
)
async def cmd_loop(interaction: discord.Interaction, mode: app_commands.Choice[str]):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to set loop mode.", ephemeral=True)
        return

    guild_id = str(interaction.guild_id)
    q = get_or_create_queue(guild_id)
    q.loop_mode = mode.value
    await respond(interaction, f"🔁 Loop mode set to: `{mode.name}`")


@bot.tree.command(name="volume", description="Set playback volume (0 - 150%)")
@app_commands.describe(percent="Volume percentage (0 - 150)")
async def cmd_volume(interaction: discord.Interaction, percent: int):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to change volume.", ephemeral=True)
        return

    if percent < 0 or percent > 150:
        await respond(interaction, "❌ Volume must be between 0% and 150%.", ephemeral=True)
        return

    guild_id = str(interaction.guild_id)
    q = get_or_create_queue(guild_id)
    q.volume = percent

    # Dynamically scale active VoiceClient source volume if playing
    vc = interaction.guild.voice_client if interaction.guild else None
    if vc and hasattr(vc, "source") and isinstance(vc.source, discord.PCMVolumeTransformer):
        vc.source.volume = percent / 100.0

    await respond(interaction, f"🔊 Volume set to **{percent}%**.")


@bot.tree.command(name="claimmaster", description="Assign or claim DJ/Master role for controlling playback (§2, Matrix #53)")
@app_commands.describe(role="Target role to delegate playback control to", scope="Permission scope (dj or master)")
@app_commands.choices(
    scope=[
        app_commands.Choice(name="DJ", value="dj"),
        app_commands.Choice(name="Master", value="master"),
    ]
)
async def cmd_claimmaster(interaction: discord.Interaction, role: discord.Role, scope: app_commands.Choice[str]):
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        return
    member: discord.Member = interaction.user
    if not (member.guild_permissions.manage_guild or member.guild_permissions.administrator or member.id == interaction.guild.owner_id):
        await respond(interaction, "❌ Only server managers or owners can assign DJ/Master roles.", ephemeral=True)
        return

    if not interaction.response.is_done():
        await interaction.response.defer(ephemeral=True)

    guild_id = str(interaction.guild_id)
    def _insert():
        with db_lock:
            if not db_conn or not db_ready:
                raise RuntimeError("Database offline")
            with db_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO music.permissions (guild_id, role_id, scope)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (guild_id, role_id, scope) DO NOTHING
                    """,
                    (guild_id, str(role.id), scope.value),
                )

    try:
        await asyncio.to_thread(_insert)
        await respond(interaction, f"🎧 Role **{role.name}** granted **{scope.name}** permissions.")
        return
    except Exception as exc:
        log.error("Failed to persist music permission: %s", exc)
        await respond(interaction, "❌ Failed to save role permissions to database.", ephemeral=True)
        return


@bot.tree.command(name="masters", description="List assigned DJ and Master roles for this server (Matrix #53)")
async def cmd_masters(interaction: discord.Interaction):
    if not interaction.response.is_done():
        await interaction.response.defer()

    guild_id = str(interaction.guild_id)

    def _fetch():
        with db_lock:
            if not db_conn or not db_ready:
                return None
            with db_conn.cursor() as cur:
                cur.execute("SELECT role_id, scope FROM music.permissions WHERE guild_id = %s", (guild_id,))
                return cur.fetchall()

    try:
        rows = await asyncio.to_thread(_fetch)
        if rows is None:
            await respond(interaction, "ℹ️ Database offline; standard server managers retain master permissions.")
            return
        if not rows:
            await respond(interaction, "ℹ️ No custom DJ/Master roles configured. Server managers have full control.")
            return

        lines = [f"• <@&{r[0]}> — `{r[1].upper()}`" for r in rows]
        await respond(interaction, "🎧 **Configured Music Roles:**\n" + "\n".join(lines))
    except Exception as exc:
        log.error("Failed to fetch music permissions: %s", exc)
        await respond(interaction, "❌ Failed to fetch permissions.", ephemeral=True)


@bot.tree.command(name="disconnect", description="Disconnect the bot from voice")
async def cmd_disconnect(interaction: discord.Interaction):
    if not await check_dj_permission(interaction):
        await respond(interaction, "❌ You need the DJ/Master role to disconnect the bot.", ephemeral=True)
        return

    guild_id = str(interaction.guild_id)
    playback_generations[guild_id] = playback_generations.get(guild_id, 0) + 1
    playback_failure_count[guild_id] = 0
    active_sessions.discard(guild_id)
    track_started_at.pop(guild_id, None)

    vc = interaction.guild.voice_client if interaction.guild else None
    if vc:
        if vc.is_playing() or vc.is_paused():
            vc.stop()
        await vc.disconnect()
        await respond(interaction, "👋 Disconnected from voice channel.")
    else:
        await respond(interaction, "❌ Not connected to any voice channel.", ephemeral=True)


# --- Periodic Background Tasks ---
async def periodic_tasks():
    global db_ready
    while not is_stopping:
        await asyncio.sleep(15.0)
        try:
            # Reconnect if DATABASE_URL is set and connection is offline
            if DATABASE_URL and not db_ready:
                await asyncio.to_thread(init_db)
            for voice_client in list(bot.voice_clients):
                guild_id = str(voice_client.guild.id)
                try:
                    authorized = await asyncio.to_thread(guild_runtime_allowed_sync, guild_id) and await asyncio.to_thread(reserve_voice_sync, guild_id)
                except Exception:
                    authorized = False
                if not authorized:
                    await voice_client.disconnect(force=True)
            # 1. Flush snapshots to PostgreSQL every 15s (build snapshots on event loop thread first)
            snapshots = build_queue_snapshots()
            await asyncio.to_thread(flush_snapshots_sync, snapshots)
            # 2. Update service status
            ping = bot.latency * 1000 if bot.latency else 0.0
            await asyncio.to_thread(update_service_status_sync, ping)
        except Exception as exc:
            log.error("Periodic task error: %s", exc)


def setup_signals(loop: asyncio.AbstractEventLoop):
    global is_stopping

    def _trigger_shutdown():
        global is_stopping
        if not is_stopping:
            is_stopping = True
            log.info("Shutdown signal received; initiating graceful bot closure...")
            asyncio.create_task(bot.close())

    if sys.platform != "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _trigger_shutdown)
            except (NotImplementedError, RuntimeError):
                pass
    else:
        def _win_handler(signum, frame):
            global is_stopping
            is_stopping = True
            log.info("Signal %s received on Windows; scheduling bot closure...", signum)
            if bot.loop and not bot.loop.is_closed():
                asyncio.run_coroutine_threadsafe(bot.close(), bot.loop)

        signal.signal(signal.SIGINT, _win_handler)
        signal.signal(signal.SIGTERM, _win_handler)


def main():
    global is_stopping
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    if not BOT_TOKEN:
        log.error("BOT_TOKEN is required to run the music bot.")
        sys.exit(1)

    if len(ALLOWED_GUILDS) != 2:
        log.error("GUILD_ALLOWLIST must contain exactly two guild IDs to run the music bot.")
        sys.exit(1)

    init_db()

    # Start HTTP health server in background thread
    health_thread = threading.Thread(target=run_health_server, daemon=True)
    health_thread.start()
    log.info("Health server listening on port %d", HEALTH_PORT)

    async def runner():
        setup_signals(asyncio.get_running_loop())
        async with bot:
            periodic_task = asyncio.create_task(periodic_tasks())
            try:
                await bot.start(BOT_TOKEN)
            finally:
                periodic_task.cancel()

    try:
        asyncio.run(runner())
    except KeyboardInterrupt:
        log.info("KeyboardInterrupt received.")
    finally:
        is_stopping = True
        log.info("Flushing final state snapshot to database...")
        flush_snapshots_sync()
        if db_conn and not db_conn.closed:
            try:
                db_conn.close()
            except Exception:
                pass
        log.info("Music bot shutdown complete.")


if __name__ == "__main__":
    main()
