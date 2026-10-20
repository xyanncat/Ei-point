# Cyrene local Pocket TTS

Cyrene `/speak` and `/tts` synthesize through the private Compose service `tts`
(container `ei-point-tts-1`). The service is CPU-only, offline at runtime, and
conditioned on the owner-supplied Cyrene reference audio through a precomputed
safetensors voice state. It never downloads weights during a request and never
falls back to a hosted speech provider.

## Pinned artifacts

| Item | Value |
|---|---|
| Python package | `pocket-tts==3.3.0` (`[audio]` extra) |
| PyTorch | `2.9.1+cpu` (CPU index) |
| NumPy | `2.2.6` (X86 baseline; newer wheels require x86-64-v2 and fail on this vCPU) |
| Model config / revision | `english` / `983151f13aaeab1b13c1e5e3c2c383d49a9edf3f` |
| Voice state | `POCKET_TTS_VOICE_STATE_PATH`, sha256 `c053f46f4a4004f13da28a7e3af88a5b8c86f074db145d2b54fccf6db3de4028` |
| Sample format | 24 kHz mono 16-bit PCM WAV |
| Runtime threads | `POCKET_TTS_TORCH_THREADS=1` (measured; 2 threads is ~10–14 % faster but uses ~2× CPU) |

The weights and voice state live outside Git under `.models/` and are mounted
read-only. The voice state is derived from the private reference and is a
private asset; do not publish it.

## Provisioning

The model repository is gated on Hugging Face. Accept the model terms with the
approved account and provide `HF_TOKEN` only to the provisioning command; never
commit or print it.

```sh
export HF_TOKEN=...   # provisioning shell only
python scripts/prepare_pocket_model.py \
  --cache-dir /opt/ei-point/.models/pocket-hf-cache \
  --revision 983151f13aaeab1b13c1e5e3c2c383d49a9edf3f

docker run --rm \
  -v /opt/ei-point/.models/pocket-hf-cache:/models/hf-cache:ro \
  -v "/opt/ei-point/.models/cyrene-reference.mp3:/reference/cyrene-reference.mp3:ro" \
  -v /opt/ei-point/.models:/out \
  --entrypoint python ei-point/tts-pocket:local /app/prepare_voice.py \
  --reference /reference/cyrene-reference.mp3 \
  --output /out/pocket-cyrene-voice.safetensors \
  --metadata /out/pocket-cyrene-voice.json \
  --revision 983151f13aaeab1b13c1e5e3c2c383d49a9edf3f
chown 10001:10001 /opt/ei-point/.models/pocket-cyrene-voice.safetensors
chmod 600 /opt/ei-point/.models/pocket-cyrene-voice.safetensors
```

The service image sets `HF_HOME=/models/hf-cache` and `HF_HUB_OFFLINE=1`; the
runtime needs only the prepared cache and voice state.

## Runtime contract

- `POST /v1/audio/speech` with `{"text": "...", "voice": "default", "format": "wav"}`
  returns a complete WAV (the `/speak` media converter consumes this).
- `/tts` uses the same endpoint per bounded sentence chunk; the existing bot
  queue and `/leave` cleanup are unchanged.
- 500-character input cap, queue max 2, 75 s request timeout, 105 s hard timeout,
  60 s stuck-worker exit, 4 GiB memory, 4096 CPU shares, `ei-point.slice` cap.
- `/health/live`, `/health/ready`, and `/metrics` (`ei_tts_*`) expose readiness,
  queue depth, cache, failures, CPU and RSS. The Compose healthcheck gates
  deployment; the internal `tts` network is not exposed to the host.
- The model is loaded once and the exported voice state is loaded at startup;
  each request deep-copies the state and never re-enrolls the reference.

## Measured behavior on the Ei Point VPS

- `Hello there.` → 1.04 s audio in ~0.315 s; first chunk 0.074 s (1 thread).
- 58-character greeting → 4.56 s audio in ~1.21 s; first chunk 0.127 s.
- Production service request: 3.12 s audio in 0.867 s (~3.6× real time); WAV
  verified as 24 kHz mono PCM16.
- Peak RSS ≈ 0.76–1.4 GiB; no WAV clipping in the measured samples.

The owner reported that delivered audio sometimes sounds segmented and the
speaking pace feels fast. The generated WAVs measured the same duration as the
prior engine for the same sentence and showed no clipping; pacing/segmentation
tuning remains an explicit open acceptance item, not a solved claim.

## Failure and rollback

There is no second TTS engine. If the service fails, `/speak` and `/tts` return
the bounded "not ready" path while the container restarts under
`restart: unless-stopped`. To roll back, deploy the previously pinned `tts`
image and voice-state hash; do not point clients at a deleted service. The
reference MP3 is still tracked in this repository from earlier provisioning;
separate owner-approved remediation is required before any public release.
