#!/usr/bin/env python3
"""Robin (apps/bots/music-py) music playback capacity benchmark.

This harness measures Robin's real decode/volume/Opus path without a Discord
connection: ``discord.FFmpegPCMAudio`` -> ``PCMVolumeTransformer`` ->
``discord.opus.Encoder``, paced at Discord's 20 ms frame cadence. It also
measures the source import footprint and the bounded yt-dlp resolution/download
subprocesses.

Safety:
  * no Discord token, production database, payment provider or remote host is used;
  * load stages require ``--execute`` and refuse token/DATABASE_URL environments;
  * the yt-dlp stages use a loopback HTTP server and a repository media asset.

Typical run (see README.md for the venv):
  python runner.py --self-test
  python runner.py --stage all --execute --out results

The measured host is a proxy, not the phone or Render. Read the report before
turning any number into a deployment promise.
"""
from __future__ import annotations

import argparse
import csv
import functools
import hashlib
import http.server
import json
import math
import os
import platform
import re
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "apps" / "bots" / "music-py" / "src" / "main.py"
DEFAULT_SOURCE = ROOT / "apps" / "dashboard" / "public" / "media" / "loop.mp3"
DEFAULT_SCENARIO = Path(__file__).with_name("scenario.example.json")
TOKEN_ENV = ("BOT_TOKEN", "DISCORD_ROBIN_BOT_TOKEN", "DISCORD_MUSIC_BOT_TOKEN")
FRAME_SECONDS = 0.02
FRAME_BYTES = 3840  # 20 ms, 48 kHz, stereo, signed 16-bit PCM


def now() -> float:
    return time.perf_counter()


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * fraction))))
    return round(ordered[index], 3)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ffprobe_duration(path: Path) -> float | None:
    try:
        output = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        return round(float(output.stdout.strip()), 3)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def refuse_unsafe_load() -> None:
    tokens = [name for name in TOKEN_ENV if os.environ.get(name)]
    database = os.environ.get("DATABASE_URL", "").strip()
    if tokens or database:
        raise SystemExit(
            "Refusing to run a load stage with Discord/DB credentials present "
            f"(tokens={tokens}, DATABASE_URL={'set' if database else 'unset'}). "
            "Unset them: the benchmark must not touch production."
        )


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Child stages (self-reporting; the venv launcher can hide child PIDs on Windows)
# ---------------------------------------------------------------------------

def idle_child() -> dict:
    """Import the real Robin module and report startup cost/RSS."""
    os.environ.setdefault("CACHE_DIR", str(Path(os.environ.get("TMP", ".")) / "robin-bench-cache"))
    os.environ["DATABASE_URL"] = ""
    for name in TOKEN_ENV:
        os.environ.pop(name, None)
    os.environ.setdefault("GUILD_ALLOWLIST", "1,2")
    sys.path.insert(0, str(MAIN.parent))
    import psutil  # benchmark-only dependency

    before = psutil.Process().memory_info().rss
    started, cpu_started = now(), time.process_time()
    import main  # noqa: F401  (source import only; main() is never called)
    wall = now() - started
    cpu = time.process_time() - cpu_started
    process = psutil.Process()
    return {
        "stage": "idle",
        "import_wall_seconds": round(wall, 3),
        "import_cpu_seconds": round(cpu, 3),
        "rss_before_mb": round(before / 1024 / 1024, 1),
        "rss_after_mb": round(process.memory_info().rss / 1024 / 1024, 1),
        "commands": len(main.bot.tree.get_commands()),
        "max_voice_sessions": main.MAX_VOICE_SESSIONS,
        "cache_root": str(main.MUSIC_CACHE.root),
        "source": str(MAIN),
    }


def stream_child(args: argparse.Namespace) -> dict:
    """Run N simulated Robin audio players in one process."""
    import psutil
    import discord

    source_path = Path(args.source).resolve()
    if not source_path.is_file():
        raise SystemExit(f"source media not found: {source_path}")
    if not discord.opus.is_loaded():
        discord.opus._load_default()

    process = psutil.Process()
    results: list[dict] = []
    sources: list[object] = []
    lock = threading.Lock()
    barrier = threading.Barrier(args.concurrency + 1)

    def player(index: int) -> None:
        source = discord.FFmpegPCMAudio(str(source_path), before_options="-nostdin", options="-vn")
        source = discord.PCMVolumeTransformer(source, volume=0.7)
        first = source.read()  # absorb FFmpeg startup before the cadence clock
        if not first:
            raise RuntimeError("FFmpeg produced no audio")
        with lock:
            sources.append(source)
        encoder = discord.opus.Encoder()
        frames = 0
        lateness: list[float] = []
        read_cpu = encode_cpu = 0.0
        barrier.wait()
        started = now()
        while True:
            deadline = started + frames * FRAME_SECONDS
            remaining = deadline - now()
            if remaining > 0:
                time.sleep(remaining)
            cpu = time.process_time()
            data = source.read()
            read_cpu += time.process_time() - cpu
            if not data:
                break
            cpu = time.process_time()
            encoder.encode(data, 960)
            encode_cpu += time.process_time() - cpu
            frames += 1
            lateness.append(max(0.0, (now() - deadline) * 1000.0))
            if frames * FRAME_SECONDS >= args.seconds:
                break
        with lock:
            results.append({
                "stream": index,
                "frames": frames,
                "audio_seconds": round(frames * FRAME_SECONDS, 3),
                "late_20ms": sum(1 for value in lateness if value > 20),
                "late_50ms": sum(1 for value in lateness if value > 50),
                "late_100ms": sum(1 for value in lateness if value > 100),
                "lateness_p50_ms": percentile(lateness, 0.50),
                "lateness_p95_ms": percentile(lateness, 0.95),
                "lateness_p99_ms": percentile(lateness, 0.99),
                "lateness_max_ms": round(max(lateness), 3) if lateness else 0.0,
                "read_cpu_seconds": round(read_cpu, 3),
                "encode_cpu_seconds": round(encode_cpu, 3),
            })

    cpu_before = process.cpu_times()
    max_self_rss = 0
    system_load: list[float] = []
    psutil.cpu_percent(interval=None)  # prime the per-interval counter
    threads = [threading.Thread(target=player, args=(index,), name=f"robin-stream-{index}") for index in range(args.concurrency)]
    try:
        for thread in threads:
            thread.start()
        barrier.wait()
        wall_started = now()
        while any(thread.is_alive() for thread in threads):
            max_self_rss = max(max_self_rss, process.memory_info().rss)
            system_load.append(psutil.cpu_percent(interval=None))
            time.sleep(0.25)
        wall = now() - wall_started
    finally:
        for thread in threads:
            thread.join(timeout=5)

    # Read the FFmpeg children before cleanup reaps them.
    ffmpeg_cpu = 0.0
    ffmpeg_rss: list[int] = []
    ffmpeg_complete = True
    seen: set[int] = set()
    for source in sources:
        original = getattr(source, "original", source)
        popen = getattr(original, "_process", None)
        if popen is None or popen.pid in seen:
            continue
        seen.add(popen.pid)
        try:
            child = psutil.Process(popen.pid)
            times = child.cpu_times()
            ffmpeg_cpu += times.user + times.system
            ffmpeg_rss.append(child.memory_info().rss)
        except psutil.Error:
            ffmpeg_complete = False
    for child in process.children(recursive=True):
        if child.pid in seen:
            continue
        try:
            times = child.cpu_times()
            ffmpeg_cpu += times.user + times.system
            ffmpeg_rss.append(child.memory_info().rss)
            seen.add(child.pid)
        except psutil.Error:
            pass
    for source in sources:
        try:
            source.cleanup()
        except Exception:
            pass

    cpu_after = process.cpu_times()
    self_cpu = (cpu_after.user - cpu_before.user) + (cpu_after.system - cpu_before.system)

    total_cpu = self_cpu + ffmpeg_cpu
    audio_seconds = stats_audio(results)
    return {
        "stage": "stream",
        "concurrency": args.concurrency,
        "requested_seconds": args.seconds,
        "audio_seconds": audio_seconds,
        "wall_seconds": round(wall, 3),
        "realtime_ratio": round(audio_seconds / wall, 4) if wall else None,
        "self_cpu_seconds": round(self_cpu, 3),
        "ffmpeg_cpu_seconds": round(ffmpeg_cpu, 3),
        "ffmpeg_cpu_complete": ffmpeg_complete,
        "total_cpu_seconds": round(total_cpu, 3),
        "core_seconds_per_audio_second": round(total_cpu / wall, 4) if wall else None,
        "core_per_stream": round((total_cpu / wall) / args.concurrency, 4) if wall else None,
        "cpu_seconds_per_stream": round(total_cpu / args.concurrency, 4),
        "self_rss_mb": round(max_self_rss / 1024 / 1024, 1),
        "ffmpeg_rss_mb_each": [round(value / 1024 / 1024, 1) for value in ffmpeg_rss],
        "ffmpeg_rss_mb_total": round(sum(ffmpeg_rss) / 1024 / 1024, 1),
        "system_cpu_percent_mean": round(statistics.mean(system_load), 1) if system_load else None,
        "system_cpu_percent_max": round(max(system_load), 1) if system_load else None,
        "cpu_freq_mhz": round(psutil.cpu_freq().current, 1) if psutil.cpu_freq() else None,
        "streams": sorted(results, key=lambda item: item["stream"]),
        "source": str(source_path),
        "source_sha256": sha256(source_path),
    }


def stats_audio(results: list[dict]) -> float:
    if not results:
        return 0.0
    return round(min(item["audio_seconds"] for item in results), 3)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:  # silence loopback request logs
        pass


def _serve(directory: Path) -> tuple[http.server.ThreadingHTTPServer, int]:
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def _measure_sync(label: str, work) -> dict:
    import psutil

    process = psutil.Process()
    max_rss = 0
    stop = threading.Event()

    def sampler() -> None:
        nonlocal max_rss
        while not stop.is_set():
            try:
                max_rss = max(max_rss, process.memory_info().rss)
            except psutil.Error:
                return
            time.sleep(0.02)

    thread = threading.Thread(target=sampler, daemon=True)
    thread.start()
    started, cpu_started = now(), time.process_time()
    exit_code = 0
    detail = None
    try:
        detail = work()
    except SystemExit as error:  # yt-dlp parses argv and may exit
        exit_code = int(error.code or 0)
    except Exception as error:  # noqa: BLE001 - report the failure, do not hide it
        exit_code = 1
        detail = f"{type(error).__name__}: {error}"
    finally:
        wall = now() - started
        cpu = time.process_time() - cpu_started
        stop.set()
        thread.join(timeout=2)
    return {
        "stage": label,
        "wall_seconds": round(wall, 3),
        "cpu_seconds": round(cpu, 3),
        "max_rss_mb": round(max_rss / 1024 / 1024, 1),
        "exit_code": exit_code,
        "detail": detail,
    }


def extract_child(args: argparse.Namespace) -> dict:
    """Measure the exact bounded metadata subprocess command shape."""
    import yt_dlp

    directory = Path(args.source).resolve().parent
    server, port = _serve(directory)
    url = f"http://127.0.0.1:{port}/{Path(args.source).name}"
    argv = [
        "--dump-single-json", "--skip-download", "--no-playlist",
        "--socket-timeout", "10", "--retries", "1", "--extractor-retries", "1",
        "--format", "bestaudio/best", "--", url,
    ]

    def work():
        import io

        buffer = io.StringIO()
        original = sys.stdout
        sys.stdout = buffer
        code = 0
        try:
            try:
                code = yt_dlp.main(argv)
            except SystemExit as error:  # yt-dlp may exit after printing the JSON
                code = int(error.code or 0)
        finally:
            sys.stdout = original
        return {"exit_code": int(code or 0), "output_bytes": len(buffer.getvalue())}

    try:
        result = _measure_sync("extract", work)
    finally:
        server.shutdown()
    result["url"] = url
    result["command"] = ["python", "-m", "yt_dlp", *argv]
    return result


def download_child(args: argparse.Namespace) -> dict:
    """Measure the bounded cache download used by ``download_media``."""
    import yt_dlp

    directory = Path(args.source).resolve().parent
    server, port = _serve(directory)
    url = f"http://127.0.0.1:{port}/{Path(args.source).name}"
    destination = Path(args.destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.unlink(missing_ok=True)
    limit = 50 * 1024 * 1024

    def work():
        def progress(event):
            if event.get("downloaded_bytes", 0) > limit:
                raise yt_dlp.utils.DownloadError("cache item limit")

        with yt_dlp.YoutubeDL({
            "format": "bestaudio/best",
            "outtmpl": str(destination),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "nopart": True,
            "max_filesize": limit,
            "progress_hooks": [progress],
            "cachedir": False,
        }) as ydl:
            code = ydl.download([url])
        return {"exit_code": int(code or 0), "output_bytes": destination.stat().st_size if destination.exists() else 0}

    try:
        result = _measure_sync("download", work)
    finally:
        server.shutdown()
    result["url"] = url
    result["destination"] = str(destination)
    return result


# ---------------------------------------------------------------------------
# Parent stages
# ---------------------------------------------------------------------------

def stage_env(args: argparse.Namespace) -> dict:
    try:
        ffmpeg = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=30).stdout.splitlines()[0]
    except (OSError, subprocess.SubprocessError):
        ffmpeg = None
    try:
        revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=30).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        revision, dirty = None, ""
    import psutil

    vcpu = psutil.cpu_count(logical=True)
    physical = psutil.cpu_count(logical=False)
    memory = psutil.virtual_memory()
    try:
        import discord
        if not discord.opus.is_loaded():
            discord.opus._load_default()
        discord_version = discord.__version__
        opus = "loaded"
        opus_library = getattr(getattr(discord.opus, "_lib", None), "_name", None)
        try:
            opus_version = discord.opus._lib.opus_get_version_string().decode("ascii", "replace")
        except Exception:
            opus_version = None
    except Exception:
        discord_version, opus, opus_library, opus_version = None, "unavailable", None, None
    return {
        "stage": "env",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "executable": sys.executable,
        "base_executable": getattr(sys, "_base_executable", None),
        "cpu_model": platform.processor(),
        "logical_cpus": vcpu,
        "physical_cpus": physical,
        "total_ram_mb": round(memory.total / 1024 / 1024, 1),
        "ffmpeg": ffmpeg,
        "discord_py": discord_version,
        "opus": opus,
        "opus_library": opus_library,
        "opus_version": opus_version,
        "git_revision": revision,
        "git_dirty": bool(dirty),
        "git_dirty_entries": dirty.splitlines() if dirty else [],
        "source": str(MAIN),
        "source_sha256": sha256(MAIN),
        "media": str(DEFAULT_SOURCE),
        "media_sha256": sha256(DEFAULT_SOURCE) if DEFAULT_SOURCE.exists() else None,
        "media_duration_seconds": ffprobe_duration(DEFAULT_SOURCE) if DEFAULT_SOURCE.exists() else None,
    }


def run_child(stage: str, args: argparse.Namespace, out: Path) -> dict:
    command = [sys.executable, str(Path(__file__).resolve()), "--stage", stage, "--source", args.source]
    if stage in {"stream", "_stream_child"}:
        command += ["--concurrency", str(args.concurrency), "--seconds", str(args.seconds)]
    if stage == "download":
        command += ["--destination", str(out / "download-test.audio")]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=args.seconds + 300)
    if completed.returncode != 0:
        raise SystemExit(f"{stage} child failed ({completed.returncode}):\n{completed.stderr[-2000:]}")
    line = [line for line in completed.stdout.splitlines() if line.strip().startswith("{")]
    if not line:
        raise SystemExit(f"{stage} child produced no JSON:\n{completed.stdout[-1000:]}\n{completed.stderr[-1000:]}")
    return json.loads(line[-1])


def stage_all(args: argparse.Namespace, out: Path) -> None:
    refuse_unsafe_load()
    out.mkdir(parents=True, exist_ok=True)
    scenario = load_json(Path(args.scenario)) if Path(args.scenario).exists() else {}
    summary = {"scenario": scenario, "runs": {}}

    print("stage: env", flush=True)
    env = stage_env(args)
    write_json(out / "env.json", env)

    print("stage: idle", flush=True)
    idle = run_child("_idle_child", args, out)
    write_json(out / "idle.json", idle)

    concurrency = [int(value) for value in str(args.concurrency_list).split(",") if value.strip()]
    stream_runs = []
    first = True
    for count in concurrency:
        for repeat in range(args.repeats):
            if not first and args.cooldown > 0:
                time.sleep(args.cooldown)
            first = False
            child = argparse.Namespace(**vars(args))
            child.concurrency = count
            child.seconds = args.seconds
            print(f"stage: stream concurrency={count} repeat={repeat + 1}/{args.repeats}", flush=True)
            result = run_child("_stream_child", child, out)
            result["repeat"] = repeat + 1
            write_json(out / f"stream-{count}-{repeat + 1}.json", result)
            stream_runs.append(result)

    print("stage: extract", flush=True)
    extract = run_child("_extract_child", args, out)
    write_json(out / "extract.json", extract)

    print("stage: download", flush=True)
    download = run_child("_download_child", args, out)
    write_json(out / "download.json", download)

    summary["runs"] = {
        "env": env,
        "idle": idle,
        "streams": stream_runs,
        "extract": extract,
        "download": download,
    }
    summary.update(analyse(summary, scenario))
    write_json(out / "summary.json", summary)
    write_csv(out / "summary.csv", stream_runs)
    print(json.dumps({key: summary[key] for key in ("verdict", "legacy_pool", "render_free", "smooth_capacity")}, indent=2))


def analyse(summary: dict, scenario: dict) -> dict:
    limits = scenario.get("limits", {})
    pool = scenario.get("pool", {})
    render = scenario.get("render_free", {})
    sessions = int(limits.get("voice_sessions", 2))
    safety = float(limits.get("safety_factor", 2.0))
    target_utilization = float(limits.get("target_cpu_utilization", 0.5))
    underrun_ms = float(limits.get("underrun_ms", 100))
    memory_headroom = float(limits.get("memory_headroom", 0.25))
    streams = summary["runs"]["streams"]
    by_count: dict[int, list[dict]] = {}
    for run in streams:
        by_count.setdefault(int(run["concurrency"]), []).append(run)

    rows = []
    for count, runs in sorted(by_count.items()):
        p99_per_run = [
            max(stream["lateness_p99_ms"] for stream in run["streams"])
            for run in runs
        ]
        rows.append({
            "concurrency": count,
            "per_stream_core_median": round(statistics.median(run["core_per_stream"] for run in runs), 4),
            "per_stream_core_max": round(max(run["core_per_stream"] for run in runs), 4),
            "total_core_max": round(max(run["core_seconds_per_audio_second"] for run in runs), 4),
            "p99_lateness_median_ms": round(statistics.median(p99_per_run), 3),
            "p99_lateness_max_ms": round(max(p99_per_run), 3),
            "max_lateness_ms": round(max(stream["lateness_max_ms"] for run in runs for stream in run["streams"]), 3),
            "late_100ms_frames": sum(stream["late_100ms"] for run in runs for stream in run["streams"]),
            "runs_with_a_100ms_stall": sum(1 for run in runs if any(stream["late_100ms"] for stream in run["streams"])),
            "realtime_ratio_min": min(run["realtime_ratio"] for run in runs),
            "ffmpeg_rss_mb_total_max": max(run["ffmpeg_rss_mb_total"] for run in runs),
            "self_rss_mb_max": max(run["self_rss_mb"] for run in runs),
        })

    target_runs = by_count.get(sessions) or by_count[max(by_count)] if by_count else []
    sustained = [run for run in target_runs if run.get("sustained")]
    target = sustained or target_runs
    per_stream = max(run["core_per_stream"] for run in target) if target else None
    required_cores = round(per_stream * sessions * safety, 3) if per_stream else None
    cpu_ceiling = float(pool.get("cpu_ceiling", 9))
    rounding = int(pool.get("share_rounding", 64))
    required_shares = {}
    for name, total in (
        ("with_cyrene_tts", pool.get("shares_with_cyrene_tts")),
        ("without_cyrene_tts", pool.get("shares_without_cyrene_tts")),
    ):
        if total and required_cores:
            shares = required_cores / cpu_ceiling * float(total)
            required_shares[name] = int(math.ceil(shares / rounding) * rounding)

    idle_rss = summary["runs"]["idle"].get("rss_after_mb", 0)
    extract_rss = max(
        summary["runs"]["extract"].get("max_rss_mb", 0),
        summary["runs"]["download"].get("max_rss_mb", 0),
    )
    stream_mem = max(run["ffmpeg_rss_mb_total"] for run in target) if target else 0
    required_memory = round((idle_rss + stream_mem + extract_rss) * (1 + memory_headroom), 1) if idle_rss else None

    free_cpu = float(render.get("cpu", 0.1))
    free_memory = float(render.get("memory_mb", 512))
    free_streams = int(math.floor(free_cpu / per_stream)) if per_stream else None
    free_safe_streams = int(math.floor(free_cpu * target_utilization / per_stream)) if per_stream else None
    free_memory_fits = required_memory is not None and required_memory <= free_memory

    smooth = []
    for row in rows:
        if row["realtime_ratio_min"] >= 0.99 and row["p99_lateness_median_ms"] <= underrun_ms / 2:
            smooth.append(row["concurrency"])
    smooth_capacity = max(smooth) if smooth else 0
    stall_runs = sum(row["runs_with_a_100ms_stall"] for row in rows)
    stall_frames = sum(row["late_100ms_frames"] for row in rows)

    existing = scenario.get("existing_allocation", {})
    existing_core = None
    existing_headroom = None
    if existing.get("shares") and pool.get("shares_with_cyrene_tts"):
        existing_core = round(float(existing["shares"]) / float(pool["shares_with_cyrene_tts"]) * cpu_ceiling, 3)
        if per_stream:
            existing_headroom = round(existing_core / (per_stream * sessions), 2)

    verdict = {
        "measured_per_stream_core": per_stream,
        "sessions": sessions,
        "sizing_basis": "sustained" if sustained else "burst",
        "sustained_runs": len(sustained),
        "required_cores_with_safety": required_cores,
        "recommended_cpu": round(math.ceil(required_cores * 10) / 10, 1) if required_cores else None,
        "required_memory_mb": required_memory,
        "recommended_memory_mb": max(512, int(math.ceil(required_memory))) if required_memory else None,
        "smooth_streams_tested": smooth_capacity,
        "host_stall_runs": stall_runs,
        "host_stall_frames_over_100ms": stall_frames,
        "note": (
            "Robin's requirement is independent of Cyrene/TTS. Per-stream core is measured "
            "steady-state CPU at the configured session count. Smooth = real-time ratio >= 0.99 "
            "and median per-run p99 lateness <= 50 ms. Isolated >100 ms stalls are reported "
            "separately; they are host scheduling evidence, not proof of a Robin defect, when "
            "CPU utilization was low."
        ),
    }
    return {
        "verdict": verdict,
        "legacy_pool": {
            "retired": True,
            "note": "Optional conversion only; the share denominator includes or excludes Cyrene's separate TTS service. Robin's requirement is the hard CPU/memory figure above.",
            "cpu_ceiling": cpu_ceiling,
            "required_shares": required_shares,
            "existing": existing,
            "existing_core_under_full_contention": existing_core,
            "existing_headroom_x": existing_headroom,
        },
        "render_free": {
            "cpu": free_cpu,
            "memory_mb": free_memory,
            "max_streams_at_100_percent": free_streams,
            "max_streams_at_50_percent": free_safe_streams,
            "memory_fits": free_memory_fits,
            "sufficient_for_configured_sessions": bool(free_safe_streams is not None and free_safe_streams >= sessions and free_memory_fits),
        },
        "smooth_capacity": smooth_capacity,
        "rows": rows,
        "database": {
            "robin_connections": 1,
            "reason": "music-py uses one psycopg connection guarded by db_lock (not a pool); see apps/bots/music-py/src/main.py:init_db.",
        },
    }


def write_csv(path: Path, runs: list[dict]) -> None:
    fields = [
        "concurrency", "repeat", "audio_seconds", "wall_seconds", "realtime_ratio",
        "core_per_stream", "core_seconds_per_audio_second", "cpu_seconds_per_stream",
        "self_cpu_seconds", "ffmpeg_cpu_seconds", "self_rss_mb", "ffmpeg_rss_mb_total",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for run in runs:
            writer.writerow({field: run.get(field) for field in fields})


def analyse_existing(out: Path, scenario_path: Path) -> None:
    """Recompute summary.json/summary.csv from the per-stage result files."""
    scenario = load_json(scenario_path) if scenario_path.exists() else {}
    runs = {
        "env": load_json(out / "env.json"),
        "idle": load_json(out / "idle.json"),
        "extract": load_json(out / "extract.json"),
        "download": load_json(out / "download.json"),
        "streams": [],
    }
    for path in sorted(out.glob("stream-*-*.json")):
        run = load_json(path)
        if "repeat" not in run:
            match = re.match(r"stream-\d+-(\d+)\.json$", path.name)
            run["repeat"] = int(match.group(1)) if match else 1
        if "core_per_stream" not in run:
            run["core_per_stream"] = round(
                float(run["core_seconds_per_audio_second"]) / int(run["concurrency"]), 4
            )
        runs["streams"].append(run)
    summary = {"scenario": scenario, "runs": runs}
    summary.update(analyse(summary, scenario))
    write_json(out / "summary.json", summary)
    write_csv(out / "summary.csv", runs["streams"])
    print(json.dumps({key: summary[key] for key in ("verdict", "legacy_pool", "render_free", "smooth_capacity")}, indent=2))


def self_test(args: argparse.Namespace) -> None:
    checks = []
    checks.append(("source exists", MAIN.is_file()))
    checks.append(("media exists", DEFAULT_SOURCE.is_file()))
    checks.append(("ffmpeg", subprocess.run(["ffmpeg", "-version"], capture_output=True).returncode == 0))
    duration = ffprobe_duration(DEFAULT_SOURCE) if DEFAULT_SOURCE.exists() else None
    checks.append(("media duration", duration is not None and duration > 10))
    try:
        import discord
        if not discord.opus.is_loaded():
            discord.opus._load_default()
        encoded = discord.opus.Encoder().encode(b"\x00" * FRAME_BYTES, 960)
        checks.append(("discord opus encode", bool(encoded)))
    except Exception as error:  # noqa: BLE001
        checks.append((f"discord opus encode ({type(error).__name__})", False))
    try:
        import psutil  # noqa: F401
        checks.append(("psutil", True))
    except Exception:
        checks.append(("psutil", False))
    for name, ok in checks:
        print(f"[{'ok' if ok else 'FAIL'}] {name}")
    if not all(ok for _, ok in checks):
        raise SystemExit("self-test failed")
    print(f"source duration: {duration}s")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", default="all", choices=[
        "all", "env", "idle", "stream", "extract", "download", "analyse", "self-test",
        "_idle_child", "_stream_child", "_extract_child", "_download_child",
    ])
    parser.add_argument("--execute", action="store_true", help="required for load stages")
    parser.add_argument("--self-test", action="store_true", help="verify ffmpeg, media and Opus, then exit")
    parser.add_argument("--out", default=str(Path(__file__).with_name("results")))
    parser.add_argument("--scenario", default=str(DEFAULT_SCENARIO))
    parser.add_argument("--source", default=str(DEFAULT_SOURCE))
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--concurrency-list", default="1,2,4,6")
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--cooldown", type=float, default=10.0, help="idle seconds between stream runs to limit thermal stacking")
    parser.add_argument("--destination", default=str(Path(os.environ.get("TMP", ".")) / "robin-bench-cache" / "download-test.audio"))
    args = parser.parse_args()
    out = Path(args.out).resolve()

    if args.self_test or args.stage == "self-test":
        self_test(args)
        return
    if args.stage == "_idle_child":
        print(json.dumps(idle_child()))
        return
    if args.stage == "_stream_child":
        print(json.dumps(stream_child(args)))
        return
    if args.stage == "_extract_child":
        print(json.dumps(extract_child(args)))
        return
    if args.stage == "_download_child":
        print(json.dumps(download_child(args)))
        return
    if args.stage == "analyse":
        analyse_existing(out, Path(args.scenario))
        return
    if args.stage.startswith("_") or args.stage in {"all", "stream", "extract", "download"}:
        if not args.execute:
            raise SystemExit("Load stages require --execute. Run --self-test first.")
        refuse_unsafe_load()
    if args.stage == "env":
        write_json(out / "env.json", stage_env(args))
        return
    if args.stage == "idle":
        write_json(out / "idle.json", run_child("_idle_child", args, out))
        return
    if args.stage == "stream":
        write_json(out / f"stream-{args.concurrency}.json", run_child("_stream_child", args, out))
        return
    if args.stage == "extract":
        write_json(out / "extract.json", run_child("_extract_child", args, out))
        return
    if args.stage == "download":
        write_json(out / "download.json", run_child("_download_child", args, out))
        return
    stage_all(args, out)


if __name__ == "__main__":
    main()
