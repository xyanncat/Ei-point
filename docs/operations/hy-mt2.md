# Cyrene local Hy-MT2 translation

Cyrene `/translate` uses a private CPU-only `llama-server` process backed by Tencent's Hy-MT2 1.8B GGUF. The first deployment uses the official `Q4_K_M` quantization, mounted from the host and verified against a SHA-256 file before the server starts. The bot calls the local OpenAI-compatible endpoint over an internal Docker network. No translation API key or third-party inference endpoint is used, and model weights are never downloaded during service startup or a Discord command.

The model card documents the official GGUF endpoint and lists `Q4_K_M` at about 1.13 GB. This is a storage estimate, not a complete RAM budget or a performance claim. CPU compatibility, peak RSS, warm/cold timings, and translation quality still need measurements on the target VPS.

## Provision one pinned model snapshot

Install the one-time downloader in an isolated environment:

```sh
python3 -m venv .venv-hymt2-provision
. .venv-hymt2-provision/bin/activate
python -m pip install -r scripts/requirements-hy-mt2-model.txt
```

Resolve and review an upstream commit, then download that exact snapshot. Use its full 40-character commit SHA; do not use `main` in the command:

```sh
python -c "from huggingface_hub import model_info; print(model_info('tencent/Hy-MT2-1.8B-GGUF').sha)"
python scripts/prepare_hymt2_model.py --revision <40-character-commit-sha> --output .models/hy-mt2-1.8b
```

The script downloads only `Hy-MT2-1.8B-Q4_K_M.gguf` and writes `ei-point-model.json` plus `ei-point-model.sha256`. The model container verifies the checksum at every start and uses a read-only model mount. The model card identifies Apache-2.0 licensing; retain the upstream license and model revision with the host-side model files.

Make the files readable by the container's uid/gid `10001` on a Linux VPS:

```sh
sudo chown -R root:10001 /srv/ei-point/models/hy-mt2-1.8b
sudo chmod 0750 /srv/ei-point/models/hy-mt2-1.8b
sudo chmod 0640 /srv/ei-point/models/hy-mt2-1.8b/*
```

Set the model directory and conservative thread count in the protected host `.env`:

```dotenv
HY_MT2_MODEL_PATH=/srv/ei-point/models/hy-mt2-1.8b
HY_MT2_THREADS=2
```

The source bot chat persona is mounted separately at `CYRENE_PERSONA_MEMORY_FILE`. Keep that supplied memory file outside the image and Git, readable by the `bot-ai` container, and mounted read-only. The application limits it to 32 KiB and does not save its contents in conversation history.

## Runtime and limits

- `GET http://127.0.0.1:3121/health` reports `{"status":"ok"}` only after model load completes.
- `GET http://127.0.0.1:3121/metrics` exposes llama.cpp Prometheus metrics (token processing, latency/throughput, active/deferred requests and slot usage).
- The llama.cpp server has one model slot, a 2,048-token context, up to 700 generated tokens and two configurable CPU threads. The bot accepts 500 input characters, runs one inference at a time, queues at most eight requests and enforces a 60-second inference deadline.
- A full bot queue returns a retry message; a missing or unavailable local model returns a truthful not-ready response. Translation requests are not persisted or sent to the configured chat provider.
- The inference service has no external network route. Its diagnostic port is published only on the VPS loopback address (`127.0.0.1:3121`), so the host can query `/health` and `/metrics` while remote clients cannot connect through that port. Bot-to-model traffic stays on the internal Docker network. The container also has a read-only root filesystem/model mount, dropped Linux capabilities, and a 1.5 CPU / 4 GiB initial resource cap. Adjust only after target-host measurements while keeping the complete project within its 8-core / 40-GiB envelope.

Use ordinary language names such as `Arabic`, `English`, or `Japanese` for `target_language`. `source_language` can be omitted for automatic detection. The command replies in a public embed, as required for Cyrene's public command behavior.

## Build and qualify

Include the `hy-mt2` service image digest in the immutable release manifest. The deploy script waits for both local model services to become healthy before the remaining fleet health gate. That wait has a 15-minute ceiling; it is not a measured cold-start duration.

On the target CPU, measure initial model load time, peak RSS, prompt and generation throughput, translation latency for short and 500-character text, output quality across the required language pairs, and impact on Discord/API latency while other bots run. Repeat after a monthly restart and include a model-service restart test. Do not mark translation production-ready until these results meet the host budget.
