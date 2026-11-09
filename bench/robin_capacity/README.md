# Robin standalone music playback capacity benchmark

Measures how much CPU and memory Robin the music bot (`apps/bots/music-py`)
needs when it is run **from source** and streams music into Discord voice. It
answers the standalone sizing question and the Render free-instance question.

## What is measured

| Stage | Path exercised |
|---|---|
| `idle` | `import main` from source (discord.py, yt-dlp, psycopg loaded); no gateway login |
| `stream` | real `discord.FFmpegPCMAudio` → `PCMVolumeTransformer` → `discord.opus.Encoder`, paced at Discord's 20 ms / 3840-byte frame cadence |
| `extract` | the exact bounded `yt-dlp --dump-single-json --skip-download` command from `extract_tracks` |
| `download` | the exact bounded `yt-dlp` cache download from `download_media` |
| `env` | host, Python, FFmpeg, discord.py, Opus build, git revision, media SHA-256 |

The media source is the repository's own `apps/dashboard/public/media/loop.mp3`
(160 kbps MP3, 149.3 s), served over loopback for the yt-dlp stages. No Discord
token, production database, remote host or payment provider is touched.

**Not measured:** the Discord gateway, UDP send, DAVE encryption, real
YouTube/Spotify extraction, the phone CPU, or audible playback. If a number is
not in the result JSON, it was not measured.

## Setup (Windows or Linux)

```sh
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r apps/bots/music-py/requirements.txt psutil
python bench/robin_capacity/runner.py --self-test
```

FFmpeg must be on `PATH` (the production image installs it). On Windows,
discord.py ships its own `libopus` DLL; on the Linux image discord.py loads the
system `libopus` from the FFmpeg package.

## Run

```sh
python bench/robin_capacity/runner.py --stage all --execute --out bench/robin_capacity/results
```

The full run is 4 concurrency levels × 3 repeats × 30 s plus a 10 s cooldown
between runs, the import stage, and extraction/download (≈ 8–9 minutes). Run
one stage at a time on a quiet host:

```sh
python bench/robin_capacity/runner.py --stage stream --concurrency 2 --seconds 60 --execute
python bench/robin_capacity/runner.py --stage extract --execute
```

Recompute `summary.json` after editing the scenario without sending load again:

```sh
python bench/robin_capacity/runner.py --stage analyse --out bench/robin_capacity/results
```

Load stages refuse to start when `BOT_TOKEN`, `DISCORD_ROBIN_BOT_TOKEN`,
`DISCORD_MUSIC_BOT_TOKEN` or a non-empty `DATABASE_URL` is present.

## Reading the result

`summary.json` contains:

- `verdict.measured_per_stream_core` — measured cores per stream, taken from
  the configured 2-session level, worst sustained repeat.
- `verdict.required_cores_with_safety` — `sessions × per-stream × safety_factor`.
- `verdict.recommended_cpu` — the hard CPU limit to set (rounded up, 1.2 for
  the recorded run).
- `verdict.required_memory_mb` — idle import + FFmpeg per session + yt-dlp
  transient + memory headroom; `recommended_memory_mb` applies the 512 MB floor.
- `render_free.max_streams_at_50_percent` — how many streams Render free's
  0.1 CPU can sustain with 50 % headroom.
- `smooth_capacity` — largest tested concurrency with real-time throughput
  ≥ 0.99 and median p99 frame lateness ≤ 50 ms.

Use the **worst** repeat, not the best. A `max_late_100ms_frames` value above
zero means a frame missed a typical jitter buffer; that is an underrun risk, not
a cosmetic delay. CPU is a proxy: real DAVE encryption, UDP send and gateway
traffic are excluded, which is why the scenario applies a safety factor.

## Isolation and repository rules

This harness is loopback-only and refuses credential-bearing environments. Do
not run it against a live bot container or the phone's active sessions. Commit
only the small JSON/CSV summaries and the audit report; keep unbounded logs and
audio copies out of Git.
