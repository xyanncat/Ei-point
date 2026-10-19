# DeepSeek branch review and local-model latency

Reviewed on 2026-10-20. Source: `origin/feat/completion-plan` at `f5de21e`, fetched from origin. `origin/main` remains at `9864875`. Reviewed files were extracted into `tmp/deepseek-review-f5de21e`; this review did not switch or reset the primary checkout. During review the primary checkout was updated externally to `e2fcf8b`; a comparison confirmed no changes between `f5de21e` and that revision in the reviewed model, TTS, bot UI, Compose and resource-validator paths.

This is a focused review of inference, TTS playback, resource/release wiring, and shared Components V2. The branch changes 259 files relative to main; this report does not certify every change or independently verify the current VPS.

## Conclusion

The branch contains useful repairs, but it does not establish that the latency objective is met. Its own deployment report records 9.35 seconds for "Hello there.", 32.04 seconds for 109 characters, a 14.11-second first speech chunk, and 10.8 seconds for a short translation. These are measurements reported by the prior agent, not fresh VPS measurements in this review. Cold/warm status, repetitions, queue delay, and inference-stage timing are not adequately established by that report.

Small model size makes deployment more practical; it does not guarantee low time to first audio, total speech-generation time, or translation latency. The physical server name also does not prove which instruction features, vCPUs, CPU time, memory bandwidth, and accelerated kernels a VM can use.

## Findings

### [P1] Pooling change conflicts with the supported release validator

`infra/docker/compose.yml` now uses `cpu_shares` and memory limits, with per-service `limits.cpus` removed. `scripts/check-resource-budget.mjs:55` still requires both `limits.cpus` and memory to extract any resource values. `scripts/deploy.sh` invokes this checker against the rendered release before proceeding.

Reproduced using the new TTS configuration shape: `serviceResourcesFromCompose` returned `{"tts-qwen":{}}`; validation rejected it with `tts-qwen: missing or invalid CPU/memory limits`. The documented manual `compose build/up` deployment does not demonstrate that the supported release procedure works.

Fix: reconcile the validator and resource contract with the approved pool model, verify a real aggregate CPU cap applies to Docker processes, preserve memory validation, and run rendered default/subset release checks. CPU shares are scheduling weights, not a maximum or a guaranteed allocation. Merely defining a systemd slice does not establish that the Docker containers belong to it.

### [P1] A stuck TTS generation is marked unhealthy but is not stopped or replaced

`apps/services/qwen-tts/src/main.py:428-438` changes `_worker_stuck` and readiness after the hard deadline. The actual model call runs in a thread; no process boundary, termination, or bounded model-worker replacement is implemented. `_worker_stuck` clears only when inference returns.

Independent reproduction with a blocked fake runtime: the request raised `RequestTimedOut`, readiness became false, the worker stayed alive, and inference remained active. If a real call never settles, this service cannot recover itself. Whether an external watchdog repairs it depends on actual deployment configuration. Docker's restart policy alone does not restart a still-running unhealthy process. The checked-in watchdog's fallback service list omits the models and defaults to `/srv/ei-point`; the report places this deployment in `/opt/ei-point`. A deployed release manifest/environment override may change that, but it must be verified.

Fix: supervise inference through a terminable worker process with bounded restart/backoff, or prove an existing external supervisor reliably replaces a stuck service while accounting for its capacity. Add a permanently blocked-inference recovery test, not only an unhealthy-state test. Do not increase timeouts as a performance fix.

### [P2] CPU-compatibility fallback disables optimized TTS kernels on every host

`apps/services/qwen-tts/src/main.py:242` unconditionally sets `torch.backends.mkldnn.enabled = False`. The rationale is a baseline-SSE2/no-AVX VM. Even after a provider restores modern CPU features, the application will continue to disable the backend. The model is explicitly CPU FP32 at line 250.

This is a concrete host-insensitive fallback; its exact performance cost has not been measured here. Confirm guest/container CPU flags and PyTorch capabilities first. On a compatible CPU, benchmark oneDNN enabled versus fallback using identical workloads. Keep the fallback available for verified incompatible hosts. Do not blindly use FP16/BF16 or assume support/performance from the physical CPU model alone.

### [P2] Chunking is still full generation per chunk; it does not meet a low-latency streaming contract

`apps/bots/ai/src/index.ts:72-90` splits text into at most 140-character chunks, awaits complete synthesis, starts playback, and prefetches the next chunk. `QwenRuntime.synthesize` uses the complete result of `generate_voice_clone`; the HTTP client buffers the response before playback.

The report's measured first chunk is 14.11 seconds. The change can reduce waiting for a long message, but does not remove the generation delay for the first chunk. Prefetch hides later generation only when that generation finishes before current audio playback ends. More chunks can repeat fixed per-request work and increase total processing. `/speak` still builds a complete downloadable file by design.

Fix: measure time to first playable audio and real-time factor, then assess supported incremental synthesis/decoding for the exact installed runtime while preserving the voice contract. Sentence chunking can remain a bounded fallback; do not label it true streaming. Do not assume GPU support is available, or that a GPU is the only possible improvement.

### [P2] Model CPU threads and useful timing evidence remain incomplete

Compose defaults remain `QWEN_TTS_TORCH_THREADS=1` and `HY_MT2_THREADS=2` despite the report's live TTS override of eight. OMP/MKL share the TTS value. The report does not prove translation's deployed thread count, compiled llama.cpp SIMD features, CPU throttling/steal time, or a thread-count sweep. These are investigation items, not proof that increasing threads will always help.

Measure each model alone and both together, with uncached, repeated/cached, and post-load requests separated. For TTS record queue delay, synthesis, audio duration, real-time factor, response transfer and playback startup. For translation record prompt/decode timings, input/output token counts and total response time. `max_tokens=700` is an output ceiling; it does not mean every translation generates 700 tokens. Do not shorten that limit blindly and truncate valid output.

## Hardware interpretation

The branch report describes a "no-AVX host". No fresh `lscpu`, CPU-flag, cgroup, or runtime capability output was available here to independently establish it. If the guest really lacks AVX/AVX2/FMA and other features available on its physical host, provider VM CPU-model settings are a plausible major bottleneck. Request provider review of the guest CPU model/feature exposure; this cannot generally be fixed by changing an application Docker flag. A host-model/passthrough decision belongs to the provider/hypervisor operator and may have migration implications.

Do not claim that a 9950X3D must achieve a specific latency or that 1-2 seconds necessarily requires a GPU. Establish the actual guest capabilities and benchmark appropriate CPU runtimes before deciding whether a different engine/model or GPU is needed.

Primary sources:

- [QEMU CPU-model and host-passthrough documentation](https://www.qemu.org/docs/master/system/qemu-cpu-models.html)
- [PyTorch MKLDNN backend](https://docs.pytorch.org/docs/stable/notes/mkldnn.html)
- [Qwen3-TTS official project](https://github.com/QwenLM/Qwen3-TTS)
- [Official Hy-MT2 1.8B GGUF model](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)

## Verification completed here

- Snapshot TTS TypeScript module: compiled and 19 tests passed.
- Snapshot Qwen Python service: 16 tests passed; these use fake inference, not the real model.
- Snapshot shared bot UI: compiled and 8 tests passed against the existing matching discord.js 14.27.0 dependency installation.
- Independent pooled-resource validation failure reproduced.
- Independent blocked-inference readiness/continuing-worker behavior reproduced.
- No real model weights were available in this local checkout, no live inference benchmark was run, and no production services/configuration were changed.

## VPS diagnostics and repair order

Run `python3 scripts/diagnose-local-models.py` on the VPS to inspect host flags, model-container resource controls, actual configured thread counts and fresh-process PyTorch capabilities. Add `--benchmark` for sequential real requests; this consumes inference CPU and may take several minutes. The last repeated input is explicitly a cache/warm-path probe, not proof of uncached performance. Header latency on a completed-WAV endpoint is not time to first playable audio.

1. Verify the deployed revision/images and actual VM CPU features. Inspect provider exposure if features are hidden.
2. Reconcile optimized CPU kernels and compatible runtime builds with the actual CPU; benchmark one change at a time.
3. Sweep thread settings and check cgroup throttling/host steal time under realistic concurrent workload.
4. Establish actual first-audio latency and throughput before changing chunk size or implementing supported streaming.
5. Implement bounded stuck-inference recovery and repair the release resource validator.
6. Rebuild/deploy through the corrected release path, rerun model measurements, and verify real Discord audio and translation quality.

No speculative CPU/precision change was applied to the primary checkout or VPS as part of this review.
