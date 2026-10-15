#!/usr/bin/env python3
"""Provision and checksum a pinned local Qwen3-TTS model snapshot.

This is an explicit one-time operator command. The inference service never
downloads weights and only starts ready after validating this manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def create_manifest(model_dir: Path, revision: str) -> dict[str, Any]:
    files: dict[str, dict[str, Any]] = {}
    for path in sorted(model_dir.rglob("*")):
        relative = path.relative_to(model_dir)
        if ".cache" in relative.parts:
            continue
        if path.is_symlink():
            raise RuntimeError("model snapshots must not contain symlinks")
        if path.is_file():
            files[relative.as_posix()] = {"bytes": path.stat().st_size, "sha256": file_sha256(path)}
    if not files or "config.json" not in files:
        raise RuntimeError("downloaded model directory is incomplete")
    return {"version": 1, "model_id": MODEL_ID, "revision": revision, "files": files}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="Pinned 40-character Hugging Face commit SHA")
    parser.add_argument("--output", required=True, type=Path, help="Empty local directory for model weights")
    args = parser.parse_args()
    revision = args.revision.strip().lower()
    if not REVISION_PATTERN.fullmatch(revision):
        parser.error("--revision must be a 40-character hexadecimal commit SHA")
    output = args.output.expanduser().resolve()
    manifest_path = output / "ei-point-model.json"
    if manifest_path.exists():
        raise SystemExit("Refusing to overwrite an existing model manifest")
    output.mkdir(parents=True, exist_ok=True)
    if any(path for path in output.iterdir() if path.name != ".cache"):
        raise SystemExit("Output directory must be empty; use a new directory for each revision")

    # Import only for this explicit provisioning command. Runtime uses offline
    # local_files_only loading and performs no network access.
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=MODEL_ID, revision=revision, local_dir=str(output))
    manifest = create_manifest(output, revision)
    temporary = output / ".ei-point-model.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(manifest_path)
    print(f"Prepared {MODEL_ID}@{revision}; {len(manifest['files'])} files checked and pinned.")


if __name__ == "__main__":
    main()
