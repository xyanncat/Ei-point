"""Precompute the reusable Pocket TTS voice state from the private Cyrene MP3.

Run once during provisioning, in the Pocket image, with the reference audio and
the Hugging Face cache mounted. The service only loads the resulting
safetensors file at startup; it never re-enrolls the reference per message.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import torch

if torch.backends.cpu.get_cpu_capability().upper() == "DEFAULT":
    # oneDNN's SSE4.1 kernels are unavailable on this baseline vCPU.
    torch.backends.mkldnn.enabled = False

from pocket_tts import TTSModel
from pocket_tts.models.model_state import export_model_state

DEFAULT_REVISION = "7f364c05d1be3faf2b234cdbe4cbb68a026d4218"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--config", default="english")
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--threads", default=1, type=int)
    args = parser.parse_args()

    reference = args.reference
    if not reference.is_file() or reference.is_symlink():
        raise SystemExit("reference audio is missing or is a symlink")
    if reference.stat().st_size < 1024 or reference.stat().st_size > 32 * 1024 * 1024:
        raise SystemExit("reference audio size is outside the accepted bounds")
    reference_sha = sha256(reference)

    torch.set_num_threads(max(1, min(args.threads, 8)))
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass

    started = time.monotonic()
    model = TTSModel.load_model(language=args.config)
    if not getattr(model, "has_voice_cloning", False):
        raise SystemExit("Pocket voice-cloning weights are not available")
    state = model.get_state_for_audio_prompt(reference, truncate=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    export_model_state(state, args.output)
    os.chmod(args.output, 0o600)
    state_sha = sha256(args.output)

    metadata = {
        "pocket_tts_version": "3.3.0",
        "model_config": args.config,
        "model_revision": args.revision,
        "reference_sha256": reference_sha,
        "voice_state_sha256": state_sha,
        "voice_state_bytes": args.output.stat().st_size,
        "sample_rate": int(model.sample_rate),
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "reference-audio-conditioning",
        "conditioning_seconds": round(time.monotonic() - started, 3),
    }
    if args.metadata:
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        os.chmod(args.metadata, 0o600)
    print(json.dumps(metadata, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
