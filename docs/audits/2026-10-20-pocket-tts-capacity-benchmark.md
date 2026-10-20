# Pocket TTS capacity benchmark — passive baseline and blocked load test

Date: **2026-10-20**. VPS passive window: approximately **01:58–02:04 UTC**
(exact `date -u` line was lost with the provider console; the provider xterm
tokens were issued at 01:58:50Z and 02:03:59Z). Source revision: **`995fc1f`**.
Benchmark mode: **LIVE-PASSIVE only**. No production service was restarted,
tuned or redeployed. No synthetic inference was sent.

Status:

- **Modes A (passive): executed.**
- **Mode B (tiny live probes): BLOCKED by loss of provider console before any
  request; 0 inference requests sent.**
- **Mode C (load/stress/spike/saturation/soak): BLOCKED by lack of a verified
  isolated staging host, and additionally by console access. Not run.**

Consequently there is **no measured maximum sustainable goodput, no saturation
throughput, no first-audio/MP4/translation timing and no active-user capacity
claim** from this run. The harness is prepared and self-tested; the numbers
below are baseline-only.

## Deployment verified

The live checkout was clean at `/opt/ei-point`, `995fc1f`; 13/13 containers
healthy; no Qwen container, image or model; bot-ai points at the Pocket `tts`
service.

| Item | Value |
|---|---|
| Pocket service | `tts` / `ei-point-tts-1`; image `sha256:ca7197c8…` |
| bot-ai | `sha256:f9169b66…`; `TTS_URL=http://tts:3120/v1/audio/speech` |
| Pocket / Torch / NumPy | `3.3.0` / `2.9.1+cpu` / `2.2.6` |
| Hy-MT2 | image `sha256:73e36d01…`, `--threads 6 --threads-batch 6 --parallel 1 --ctx-size 2048` |
| PostgreSQL | `17.5`, image `sha256:f33b1c4b…` |
| Node / FFmpeg | `v24.8.0` / `5.1.9` |
| TTS controls | 1 torch thread, 4096 shares, 4 GiB, no per-container CPU quota, cpuset empty |
| GPU | none visible/used |

`/tts` and `/speak` are both wired to this Pocket endpoint. The owner's prior
functional check accepted the 0.90 pace; clone similarity/clarity is still an
open product item. No Qwen alias is serving.

## CPU allocation and observed CPU

- **Fresh cgroup facts:** `ei-point.slice` `cpu.max=900000 100000` (9 CPU),
  `cpu.weight=100`, `cpuset.cpus.effective=0-9`; ancestor `ei.slice`
  `cpu.max=max`, cpuset `0-9`.
- **Fresh container facts:** TTS shares **4096**, Hy-MT2 shares **2048**, no
  `NanoCpus`/quota, no cpuset, both parent `ei-point.slice`; process affinity
  **0–9**; threads 20 (TTS) and 19 (Hy-MT2). Memory limits 4 GiB each.
- **Fresh samples:** `vmstat` idle **98–100%**, user **0–2%**, system **0–2%**,
  steal 0; load `0.02 0.04 0.05`; 0.3 CPU-seconds used over 10 s by the whole
  slice (~0.33% of the 9-CPU budget).
- **Throttling:** lifetime `nr_throttled=2`, `throttled_usec=5214` (5.2 ms);
  no load was applied, so this is historical, not present throttling. The
  interval delta was not captured before the console loss.
- **CPU features:** fresh `lscpu` model/feature lines were not retained in the
  bounded terminal buffer. The same deployment previously exposed 10 vCPU,
  **Common KVM processor, no SSE4.1/SSE4.2/AVX/AVX2/FMA**, PyTorch capability
  `DEFAULT`, and the Pocket service starts with oneDNN disabled. Treat the
  model/feature line as prior same-host evidence, not a re-sampled quote.

**Interpretation:** the nine-CPU slice is not currently throttling idle work and
the processes have affinity to all 10 vCPUs. No CPU allocation bottleneck is
observed in the passive window. This says nothing about saturation behavior.

## Memory

| Observation | Value |
|---|---:|
| Host RAM / used / free | 62.8 GiB / 3.8 GiB / 21.6 GiB |
| MemAvailable | **59.0 GiB** |
| Swap used | 0 |
| CPU/memory/I/O PSI avg10 | 0.00 / 0.00 / 0.00 |
| Slice memory.current / peak | 1.47 GiB / **8.41 GiB** (peak historical) |
| TTS memory.current / peak | 679 MiB / **932 MiB** |
| TTS cgroup OOM events | 0 |
| Docker RSS: TTS / Hy-MT2 / bot-ai / DB | 679 / 199 / 55 / 97 MiB |

Shared-page double counting is possible in summed container RSS. The slice peak
of 8.41 GiB is historical and does not prove a per-request Pocket peak. No memory
growth test was run; no memory-bandwidth (STREAM-like) test was run because no
isolated environment exists. Physical DDR generation/speed is unknown and not
inferred from free memory.

## Storage and I/O

- `/` is **ext4**, `rw,relatime,discard,errors=remount-ro`; 492 GiB total,
  **84 GiB used / 389 GiB free (18%)**, inodes 6%.
- Docker: 16 images (6.536 GB, 203 MB reclaimable), 4 volumes (157.8 MB),
  **60.01 GB build cache (53.72 GB reclaimable)**. `.models` is 2.9 GB.
- Existing logs are small: TTS 3,248 B, bot-ai 119 B, Hy-MT2 3,600 B.
- No deploy lock, no active deploy/backup process. The `pgrep` line that
  mentioned `pgbackrest` was the PostgreSQL archive-command process line, not an
  active backup.
- I/O pressure avg10 0.00; no fio, dd, filesystem or raw-device test was run.
  The physical SSD/backend and IOPS are **unknown**; cached microbenchmarks
  would not establish them. Isolated disposable storage is not available.

## Queues, health and local latency

At baseline:

- TTS: `ready=1`, queue **0**, active **0**, success **0**, cache hits/misses
  **0/0** (service had been restarted before this window; no probe followed).
- Hy-MT2: processing **0**, deferred **0**.
- Voice leases **0**; DB active connections **0**.
- 13/13 containers healthy; no restarts/OOM.
- Internal health GETs: TTS min/median/max **1.3 / 1.4 / 26.9 ms** over five
  requests (one outlier); Hy-MT2 **0.6 / 1.1 / 1.7 ms**. These are not model
  inference timings.

## Live probes: blocked, zero requests

The safety gate passed before any probe: 13/13 healthy, no active TTS/MT work,
0 leases, no deploy/backup, ~98–100% idle, no swap/pressure, 59 GiB available.
However, the provider serial console stopped returning a shell before the first
request. xTerm showed `starting serial terminal on interface serial0` with no
prompt; a fresh session and noVNC both failed; there is no SSH route from the
local workstation and no provider API. The terminal was not usable for commands.

**No inference request was sent.** TTS counters remained success 0, cache 0/0.
The attempted setup did not reach the model. Therefore:

- first-audio, first playable audio, generation, HTTP and total latency:
  **unmeasured**;
- `/speak` MP4 conversion/upload and Discord playback: **unmeasured**;
- Hy-MT2 prompt/decode/total timings: **unmeasured**;
- response-cache effects: **unmeasured**;
- no 429/timeout/queue observations.

Prior same-config measurements from earlier tasks are comparison inputs only,
not results of this benchmark.

## Capacity / stress: blocked, not run

There is no second host or verified isolated staging deployment. A second
Compose project on the live VPS shares CPU, memory bandwidth, storage and
network and is explicitly not full isolation. Testing the live `ei-point.slice`
at 100% is forbidden by the task. Therefore:

| Metric | Result |
|---|---|
| Maximum tested sustainable goodput | **not established** |
| First saturated/failed rate | **not established** |
| Saturation throughput | **not run** |
| Spike/recovery/soak | **not run** |
| 100%-budget plateau | **not run**; no isolated test budget |
| Active-user estimate | **not computed**; no safe RPS |

The active-user formula is only `safe successful RPS / requests per active user
per second`; without a measured safe RPS no number is defensible. Do not turn
this report into a Discord-member limit.

## Reproducible harness (ready, not run against production)

- `bench/pocket_capacity/runner.py` — open-loop, bounded in-flight, staged
  schedule, status/goodput/queue/error accounting, abort guards.
- `bench/pocket_capacity/scenario.example.json` — declared smoke/warm/normal/
  25%-ramp/saturation/spike/soak stages, synthetic public texts, SLOs, limits
  and assumption labels. Replace staging hostnames and verify isolation.
- `bench/pocket_capacity/README.md` — isolation requirements, commands, stop
  conditions and interpretation.

Validation: `python runner.py --self-test` passed with **4/4 successful**
requests against a local mock (no live model), offered 5 RPS, duration 1 s,
p50 34.46 ms, 0 errors. The runner requires `EI_BENCH_ISOLATED=1`, refuses
`--execute` otherwise, and denies known production hosts (`100.77.131.20`,
`tts`, `hy-mt2`, `bot-ai`, `postgres`, localhost).

The planned 100% test remains a **ready-to-run plan**, not a result.

## Final health and Git

- Last verified live state: **13/13 healthy**, 0 queues/leases, no deploy lock.
- No production action or inference occurred after that baseline. The final
  Docker health comparison is **pending** because the provider console became
  unavailable; the provider panel still shows the server running, but that is
  not a substitute for service health.
- Source checkout was synchronized to `995fc1f` before the passive window. The
  new harness/report commit is pushed to Git; pulling it into `/opt/ei-point` is
  **pending console access**. No models, bots, database or sessions were
  restarted; no production tuning/redeployment occurred.
- Raw terminal output and any private audio were not committed; the report and
  evidence JSON are sanitized. The evidence file is
  `docs/audits/evidence/2026-10-20-pocket-capacity/live-passive.json`.

## What would unblock the measurements

1. Restore provider console (or an isolated staging host with SSH).
2. Run the four tiny probes only when the gate passes, with the exact endpoints
   and bounded client; record headers/body/decoded WAV separately.
3. Run the harness on a separate staging host, starting with smoke, then warm,
   normal and the explicit ramp plateaus; stop at the first SLO/queue/headroom
   breach. The 100% plateau is allowed only in that isolated budget for <=60 s.
4. Re-check 13/13 health, restarts, leases, queues and resource headroom after
   the probes/soak, and record the source revision separately from the running
   images.

No claim of “stable under load” or a member capacity is made from this run.
