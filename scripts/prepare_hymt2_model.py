#!/usr/bin/env python3
"""Provision one pinned Hy-MT2 GGUF file and record its revision and checksum."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

MODEL_ID = "tencent/Hy-MT2-1.8B-GGUF"
MODEL_FILE = "Hy-MT2-1.8B-Q4_K_M.gguf"
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="Pinned 40-character Hugging Face commit SHA")
    parser.add_argument("--output", required=True, type=Path, help="Empty local directory for the model file")
    args = parser.parse_args()
    revision = args.revision.strip().lower()
    if not REVISION_PATTERN.fullmatch(revision):
        parser.error("--revision must be a 40-character hexadecimal commit SHA")
    output = args.output.expanduser().resolve()
    manifest = output / "ei-point-model.json"
    if manifest.exists():
        raise SystemExit("Refusing to overwrite an existing model manifest")
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise SystemExit("Output directory must be empty; choose a new directory for each revision")

    from huggingface_hub import hf_hub_download

    cached = Path(hf_hub_download(repo_id=MODEL_ID, filename=MODEL_FILE, revision=revision))
    target = output / MODEL_FILE
    shutil.copyfile(cached, target)
    checksum = sha256(target)
    metadata = {
        "version": 1,
        "model_id": MODEL_ID,
        "revision": revision,
        "file": MODEL_FILE,
        "bytes": target.stat().st_size,
        "sha256": checksum,
        "quantization": "Q4_K_M",
    }
    (output / "ei-point-model.sha256").write_text(f"{checksum}  {MODEL_FILE}\n", encoding="ascii")
    temporary = output / ".ei-point-model.json.tmp"
    temporary.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(manifest)
    print(f"Prepared {MODEL_ID}@{revision}; SHA-256 {checksum}")


if __name__ == "__main__":
    main()
