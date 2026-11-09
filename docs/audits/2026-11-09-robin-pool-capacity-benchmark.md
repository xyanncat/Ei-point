# Robin music playback capacity and pool sizing — 2026-11-09

**Scope:** Robin the music bot (`apps/bots/music-py`) run from source. Measured
its real music playback path — FFmpeg decode → volume → Opus encode — plus the
source import footprint and the bounded yt-dlp resolution/download subprocesses.
No Discord gateway, UDP send, DAVE encryption, audible playback, target phone or
Render instance was used. Robin has no TTS path; the TTS references below are
only about whether Cyrene's separate TTS service shares the old CPU pool.

**Status:** benchmark complete on a shared Windows development host. The result
is a **sizing range and a conservative recommendation**, not a target-host
certification. Nothing was deployed; no production service, token, database or
active music session was touched.

## Answer first

Robin's standalone requirement for the configured two simultaneous music
sessions (`MAX_VOICE_SESSIONS = 2` and the `ai.voice_leases` fleet limit of 2):

| Requirement | Measured | Provision |
|---|---:|---:|
| CPU per stream | 0.273–0.278 core sustained | — |
| CPU for 2 streams | 0.546–0.556 core | **1.2 CPU** (hard) |
| Memory (idle + 2 FFmpeg + yt-dlp transient + 25 %) | **224.6 MB** | **512 MB** |
| DB connections | **1** (not a pool) | 1 |
| Music-session cap | **2** | 2 |
| Render free instance (0.1 CPU / 512 MB) | **not sufficient** | phone or a paid host with ≥1.2 CPU |

That is the whole answer. Robin needs **1.2 dedicated CPU and 512 MB** for the
two-session policy. There is no Cyrene/TTS dependency in that number.

### Legacy 9-CPU pool conversion (optional)

The old VPS weighted-share model is retired and is **not** part of Robin's
requirement. If it were restored, shares are relative weights, so the share
count needed for 1.11 core depends on the pool denominator:

- 12 544-share pool (Cyrene's TTS service present): **1 600 shares**.
- 8 448-share pool (Cyrene's TTS service absent): **1 088 shares**.

The only difference is what else is in the pool; the numerator is Robin's
1.11-core requirement either way. The old `bot-music` allocation of 512 shares
gave about **0.367 core under full contention** — 66 % of the measured
two-stream load (0.556 core), so it was under-sized. Do not read the Cyrene
figures as a Robin dependency.

## What was measured

| Stage | Code path |
|---|---|
| `idle` | `import main` from source: discord.py 2.7.1, yt-dlp, psycopg, 19 commands, no gateway login |
| `stream` | `discord.FFmpegPCMAudio` → `PCMVolumeTransformer(0.7)` → `discord.opus.Encoder`, 20 ms / 3 840-byte frames, real-time cadence |
| `extract` | exact bounded `yt-dlp --dump-single-json --skip-download` command from `extract_tracks` |
| `download` | exact bounded yt-dlp cache download from `download_media` (50 MiB item cap, 30 s task cap) |
| `env` | host, Python, FFmpeg, discord.py, Opus build, git revision, source/media SHA-256 |

Input media: `apps/dashboard/public/media/loop.mp3`, 160 kbps MP3, 149.3 s,
SHA-256 `c12f9d9167ca251628c2ca24f2e06017d29d37d4db7587bd943b6f8e788cfc67`.
The yt-dlp stages served the same file over loopback; no remote host was used.

## Environment

| Item | Value |
|---|---|
| Host | Windows 11, Intel Core i5-1334U, 10 physical / 12 logical CPUs |
| CPU clock | 1 300 MHz nominal (`psutil.cpu_freq().max = 1 300`) |
| RAM | 16 068.7 MB |
| Python | 3.12.15 |
| FFmpeg | 9.0.2-full_build-www.gyan.dev |
| discord.py | 2.7.1 |
| Opus | `libopus 1.3.1-18-g923bebde-dirty-fixed` (discord.py's bundled x64 DLL) |
| Source revision | `cba9a40c096a358c239e26f4d14167877d845b9a` |
| `main.py` SHA-256 | `0565b1c76f9682478081d83aca873c97571cb29cbcd23c022da715dc02e4e606` |
| Co-tenant load | **~67 % system CPU** during the sustained runs (other desktop/agent processes) |

The co-tenant load matters: the short burst runs saw 0.108–0.149 core/stream,
while the two 60 s runs measured 0.273 and 0.278 core/stream at 67 % system
load. SMT/cache contention on a busy laptop inflates the same work. The sizing
uses the **worst sustained** value; a quiet target host may do better.

## Stream results

30 s runs, three repeats per level:

| Streams | Per-stream core (median / max) | Total core (max) | Real-time ratio (min) | p99 lateness (median) | Max lateness | Frames >100 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.131 / 0.148 | 0.148 | 0.9951 | 56.3 ms | 259.7 ms | 97 |
| 2 | 0.140 / 0.149 | 0.299 | 0.9914 | 41.5 ms | 219.3 ms | 110 |
| 4 | 0.169 / 0.180 | 0.719 | 0.9921 | 19.7 ms | 50.9 ms | 0 |
| 6 | 0.212 / 0.230 | 1.379 | 0.9935 | 14.0 ms | 83.0 ms | 0 |

Sustained 60 s runs at the configured 2-session level:

| Run | Per-stream core | Total core | Real-time ratio | p99 lateness | Max lateness | Frames >100 ms | System CPU |
|---|---:|---:|---:|---:|---:|---:|---:|
| a | 0.2779 | 0.556 | 0.9988 | 11.7 ms | 22.2 ms | 0 | 67.1 % mean |
| b | 0.2732 | 0.546 | 0.9986 | 12.6 ms | 34.3 ms | 0 | 66.9 % mean |

The sustained runs are the sizing basis: **0.278 core/stream worst case**.
They stayed real-time with no >100 ms frame. The 30 s N=1 first run and N=2
second run hit isolated host stalls (259.7 ms and 219.3 ms, 207 frames >100 ms
total) while CPU was only 0.13–0.30 core. Those are host-scheduling events, not
CPU saturation; they are why the 30 s p99 values are not used for the sizing.

At 4 and 6 streams the process still kept real time (ratio ≥ 0.991), but the
back-to-back short runs pushed CPU to 0.72 and 1.38 core respectively. The
operational cap is 2, so those levels are headroom evidence only. Do not raise
`MAX_VOICE_SESSIONS` or the lease limit from this benchmark; Discord UDP/DAVE
and audible underruns were not tested.

## Startup, resolution and memory

| Stage | Wall | CPU | Peak RSS | Output |
|---|---:|---:|---:|---:|
| Source import | 2.638 s | 1.594 s | 62.2 MB | 19 commands; `MAX_VOICE_SESSIONS=2` |
| yt-dlp metadata | 2.273 s | 1.922 s | 59.3 MB | 2 602-byte JSON |
| yt-dlp download | 1.504 s | 1.328 s | 59.8 MB | 2 987 514 bytes |

Two concurrent streams add 57.7 MB of FFmpeg RSS. The memory derivation is:

```
62.2 MB (idle import)
+ 57.7 MB (two FFmpeg decoders)
+ 59.8 MB (one yt-dlp transient)
= 179.7 MB
× 1.25 headroom = 224.6 MB
```

512 MB is a comfortable floor; the old 2 GiB `bot-music` limit was ample. The
yt-dlp transients are bounded by the existing metadata semaphore (2), 30 s task
timeout and 50 MiB item cap.

## Hard CPU recommendation

```
required cores = 2 sessions × 0.2779 core/stream × 2.0 safety = 1.112 core
```

Set a hard limit of **`cpus: 1.2`** (2 sessions, 2× the measured sustained
load) and give the process at least **512 MB**. If the target host measures
closer to the 0.15-core burst figure, 0.6 core is the floor; the 1.2-core
figure is deliberately conservative because the benchmark host was shared and
slow-clocked.

### If the retired share pool returns (optional)

Using the retired resource-pool contract in
`scripts/check-resource-budget.mjs` at its pre-retirement revision (9-CPU
aggregate cap, weighted CFS shares):

```
1.112 / 9 × 12 544 = 1 549.5 → 1 600 shares (Cyrene TTS in the pool)
1.112 / 9 ×  8 448 = 1 043.2 → 1 088 shares (Cyrene TTS absent)

existing 512 shares = 512 / 12 544 × 9 = 0.367 core
  vs measured 2-stream load 0.556 core → 0.66×
  vs 1.112-core provision       → 0.33×
```

Again, the two share counts differ only because the pool denominator changes;
Robin's 1.112-core requirement is independent of Cyrene.

## Render free is not sufficient

Render free provides **0.1 CPU / 512 MB**.

- Memory: 224.6 MB measured requirement fits 512 MB.
- CPU: one stream already measured 0.13–0.28 core; two streams measured 0.546–
  0.556 core. At 0.1 CPU the benchmark computes **0 streams** even at 100 %
  utilisation, and 0 at 50 %. The free instance is not a smooth host for Robin.
- The phone remains the first choice, per `docs/operations/phone-hosting.md`.
  If Robin moves to Render, use a paid instance with at least **1.2 CPU and
  512 MB** (measured requirement plus margin), and re-run this harness there.

## Database pool answer

Robin does **not** use a connection pool. `init_db()` opens exactly one
`psycopg.connect(...)` connection and serialises access with `db_lock`
(`apps/bots/music-py/src/main.py`). Its Neon connection requirement is
therefore **1**, not the `max: 5` used by the Node bots. A second Robin process
would need one more connection; the current architecture runs one.

## Voice-session pool answer

The operational pool is **2 sessions**:

- `MAX_VOICE_SESSIONS = 2` in `main.py`;
- `reserve_voice_sync()` refuses when another owner already holds a lease and
  the count reaches 2 in `ai.voice_leases`;
- Cyrene shares the same `ai.voice_leases` table, so the 2-session cap is a
  fleet-wide admission limit, not a Robin CPU or TTS dependency.

The benchmark shows Robin's music playback path can keep real time beyond 2
streams on this host, but the pool capacity should be sized to the **2-session
policy**, not to the 6-stream experiment. Raising the cap is a separate change that needs
real Discord UDP/DAVE and audible acceptance.

## Limitations and open gates

- **Shared host:** ~67 % co-tenant CPU during the sustained runs. The 0.278
  core/stream figure is an upper-bound-in-practice; a quiet host may be lower.
  Re-run on the target phone/Render instance before freezing the allocation.
- **No Discord audio:** the gateway, UDP send, DAVE encryption and jitter buffer
  were not exercised. The 2× safety factor is intended to cover them, but it is
  not a substitute for audible playback.
- **No real YouTube/Spotify extraction:** the yt-dlp stages used a loopback MP3;
  extractor selector/network costs for real sites are not measured.
- **Windows Opus build:** discord.py loaded its bundled `libopus 1.3.1-dirty`
  DLL. The Linux image loads the system libopus from the FFmpeg package; the
  Windows number is not automatically the Linux/phone number.
- **30 s host stalls:** three short runs had isolated >100 ms frame stalls at
  low CPU. The sustained runs did not reproduce them, but a target-host soak is
  still required.
- **Laptop CPU:** 1.3 GHz nominal. Faster target cores would reduce CPU seconds;
  slower/throttling phone cores could increase them.

## Reproduce

```sh
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r apps/bots/music-py/requirements.txt psutil
ffmpeg -version

python bench/robin_capacity/runner.py --self-test
python bench/robin_capacity/runner.py --stage all --execute \
  --out bench/robin_capacity/results --concurrency-list 1,2,4,6 \
  --repeats 3 --seconds 30 --cooldown 10
```

The 60 s sustained runs used the same command with
`--stage stream --concurrency 2 --seconds 60`, saved as
`results/stream-2-4.json` and `results/stream-2-5.json` (`sustained: true`).
Recompute the summary after changing the scenario:

```sh
python bench/robin_capacity/runner.py --stage analyse \
  --out bench/robin_capacity/results
```

Artifacts: `bench/robin_capacity/results/{env,idle,extract,download,stream-*,summary}.json`
and `summary.csv`. No unbounded logs, tokens, private audio or model weights are
included.

## Deployment record

- Source-only benchmark. **Nothing was deployed, restarted or reconfigured.**
- Benchmark source revision: `cba9a40c096a358c239e26f4d14167877d845b9a`;
  `main.py` SHA-256 recorded above.
- Initial report and harness commit: `bcc2d9bb2213895f9b72e0c0307d5af29df6a1ee`
  (pushed to `main` and `feat/completion-plan`); the pool labels were clarified
  in the follow-up commit because the old pool names mentioned Cyrene's TTS
  service, not Robin.
- No production Discord token, database, payment provider or active session was
  used. The harness refuses credential-bearing environments and loopback only.
