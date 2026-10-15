# Cyrene local Qwen TTS

Cyrene `/speak` and `/tts` send text to a private local service running Qwen3-TTS 12Hz 0.6B Base. The service clones from the configured local reference clip and transcript, uses Qwen's automatic language detection, returns 16-bit PCM WAV, and cannot reach the public network. It does not use a speech-provider API key or silently switch to an external inference endpoint. `/tts` reads new voice-channel **text chat** messages; it does not transcribe spoken audio.

Cyrene chat uses the supplied role-play memory mounted read-only in `bot-ai`. The bot selects its character, personality, relationship, spoiler-awareness, intent, and boundary sections for the system message; sample replies and reference links are omitted to keep each request bounded. This selected persona context is not persisted in the conversation tables. The supplied TTS memory informs text cleanup and QA guidance. Qwen3-TTS Base accepts the audio reference and matching transcript, but the current Base inference path does not expose the memory file as emotion/style controls. This voice guidance does not certify that generated audio matches an official performance.

## Provision the model once

The Compose service does not download weights. Provision a specific Hugging Face commit outside container startup using Python 3.12:

```sh
python3.12 -m venv .venv-qwen-provision
. .venv-qwen-provision/bin/activate
python -m pip install -r scripts/requirements-qwen-model.txt
```

Resolve the current model commit and review the model card/license before downloading. The model repository is `Qwen/Qwen3-TTS-12Hz-0.6B-Base`; the command below expects the full 40-character commit SHA rather than a moving branch name:

```sh
python -c "from huggingface_hub import model_info; print(model_info('Qwen/Qwen3-TTS-12Hz-0.6B-Base').sha)"
python scripts/prepare_qwen_model.py --revision <40-character-commit-sha> --output .models/qwen3-tts-12hz-0.6b-base
```

The explicit provisioning command downloads the selected snapshot and writes `ei-point-model.json` with per-file SHA-256 checksums. At service startup, every listed file is verified, the configured revision must match the manifest, and the loader is forced to use local files and safetensors. The service reports not-ready if the directory, checksum manifest, revision, or reference audio is missing or invalid.

If model weights or the reference clip are updated after the service starts, restart `tts-qwen` to validate the new files and rebuild the in-memory voice-clone prompt.

## Add the voice reference

Copy the supplied reference audio to a private path on the host, such as `.models/cyrene-reference.mp3`, or set `CYRENE_REFERENCE_AUDIO_PATH` to its actual absolute path. Keep the file out of Git and mount it read-only. The default transcript is the calibration text in the product spec:

> Ah, there you are! Hehe, were you looking for me? Oh, don't look so surprised. I'm simply happy you're here. You know, even the smallest moments can become precious memories. So, shall we make another one together?

Confirm that this transcript exactly matches the mounted clip. If it does not, set `QWEN_TTS_REFERENCE_TEXT` to the correct transcript; reference mismatch can reduce voice quality.

The service runs as uid/gid `10001`. On a Linux host, make the model tree readable by that group without making it public, and make only the reference file group-readable:

```sh
sudo chown -R root:10001 /srv/ei-point/models/qwen3-tts-12hz-0.6b-base
sudo chmod -R g+rX,o-rwx /srv/ei-point/models/qwen3-tts-12hz-0.6b-base
sudo chown root:10001 /srv/ei-point/private
sudo chmod 0750 /srv/ei-point/private
sudo chown root:10001 /srv/ei-point/private/cyrene-reference.mp3
sudo chmod 0640 /srv/ei-point/private/cyrene-reference.mp3
```

Set the model revision and host paths in `.env`:

```dotenv
QWEN_TTS_MODEL_PATH=/srv/ei-point/models/qwen3-tts-12hz-0.6b-base
QWEN_TTS_MODEL_REVISION=<the-same-40-character-commit-sha>
CYRENE_REFERENCE_AUDIO_PATH=/srv/ei-point/private/cyrene-reference.mp3
QWEN_TTS_TORCH_THREADS=1
QWEN_TTS_QUEUE_MAX=2
QWEN_TTS_REQUEST_TIMEOUT_SECONDS=75
```

The Docker service mounts both directories read-only, drops Linux capabilities, uses an internal-only network shared with Cyrene, binds diagnostics to loopback, and has an initial resource cap of 0.75 CPU / 8 GiB. The CPU cap is a starting budget, not a performance claim; the project requires all bot/model allocations to remain inside the 8-core / 40-GiB VPS envelope.

## Build and check

Build/publish `apps/services/qwen-tts/Dockerfile` with the rest of the release and include its immutable digest under `tts-qwen` in the release manifest. The deployment starts the model service separately because loading can take longer than normal app health checks, then waits for model readiness during the release health gate.

Local health endpoints:

- `GET http://127.0.0.1:3120/health/live` — process is running.
- `GET http://127.0.0.1:3120/health/ready` — weights and reference prompt loaded and verified.
- `GET http://127.0.0.1:3120/metrics` — model load and inference times, process CPU/RSS, request outcomes, queue depth/capacity, and bounded-cache size/hits.

The TTS API accepts up to 500 characters, allows one active model worker and a bounded waiting queue, returns `429` when overloaded and `504` on a synthesis deadline. Requests that time out before starting are discarded. The bot allows up to 90 seconds for synthesis; the local service deadline is configured separately and should be lower. Repeated text may reuse a checksum-keyed WAV response in a 64 MiB / 256-entry / one-hour in-memory cache. Release manifests that include `tts-qwen` also wire the legacy provider variables for older bot images, which can request MP3; the local service transcodes that response while current images request WAV. A rollback manifest from before Qwen leaves the existing legacy provider URL configuration intact. Text is not logged or embedded in cache keys.

The repository has deterministic service tests and TypeScript integration checks, but source tests do not establish actual model quality, CPU compatibility, memory peaks, time-to-first-audio, real-time factor, Discord playback, or contention with other bots. Those remain target-VPS and staging acceptance gates. The current development workstation has no Docker runtime and no pinned model files, so a clean container build and real synthesis must be completed on a Linux build host before release.

Generated voice is synthetic output based on the supplied reference. Do not label it as official game dialogue or claim it is the original performer.
