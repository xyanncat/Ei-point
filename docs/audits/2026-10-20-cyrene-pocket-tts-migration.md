# Cyrene Pocket TTS migration and Qwen removal — 2026-10-20

Status: **Pocket 6-layer is the only TTS engine; Qwen 3 TTS 0.6B is removed
from the runtime, images, model assets, Compose, env, code, CI and active
docs. Pace is accepted at 0.90; the owner reports that the clone still does
not sound like Cyrene. That clone-quality item is OPEN, not accepted.**
Source revision: `544fdd1` (both `main` and `feat/completion-plan`). VPS
checkout `/opt/ei-point` at `544fdd1`. No Qwen fallback remains.

## Engine and deployment

| Item | Value |
|---|---|
| Service | Compose `tts` / `ei-point-tts-1`; bot-ai `TTS_URL=http://tts:3120/v1/audio/speech` |
| Image | `sha256:ca7197c801c9a3413bbc16cfa30b9020358e99a914477edfb171944c218864d8` |
| bot-ai image | `sha256:f9169b661009fff0f2bb1ebbf447d6dd6b3b4c34fb775ae9d1e76964569db124` |
| Pocket package | `pocket-tts==3.3.0` (`[audio]`), PyTorch `2.9.1+cpu`, NumPy `2.2.6` |
| Model | English 6-layer, revision `983151f13aaeab1b13c1e5e3c2c383d49a9edf3f` |
| Voice state | original reference state, sha256 `c053f46f4a4004f13da28a7e3af88a5b8c86f074db145d2b54fccf6db3de4028` |
| Pacing | `POCKET_TTS_TEMPO=0.90`, pitch-preserving `atempo` |
| Threads / bounds | 1 torch thread, 4096 CPU shares, 4 GiB, queue 2, 75 s request / 105 s hard timeout |
| Output | 24 kHz mono PCM16 WAV; `/speak` converts to the existing V2 MP4 card |

The service disables oneDNN only when PyTorch reports `DEFAULT` (this VM has no
SSE4/AVX); NumPy is pinned to 2.2.6 because newer wheels require x86-64-v2.

## Qwen removal evidence

- `docker ps -a | grep -i qwen` → none; `docker images | grep -i qwen` → none.
- Qwen container and image deleted; `.models/qwen3-tts-12hz-0.6b-base` (2.4 GB)
  deleted; `find .models -iname '*qwen*'` → none.
- `docker compose config --services` has `tts`, no `tts-qwen`; the fallback
  Compose block was deleted.
- `.env` has zero `QWEN_TTS` keys; Qwen code/tests, `prepare_qwen_model.py`, the
  Qwen operations guide, backup asset and verifier/CI gate were removed.
- Active docs now reference Pocket; historical audit and prompt files still
  mention the removed engine as records. If "completely everywhere" includes
  those history files, they need a separate history purge; they do not affect
  the runtime.

## Preserved product contracts

- `/speak` still returns the inline-playable Components V2 MP4 container; the
  media converter consumes the same bounded WAV.
- `/tts` still reads only new text messages from the joined voice channel's text
  chat; `/leave` still cancels, clears the queue, disconnects and releases the
  lease. Short messages now use one Pocket request; only text over 140
  characters splits into bounded sentence chunks.
- Hy-MT2, its 6-thread setting, permissions, command registration, queues,
  personas and session caps are unchanged.
- No Qwen or second TTS engine remains; a Pocket failure is handled by the
  supervised container restart and the bot's bounded "not ready" path.

## Measurements

| Measurement | Result |
|---|---|
| Pocket smoke, 6-layer, 1 thread | `Hello there.` 1.04 s audio / 0.315 s, first chunk 0.074 s; 58-char line 4.56 s / 1.21 s, first chunk 0.127 s; ~3.7× real-time |
| Production service | 3.12 s audio in 0.867 s; 149,804-byte WAV; 24 kHz mono |
| Pacing | `atempo=0.900`: 2.56 s → 2.84 s for the same line; owner accepted the pace |
| Memory / CPU | ~764 MiB idle to ~1.4 GiB peak; 4 GiB limit; no WAV clipping |
| Qwen removal | 2.4 GB model + image removed; no Qwen process |

## Clone-quality experiments (all reverted)

The reference MP3 is clean: 15.569 s, 44.1 kHz mono, peak -3.19 dB, RMS
-20.2 dB, noise floor -78.3 dB, no clipping. Reference surgery was therefore
unlikely to fix timbre.

1. **Silence-trimmed reference** (13.155 s; state hash `4c9adfe8…`): output for
   the greeting shortened to 4.18 s and risked the accepted pace. Reverted.
2. **24-layer English model** (1.3 GB; state hash `864c3668…`; 1.56 GiB RSS):
   generated 4.89 s audio in 3.39 s, but the owner judged it **not closer** and
   it was slower. Candidate container/state removed; 6-layer restored.

The owner's verdict after both: pace good, **clone still does not feel like
Cyrene**, and clarity/disturbance is a concern. Pocket's 100M clone is an
approximation on this reference; no further Pocket-only change was retained.
A closer clone would require a different engine or an owner-approved new model,
not more thread/tempo tuning.

## Rollback

- Previous Pocket image/voice state can be redeployed from local images; the
  original voice state remains at `.models/pocket-cyrene-voice.safetensors`
  (hash `c053…`).
- There is **no Qwen rollback**; Qwen assets were deleted by owner instruction.
- If the clone is unacceptable, the next decision is engine replacement, not a
  Qwen restore.

## Pending / limitations

- Owner audible acceptance of the clone and clarity: **pending**.
- The reference MP3 was already tracked in the repository from earlier
  provisioning; this is a private-audio exposure requiring separate
  owner-approved remediation (not rewritten here).
- Historical Qwen audit/prompt records remain; active configuration is
  Qwen-free.
- No stress/load test was run; no claim of perfect cloning or sub-second
  latency.

## Verification run

- Pocket service tests: 14 tests OK (1 skipped).
- Operations/release/resource/verify/durable tests: 38 tests OK.
- bot-ai `tsc` and selected bot tests pass.
- `tts` and bot-ai healthy; `TTS_URL` points at `http://tts:3120`; readiness
  returns `{"ready":true}`.
