# Ei Point VPS — production-safe model latency assessment

Date: 2026-10-20 (owner local date). VPS clock during measurements:
**2026-10-19T22:42:20Z – 22:43:33Z** (UTC; owner local +03:00 = 2026-10-20 01:42–01:43).

Status: **diagnostic only**. No application, Compose, `.env`, systemd, kernel, model,
database, or dependency changes. No restarts, rebuilds, deploys, installs, or image pulls.
Active probe budget: **2 of 2 used** (one TTS, one translation, sequential). No Discord
voice joins, messages, or moderation/economy actions.

## Authorization and method

Authorized by the owner's safe-benchmark prompt. Passive discovery first; active probes only
after every admission gate passed. Measurements are spot checks, not capacity evidence.

Skills whose actual instructions were read: the five defaults (`verification-before-completion`,
`systematic-debugging`, `deep-research`, `ponytail`, `discord-bots`) plus `local-llms`,
`performance-profiling`, `monitoring`, `runbooks`. External research was not performed in this
task (search backend unavailable); official sources cited below are from the earlier tracked
review. No unavailable skill was claimed.

## Deployment under test

- Root `/opt/ei-point`, Compose project `ei-point`, revision `ac6e2f7`.
- Model images: TTS `sha256:28669f909420f336e0ebb20548dec6822183bc2cbb47eaf76a15b4e82c75c050`,
  Hy-MT2 `sha256:73e36d019cd86b8d4363e380b135becfb16124c2b56ebdd6d7a403bbe5246b80`.
- Both containers `RestartCount=0`, healthy.

## Findings

| Area | Observed evidence |
|---|---|
| Guest CPU | `Model name: Common KVM processor`; `Hypervisor vendor: KVM`; `Virtualization type: full`; 10 vCPU |
| CPU features | `/proc/cpuinfo` flags contain **none** of `sse4_1`, `sse4_2`, `avx`, `avx2`, `fma`, `avx512f` |
| Effective CPU limits | TTS: `NanoCpus=0`, `CpuQuota=0`, `CpuShares=8192`, no cpuset, parent `ei-point.slice`; Hy-MT2: shares 2048, parent slice. Slice: `cpu.max=900000 100000` (9 CPU), `cpu.weight=100` |
| Throttling | Slice `cpu.stat`: `nr_throttled 0`, `throttled_usec 0` (baseline and after probes) |
| TTS runtime | Qwen3-TTS 12 Hz 0.6B Base, pinned revision `5d83992436eae1d760afd27aff78a71d676296fc`; torch 2.9.1+cpu, CPU FP32; `oneDNN disabled (cpu capability DEFAULT, mode auto)`; 8 torch threads; queue max 2; request timeout 75 s, hard timeout default 105 s, stuck-exit 60 s; model/voice preloaded (`ready=1`) |
| Translation runtime | Hy-MT2 1.8B **Q4_K_M** (1,133,080,448 bytes), `llama-server`, ctx 2048, `--parallel 1`, `--threads 4 --threads-batch 4`, `--n-predict 700` |
| Baseline health | 13/13 containers healthy, model restarts 0, no deploy/backup running |
| Baseline load | `vmstat 5 3`: idle **97 / 99 / 100 %**, steal 0, swap in/out 0; load 0.01; MemAvailable **59.9 GiB** of 67.4 GiB; no voice leases |
| Queue state before probes | TTS queue 0 / active 0 / cache 0; Hy-MT2 processing 0 / deferred 0 |

## Active probes (2/2, sequential, gate re-checked before each)

Gates passed at 22:42:20Z and again at 22:43:04Z (TTS idle, translation idle, 0 leases,
≥50 % CPU idle, load < 5, MemAvailable > 20 % and > 4 GiB, no swap, no throttling).

**TTS — `Hello there.`, voice `default`, WAV** (`/v1/audio/speech`, from the bot network
namespace):
- HTTP 200; headers 9.562 s; total 9.563 s; 46,124 bytes; 48,000 Hz; audio **0.96 s**.
- End-to-end RTF **9.96** (wall time / audio duration).
- Cache: **MISS** (hits 0 → 0, misses 0 → 1); inference seconds 0 → 9.5315, count 0 → 1.
- Queue 0 before/after; CPU during probe: idle 21 %, user 78 % (≈8 cores), steal 0.
- This is a full-WAV response; header time is **not** proof of time-to-first-playable-audio.

**Translation — “Hello, how are you?” → French**, production prompt/sampling, `max_tokens=64`:
- HTTP 200; **total 5.185 s**; output `Bonjour, comment allez-vous ?`.
- Usage: prompt 51 tokens, completion 9, total 60; `cached_tokens=3`.
- Prompt processing: 48 tokens in 4,261.9 ms → **88.8 ms/token (11.3 tok/s)**.
- Decode: 9 tokens in 896.0 ms → **112.0 ms/token (8.9 tok/s)**.
- Queue: processing 0 / deferred 0 before and after; CPU during probe: idle 60 %, user 39 %
  (≈4 cores), steal 0.

After both: both models idle, queue 0, 0 voice leases, no error/timeout log lines in the
window, restarts still 0, `nr_throttled 0`.

## Prior recorded measurements (same VM, earlier today — not re-run in this task)

| Measurement | Value | Context |
|---|---|---|
| TTS 39-char samples | 16.91 s / 16.20 s; audio 3.36 / 3.12 s; RTF **5.03 / 5.19** | earlier container generation, same 8-thread config |
| TTS repeated identical text | 0.0025 s | cache hit |
| TTS first speech chunk (39-char sentence) | 14.11 s | chunked voice path, full synthesis of first sentence |
| TTS short “Hello there.” (prior) | 9.35 s | earlier run |
| Translation, 2 threads | 3.82 s, 217 ms/token | before the 4-thread change |
| Translation, 4 threads | 1.52 s, 111 ms/token | same text family as this probe |

These are recorded observations from the same host, not fresh evidence from this assessment;
revision/config differed slightly (pre-redeploy TTS image).

## Interpretation (ranked)

1. **CPU feature exposure is the dominant cause.** The guest exposes a baseline QEMU CPU
   without SSE4.1/AVX/FMA, so PyTorch runs scalar CPU FP32 and oneDNN cannot be used
   (capability `DEFAULT`). Both models are compute-bound: TTS ≈10× real-time; translation
   spends 82 % of its 5.19 s in prompt prefill at 88.8 ms/token.
2. **Not queueing, memory, swap, disk, or throttling.** Queues were empty, models preloaded,
   59.9 GiB available, no swap activity, no cgroup throttling, and the slice used only a
   fraction of its 9-CPU quota during probes.
3. **Thread settings are working within the scalar limit.** During probes TTS consumed ≈8
   cores (8 threads) and translation ≈4 cores (4 threads); more threads cannot substitute for
   missing SIMD, though a small sweep may still help the prefill phase.
4. **Contract limits perceived latency.** The TTS endpoint returns a complete WAV, so no
   incremental synthesis exists; sentence chunking only shortens the wait for later audio.
   Translation is single-slot (`--parallel 1`), which is fine at current idle load.

## Recommended next steps (not implemented)

1. **Ask the provider to expose a modern CPU model / host-passthrough** (SSE4.2, AVX2, FMA).
   This is provider/hypervisor-controlled, has migration implications, and should be proven in
   a staging VM before any production change. It is the largest plausible win.
2. **In an isolated environment, benchmark runtime knobs against the current baseline:**
   `QWEN_TTS_MKLDNN=off` vs `on` (only meaningful once features are exposed), TTS threads
   4/6/8, Hy-MT2 threads 4/6, with identical texts, warm model, and cache status recorded.
   Do not assume FP16/BF16 helps on CPU; measure.
3. **TTS engineering options:** evaluate a truly streaming TTS contract or a smaller
   CPU-oriented engine (Pocket TTS is a candidate) only after checking official current code,
   model licence, language coverage and streaming support — published numbers are not VPS
   measurements. Keep the existing Cyrene voice contract if changed.
4. **Keep Hy-MT2 at 4 threads** (measured ≈2× better than 2) and retain prompt caching;
   production `max_tokens=700` was not changed (64 was probe-only).
5. **Keep the 9-CPU slice and weighted shares**; no contention was observed. A quiet-window
   test can compare 6 translation threads and the TTS 4/8 thread choice with one reload each.

## Follow-up test plan (isolated or explicitly approved quiet window)

- Matrix: current CPU vs provider-passthrough (if offered); TTS threads 4/6/8; MKLDNN auto/on;
  Hy-MT2 threads 4/6. Three sequential samples per cell, warm model, record cache status.
- Measure TTS: queue delay, synthesis seconds, audio seconds, end-to-end RTF, and first-chunk
  wall time for the chunked voice path (TTFA only if a streaming path exists).
- Measure translation: prompt/decode/total milliseconds, token counts, cached tokens.
- Stop conditions: any production request, queue > 0, lease > 0, CPU idle < 30 %, memory
  pressure, or a timeout.
- Acceptance targets are proposed, not achieved: TTS RTF < 2 and a 50-token translation
  < 2 s would still require CPU features or a different engine.

## Reproducibility (safe commands)

```sh
# passive
lscpu | grep -E 'Model name|Hypervisor vendor|Virtualization type|^CPU\(s\):'
grep -m1 '^flags' /proc/cpuinfo | grep -oE 'sse4_1|sse4_2|avx2|avx512f|fma|avx' | sort -u
docker inspect ei-point-tts-qwen-1 --format '{{.HostConfig.CpuShares}} {{.HostConfig.NanoCpus}} {{.HostConfig.CgroupParent}}'
cat /sys/fs/cgroup/ei.slice/ei-point.slice/cpu.max
vmstat 5 3
docker exec ei-point-tts-qwen-1 python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:3120/metrics').read().decode())"  # bounded metrics
```

Probes used Node `fetch` from the bot-ai container against the internal `QWEN_TTS_URL` and
`HY_MT2_URL` (120 s client limit), with WAV header parsing for audio duration. HTTP statuses
were 200/200. Shell exit codes were not individually captured; command completion was confirmed
by the printed end markers. Temporary `vmstat` samples live under `/tmp` only.

## Limitations

- One request per model; no p50/p95, no concurrency, no soak, no voice-quality claim.
- Translation had 3 prompt-cache tokens; TTS was a genuine cache miss after the fresh container.
- Production traffic could arrive between observations; the second gate was re-checked.
- VPS clock is UTC 2026-10-19 while the owner's local date is 2026-10-20.
- External research was unavailable (search backend error); official links are carried from the
  tracked review: QEMU CPU models, PyTorch MKLDNN, Qwen3-TTS, Hy-MT2 GGUF. Pocket TTS was not
  verified or downloaded here.

## Final state

13/13 services healthy; model restarts 0; TTS ready/queue 0/active 0, cache hits 0/misses 1;
Hy-MT2 processing 0/deferred 0; 0 voice leases; slice `nr_throttled 0`; no error/timeout log
lines in the observation window. No application or configuration changes were made. Side
effects: one TTS cache entry and one translation prompt-cache entry, plus metrics counters.
