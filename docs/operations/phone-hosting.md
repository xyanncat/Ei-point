# Phone hosting — Cyrene + Robin

Cyrene (`bot-ai`) and Robin (`music-py`) run on one Android phone. Cyrene also
hosts the only local model: a fine-tuned **Piper** voice. Everything else is
hosted (Groq chat, Render bots, Neon, Drive).

## Why the phone

- Cyrene needs a local TTS model; Render free has 0.1 CPU / 512 MB.
- Robin streams voice audio; 0.1 CPU and Render's outbound limits make it a
  marginal fit, so the phone is the first choice. Benchmark it on Render only if
  the phone cannot hold both.

## Termux setup

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git ffmpeg python clang make
termux-wake-lock                       # keeps the CPU awake with the screen off
# Disable battery optimisation for Termux in Android settings.
```

Install the repo and build:

```sh
git clone https://github.com/xyanncat/Ei-point && cd Ei-point
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @ei-point/flow build
pnpm --filter @ei-point/bot-ai build
```

Run both identities under `tmux` (or termux-services) so a dropped SSH/session
does not stop them. Put the values from
[`infra/phone/cyrene.env.example`](../infra/phone/cyrene.env.example) in an
untracked `cyrene.env` on the device:

```sh
set -a; . ./cyrene.env; set +a
# Cyrene (bot-ai) — TTS is the Piper bridge on this same device.
node apps/bots/ai/dist/index.js
# Robin
BOT_KEY=robin BOT_TOKEN='…' GUILD_ALLOWLIST='id1,id2' \
  MUSIC_HEALTH_PORT=3105 python apps/bots/music-py/src/main.py
```

Keep the phone charging, on Wi-Fi, and out of aggressive battery optimisation.
A phone that throttles will drop voice frames before it drops the gateway.

## Phone TTS (sherpa-onnx) contract

The bot's `local` TTS provider posts:

```http
POST /tts
Content-Type: application/json

{ "text": "…", "voice": "default", "format": "wav" }
```

The reference sherpa-onnx server on the phone reads `text` and an optional
`speed`, ignores the extra fields, and returns raw **WAV** bytes with
`Content-Type: audio/wav`. The wrapper (`cyrene_server.py`) is maintained
outside this repository; voice selection is server-side, so leave `voice` at
the default unless the server gains named speakers.

### Wiring

The bot and the bridge run on the **same self-hosted device**, so `TTS_URL`
stays on loopback:

```sh
TTS_PROVIDER=local
TTS_URL=http://127.0.0.1:6006/tts
```

Verified deployment (2026-11-09): Redmi 10 Prime, Android 13, arm64, Termux
0.118.3, Node 26.12.1, ffmpeg 9.0.2. The bot was built on-device with `tsc`
(`pnpm install --filter @ei-point/bot-ai... --ignore-scripts`), the persona was
copied with a verified SHA-256, and the smoke run stops at the expected missing
`BOT_TOKEN`/`GUILD_ALLOWLIST` check. Termux has no `/usr/bin/env`, so invoke
pnpm as `node "$PREFIX/lib/node_modules/pnpm/bin/pnpm.cjs"`. The boot script
must export `HOME`, `PREFIX`, `PATH` and `LD_LIBRARY_PATH` before
`termux-wake-lock` because Termux:Boot starts with a minimal environment.

The Render API is not part of this path — it never proxies speech. If the
bridge ever moves to a **different** device, point `TTS_URL` at that device's
LAN address (for example `http://192.168.1.50:6006/tts`), open TCP
6006 only on the local network, and leave `TTS_PROVIDER=local` unchanged.
Bot health stays independent of the bridge: `/health/live` remains green if the
bridge dies, and `/speak` answers with an honest unavailable message.

Constraints:

- 500 characters per request (`/speak` cap), 8 MiB audio bound.
- One synthesis at a time is fine; the bot already has a bounded queue.
- `TTS_TOTAL_DEADLINE_SECONDS` (default 90) includes queue wait.
- If the bridge is down, users get an honest "voice service unavailable" answer;
  chat still works.

## Playback latency on the phone

Measured on the Redmi (2026-11-09): the phone is not memory-bound — 6 GB total,
~3.2 GB available, Cyrene 85 MB RSS, Robin 77 MB, sherpa TTS 196 MB. The first
`/play` was slow because yt-dlp extracted with the EJS solver (~11 s), then
Robin waited for a full YouTube download (a throttled CDN host served
15–36 KB/s while the phone's general link was ~3 MB/s).

The runtime now:

- runs yt-dlp with **`--force-ipv4`** (the phone has no IPv6 route);
- uses a **fast extraction path** that hides the Deno/EJS solver
  (`YTDLP_FAST_PATH`, default `/usr/bin:/bin`) and retries with EJS only if
  extraction fails;
- selects **60–72 kbps** Opus (`bestaudio[abr<=72]/bestaudio/best`) instead of
  128 kbps, halving the bytes for voice playback;
- **streams the direct URL immediately** and warms the next track in the
  background; it no longer downloads the whole file before the first note;
- uses `--http-chunk-size 1M` and IPv4 for background cache downloads.

Extraction measured **5–6 s** on the fast path (vs ~11 s with EJS). First audio
no longer waits for the full download; repeat and prefetched tracks use the
bounded cache. YouTube CDN host selection still varies (one host measured
15 KB/s, another 158 KB/s, `mweb` 464 KB/s); if a song stutters, queue the next
track and let the cache warm, or retry the link to get a different host.

Optional EJS fallback (needed only when the fast extraction fails):

```sh
curl -fsSL --retry 2 \
  https://github.com/denoland/deno/releases/latest/download/deno-aarch64-unknown-linux-gnu.zip \
  -o /tmp/deno.zip
/opt/robin-venv/bin/python -c 'import zipfile; zipfile.ZipFile("/tmp/deno.zip").extractall("/usr/local/bin")'
chmod 755 /usr/local/bin/deno
```

## Robin benchmark (before relying on it)

Run one voice session and record: CPU per stream, RSS, dropped frames, and
whether a second concurrent stream is possible. The current deployment runs
Cyrene + Robin + TTS on the same 6 GB phone and has ~3.2 GB available, so RAM
is not the constraint; if playback stutters under load, use a second phone or a
paid Render instance with at least **1.2 CPU / 512 MB**. Render free's 0.1 CPU
is not sufficient for two streams (see the benchmark below).

The source-side baseline and the sizing method are in
[2026-11-09-robin-pool-capacity-benchmark](../audits/2026-11-09-robin-pool-capacity-benchmark.md).
Run `bench/robin_capacity/runner.py` on the phone before freezing the pool or
instance allocation; the development-host result is not a phone result.

## Robin in proot Debian (required for Discord voice)

Discord voice enforces DAVE; `discord.py[voice]` depends on `davey`, which has
no Android wheel and cannot build for `aarch64-linux-android`. Robin therefore
runs inside **proot Debian** on the same phone:

```sh
pkg install -y proot-distro
proot-distro install debian          # one time
proot-distro login debian -- bash -lc '
  apt-get update && apt-get install -y python3 python3-venv ffmpeg ca-certificates
  python3 -m venv /opt/robin-venv
  /opt/robin-venv/bin/pip install "discord.py[voice]==2.7.1" \
    "yt-dlp==2026.10.26" "certifi==2026.10.18" "psycopg[binary]==3.2.9"
'
```

Run the repository from Termux home by binding it into Debian:

```sh
proot-distro login debian \
  --bind "$HOME/ei-point:/root/ei-point" \
  --bind "$HOME/robin.env:/root/robin.env" \
  -- bash -lc 'set -a; . /root/robin.env; set +a; cd /root/ei-point/apps/bots/music-py; exec /opt/robin-venv/bin/python src/main.py'
```

- Env: copy [`infra/phone/robin.env.example`](../infra/phone/robin.env.example)
  to `~/robin.env` in Termux and edit it there; the bind exposes it as
  `/root/robin.env`. Verified: Robin loads in Debian and stops with
  `BOT_TOKEN is required` until the token and Neon URL are filled.
- Cache lives at `/root/music-cache`; health is `127.0.0.1:3105`.
- A boot script can wrap the same command; keep it below the Cyrene boot
  service so TTS starts first.
- Cyrene + TTS + Robin share one phone: watch thermals, CPU and battery. If
  Robin stutters, use the benchmark sizing above rather than guessing.

## Backups and logs

The phone is not a backup target. Neon is dumped nightly to Drive by GitHub
Actions; media masters and logs go to `drive:ei-point/media` and
`drive:ei-point/exports` (rclone). Never keep the only copy of anything on the
phone.
