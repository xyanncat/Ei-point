"""Download and verify the pinned Pocket TTS runtime assets (gated weights + tokenizer).

Run once during provisioning with an accepted Hugging Face account. The token is
read from HF_TOKEN (or the standard huggingface_hub token file) and is never
printed or written to the repository. The service then runs with
HF_HUB_OFFLINE=1 against this cache.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

MODEL_REPO = "kyutai/pocket-tts"
TOKENIZER_REPO = "kyutai/pocket-tts-without-voice-cloning"
DEFAULT_MODEL_REVISION = "983151f13aaeab1b13c1e5e3c2c383d49a9edf3f"
DEFAULT_TOKENIZER_REVISION = "00eac05ed3d16bdc3f6b5d598874019c34a89214"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--revision", default=DEFAULT_MODEL_REVISION)
    parser.add_argument("--tokenizer-revision", default=DEFAULT_TOKENIZER_REVISION)
    args = parser.parse_args()
    cache_dir = args.cache_dir.resolve()
    (cache_dir / "hub").mkdir(parents=True, exist_ok=True)
    token = os.environ.get("HF_TOKEN") or None

    files = {}
    try:
        model_path = hf_hub_download(
            repo_id=MODEL_REPO,
            filename="languages/english/model.safetensors",
            revision=args.revision,
            cache_dir=str(cache_dir / "hub"),
            token=token,
        )
        tokenizer_path = hf_hub_download(
            repo_id=TOKENIZER_REPO,
            filename="languages/english/tokenizer.json",
            revision=args.tokenizer_revision,
            cache_dir=str(cache_dir / "hub"),
            token=token,
        )
    except Exception as exc:
        print(f"Pocket asset download failed ({type(exc).__name__}); check the gated-repository access and HF_TOKEN", file=sys.stderr)
        raise SystemExit(1) from exc

    for label, path in (("model", Path(model_path)), ("tokenizer", Path(tokenizer_path))):
        if not path.is_file() or path.stat().st_size < 1:
            raise SystemExit(f"Pocket {label} file is missing or empty")
        files[label] = {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256(path)}

    manifest = {
        "version": 1,
        "engine": "pocket-tts",
        "package_version": "3.3.0",
        "model_repo": MODEL_REPO,
        "model_revision": args.revision,
        "tokenizer_repo": TOKENIZER_REPO,
        "tokenizer_revision": args.tokenizer_revision,
        "files": files,
    }
    manifest_path = cache_dir / "ei-point-pocket.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.chmod(manifest_path, 0o600)
    print(json.dumps({"ok": True, "manifest": str(manifest_path), "model_revision": args.revision}))


if __name__ == "__main__":
    main()
