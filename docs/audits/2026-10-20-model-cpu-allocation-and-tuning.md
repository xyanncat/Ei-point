# Model CPU allocation and safe tuning — Qwen TTS & Hy-MT2

Date: 2026-10-20 (owner local). VPS clock: **2026-10-19T23:19:12–23:20:15Z**.
Status: **allocation verified non-restrictive; one justified candidate retained (Hy-MT2 4→6
threads) with measured per-token gains; TTS unchanged.** No hardware/provider change, no model
replacement, no TTS probes (existing evidence reused).

## Skills read

Five defaults (`verification-before-completion`, `systematic-debugging`, `deep-research`,
`ponytail`, `discord-bots`) plus `docker-best-practices`, `monitoring`, `local-llms`,
`performance-profiling`, `runbooks`, `release-management`, `code-review` and `error-handling`
(the latter three read earlier in the same session). No unavailable skill was claimed.

## Passive inspection (fresh)

Deployed revision **`02701c2`**; all services healthy.

| Control | TTS (qwen) | Hy-MT2 |
|---|---|---|
| Container CPU quota | `NanoCpus=0`, `CpuQuota=0`, `CpuPeriod=0` | same |
| CPU shares | **8192** | **2048** |
| Cpuset | empty (inherits all) | empty (inherits all) |
| Process affinity | **0–9** | **0–9** |
| Cgroup | `/ei.slice/ei-point.slice/docker-…scope` | same |
| Memory limit | 8 GiB | 4 GiB |
| Threads | 8 torch threads (40 OS threads) | 4→6 llama threads (17 OS threads) |
| Ancestor | slice `cpu.max=900000 100000` (9 CPU), `cpu.weight=100`, `cpuset.cpus.effective=0-9`; parent `ei.slice` `cpu.max=max`, cpuset `0-9` | same |

- Guest: **Common KVM processor**, 10 vCPU; `/proc/cpuinfo` exposes **none** of
  `sse4_1`, `sse4_2`, `avx`, `avx2`, `fma`, `avx512f`; PyTorch capability `DEFAULT`.
- Throttling: lifetime `nr_throttled=1`, `throttled_usec=405` (0.4 ms total across 10,241
  periods); **delta 0** during both measured requests. PSI CPU/memory `avg10/60/300 = 0.00`.
- Idle baseline (3 samples): CPU **97 / 99 / 100 % idle**, steal 0, no swap; load ~0;
  MemAvailable **59.4 GiB**.
- Queues/sessions: TTS queue 0 / inference 0; Hy-MT2 processing 0 / deferred 0; **0 voice leases**.

### Why the earlier “0 % CPU” is not a denied-core signal

CPU is near-idle before a request; during the earlier TTS probe it reached **21 % idle / 78 %
user** (≈7.8 CPU-equivalents on 10 vCPU). Docker stats percentages may exceed 100 % because
they are normalized to one core. Threads are scheduled on the 0–9 affinity; the nine-CPU slice
cap is a quota, not a reservation. There is **no cpuset or per-container quota restriction**.

## Classification

**No allocation bottleneck.** The measured limitation is the runtime/instruction exposure
(baseline QEMU vCPU without SSE4/AVX/FMA) plus normal threaded CPU work. High CPU use during
inference is expected; the objective is latency with responsive bots, not lower CPU use.
Thread sampling showed TTS ≈8 cores active and translation ≈4 cores with the old setting.

## Candidate experiment (one rollout, safe idle window)

- Window: 0 leases, empty queues, no deploy/backup, CPU 97–100 % idle, PSI 0, 59.4 GiB available.
- Change: **Hy-MT2 `--threads 6 --threads-batch 6`** (4→6) via `.env`, recreating **only**
  `hy-mt2`; TTS (8 threads) untouched; bots, PostgreSQL and TTS not restarted.
- Request budget: **one baseline + one candidate translation**, same synthetic prompt
  (“The morning train leaves at seven forty-five.”), same sampling/64-token cap; **no TTS
  requests** (existing valid TTS evidence reused). No retries/parallel load.

| Metric | Baseline (4 threads) | Candidate (6 threads) | Change |
|---|---:|---:|---:|
| Prompt tokens (cached) | 54 (41 cached) | 54 (0 cached) | restart cleared cache |
| Prompt per token | **90.64 ms** | **59.91 ms** | **−33.9 %** |
| Decode per token | **112.03 ms** | **79.13 ms** | **−29.4 %** |
| Decode tokens | 16 | 16 | equal |
| Wall total | 2.889 s (13 processed) | 4.452 s (54 processed) | not directly comparable |
| CPU during request | ~4 cores (60 % idle) | ~6 cores (38–42 % idle) | 6 threads scheduled |
| Throttle delta | 0 µs | 0 µs | none |

Wall totals differ because the baseline had 41 prompt tokens cached and the candidate started
with a cold cache after restart; the **per-token timings** are the comparable evidence. The
candidate improves prompt processing by ~34 % and decode by ~29 % with no throttling, both
models and the database healthy, queues empty and 0 sessions. This is a useful improvement for
interactive translation; the setting was retained.

## Persistent change / rollback

- Retained: `HY_MT2_THREADS=6` in the VPS `.env`; compose default now 6 and `.env.example` 6
  (`infra/docker/compose.yml`, `.env.example`).
- Running args verified: `--threads 6 --threads-batch 6 --parallel 1 --ctx-size 2048`.
- Rollback: set `HY_MT2_THREADS=4` in `.env` (or compose default) and recreate only
  `hy-mt2`; previous setting was 4. No migrations or data changes.

## Health and effects observed

- hy-mt2 healthy after the recreate (≤33 s), TTS/bot-ai/PostgreSQL untouched and healthy.
- Post-candidate queues: 0/0; 0 voice leases; no error logs; slice throttle delta 0.
- No bot latency measurement changed by this task; no sessions were interrupted.

## Remaining hypothesis / limits

- Hidden CPU features remain the dominant limitation; the provider’s guest CPU model
  (host-model/passthrough) is the only route to SSE4/AVX and was not changed here.
- Concurrent TTS (8 threads) + translation (6 threads) can exceed the nine-CPU slice and would
  be quota-shared; that contention was **not** stress-tested on production. A staging sweep
  (TTS 4/6/8, Hy-MT2 4/6/8, concurrent load) is the next justified experiment.
- One baseline + one candidate request, no p95/capacity claim; prompt-cache asymmetry was
  handled by comparing per-token timings.
- TTS threads remain 8 (application cap); reducing them has no measured benefit and no change
  was made.

## Sources

- Docker resource constraints: https://docs.docker.com/engine/containers/resource_constraints/
- QEMU CPU models: https://www.qemu.org/docs/master/system/qemu-cpu-models.html
- PyTorch MKLDNN notes: https://docs.pytorch.org/docs/stable/notes/mkldnn.html
- llama.cpp server options (threads/threads-batch): official llama.cpp server documentation.
