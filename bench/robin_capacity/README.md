# Robin source audio-render capacity benchmark

Measures how much CPU and memory Robin (`apps/bots/music-py`) needs when it is
run **from source** and renders Discord audio. It answers the sizing question
for the retired weighted-CPU pool and for Render's free instance.

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

- `verdict.measured_per_stream_core` — measured core-seconds per stream, taken
  from the configured 2-session level, worst repeat.
- `verdict.required_cores_with_safety` — `sessions × per-stream × safety_factor`.
- `verdict.required_memory_mb` — idle import + FFmpeg per session + yt-dlp
  transient + memory headroom.
- `pool.required_shares` — the shares that yield that CPU under full contention
  in the retired 9-CPU / 12 544-share pool (and the 8 448-share hosted-TTS
  variant).
- `render_free.max_streams_at_50_percent` — how many streams Render free's
  0.1 CPU can sustain with 50 % headroom.
- `smooth_capacity` — largest tested concurrency with zero frames more than
  100 ms late and real-time throughput ≥ 0.99.

Use the **worst** repeat, not the best. A `max_late_100ms_frames` value above
zero means a frame missed a typical jitter buffer; that is an underrun risk, not
a cosmetic delay. CPU is a proxy: real DAVE encryption, UDP send and gateway
traffic are excluded, which is why the scenario applies a safety factor.

## Isolation and repository rules

This harness is loopback-only and refuses credential-bearing environments. Do
not run it against a live bot container or the phone's active sessions. Commit
only the small JSON/CSV summaries and the audit report; keep unbounded logs and
audio copies out of Git.
