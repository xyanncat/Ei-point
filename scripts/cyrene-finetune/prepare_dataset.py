#!/usr/bin/env python3
"""Validate, deduplicate and source-group split private Cyrene fine-tuning clips.

The input schemas are the project contracts in
`project assets/cred/fine tuning/DATASET.md`; the output is a converter to the
pinned Pocket training manifest (`path`, `duration`, `transcript`). It never
copies or publishes audio. Private inventories and manifests stay in the
private run directory.

Example:
    python prepare_dataset.py audit --clips private/clips.jsonl \
      --out private/split_summary.json
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import sys
import wave
from pathlib import Path
from typing import Any

DEFAULT_MIN_UNIQUE_MINUTES = 20.0
DEFAULT_MIN_SOURCES = 5
SUPPORTED_LANGUAGES = {"en", "eng", "english"}
REQUIRED_FIELDS = (
    "id", "source_id", "session_id", "path", "start_seconds",
    "end_seconds", "duration_seconds", "text", "speaker", "language",
    "permission_basis",
)


class DatasetError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.detail = detail


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _resolve(path_value: str, base_dir: Path | None) -> Path:
    path = Path(path_value)
    if not path.is_absolute() and base_dir is not None:
        path = base_dir / path
    return path.resolve()


def _wav_duration(path: Path) -> float | None:
    if path.suffix.lower() != ".wav":
        return None
    try:
        with wave.open(str(path), "rb") as handle:
            rate = handle.getframerate()
            return handle.getnframes() / rate if rate else None
    except (wave.Error, EOFError):
        return None


def _validate_record(record: dict[str, Any], base_dir: Path | None) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise DatasetError("invalid_record")
    missing = [field for field in REQUIRED_FIELDS if field not in record]
    if missing:
        raise DatasetError("missing_field", ",".join(missing))
    for field in ("id", "source_id", "session_id", "path", "speaker"):
        if not isinstance(record[field], str) or not record[field].strip():
            raise DatasetError("invalid_field", field)
    if not isinstance(record["text"], str) or not record["text"].strip():
        raise DatasetError("invalid_transcript", str(record["id"]))
    if not isinstance(record["permission_basis"], str) or not record["permission_basis"].strip():
        raise DatasetError("missing_permission", str(record["id"]))
    if not isinstance(record["language"], str) or not record["language"].strip():
        raise DatasetError("unsupported_language", str(record["id"]))
    text = record["text"].strip()
    if len(text) > 1000 or "\x00" in text:
        raise DatasetError("invalid_transcript", str(record["id"]))
    if record["language"].strip().lower() not in SUPPORTED_LANGUAGES:
        raise DatasetError("unsupported_language", str(record["id"]))
    try:
        start = float(record["start_seconds"])
        end = float(record["end_seconds"])
        duration = float(record["duration_seconds"])
    except (TypeError, ValueError) as exc:
        raise DatasetError("invalid_timing", str(record["id"])) from exc
    if duration <= 0 or end <= start or abs((end - start) - duration) > 0.05:
        raise DatasetError("invalid_timing", str(record["id"]))
    if duration < 0.25 or duration > 30.0:
        raise DatasetError("duration_out_of_bounds", str(record["id"]))
    path = _resolve(record["path"], base_dir)
    if not path.is_file():
        raise DatasetError("missing_audio", str(record["id"]))
    actual_hash = sha256(path)
    declared_hash = str(record.get("sha256") or "")
    if declared_hash and declared_hash != actual_hash:
        raise DatasetError("hash_mismatch", str(record["id"]))
    wav_duration = _wav_duration(path)
    if wav_duration is not None and abs(wav_duration - duration) > 0.25:
        raise DatasetError("wav_duration_mismatch", str(record["id"]))
    normalized = dict(record)
    normalized["path"] = str(path)
    normalized["sha256"] = actual_hash
    normalized["text"] = text
    normalized["start_seconds"] = start
    normalized["end_seconds"] = end
    normalized["duration_seconds"] = duration
    return normalized


def validate_and_split(
    records: list[dict[str, Any]],
    seed: int,
    *,
    base_dir: Path | None = None,
    min_unique_minutes: float = DEFAULT_MIN_UNIQUE_MINUTES,
    min_sources: int = DEFAULT_MIN_SOURCES,
) -> dict[str, Any]:
    """Validate clips and source-group split them; never guess missing data."""
    if not isinstance(records, list) or not records:
        raise DatasetError("no_records")
    if min_unique_minutes < 0:
        raise ValueError("min_unique_minutes must be >= 0")
    by_id: dict[str, dict[str, Any]] = {}
    by_hash: dict[str, str] = {}
    by_interval: dict[str, dict[str, Any]] = {}
    unique_seconds = 0.0
    for index, raw in enumerate(records):
        normalized = _validate_record(raw, base_dir)
        clip_id = normalized["id"]
        if clip_id in by_id:
            raise DatasetError("duplicate_id", clip_id)
        digest = normalized["sha256"]
        if digest in by_hash:
            raise DatasetError("duplicate_audio", clip_id)
        session_key = f"{normalized['source_id']}::{normalized['session_id']}"
        prior = by_interval.get(session_key)
        if prior is not None and normalized["start_seconds"] < prior["end_seconds"]:
            raise DatasetError("overlapping_clip", clip_id)
        by_interval[session_key] = normalized
        by_hash[digest] = clip_id
        by_id[clip_id] = normalized
        unique_seconds += normalized["duration_seconds"]

    groups = sorted({clip["source_id"] for clip in by_id.values()})
    summary: dict[str, Any] = {
        "gate": "pending",
        "unique_seconds": round(unique_seconds, 3),
        "unique_minutes": round(unique_seconds / 60.0, 3),
        "source_groups": len(groups),
        "session_groups": len({clip["session_id"] for clip in by_id.values()}),
        "clips": len(by_id),
        "clip_groups": {clip_id: clip["source_id"] for clip_id, clip in by_id.items()},
        "records": by_id,
        "splits": {},
        "reasons": [],
        "missing": {},
    }
    if unique_seconds / 60.0 < min_unique_minutes:
        summary["gate"] = "insufficient_data"
        summary["reasons"].append("unique_minutes_below_target")
        summary["missing"]["additional_unique_minutes"] = round(
            min_unique_minutes - unique_seconds / 60.0, 3
        )
        return summary
    if len(groups) < min_sources:
        summary["gate"] = "insufficient_sources"
        summary["reasons"].append("source_groups_below_minimum")
        summary["missing"]["additional_source_groups"] = min_sources - len(groups)
        return summary

    rng = random.Random(seed)
    rng.shuffle(groups)
    validation_groups = max(1, int(round(len(groups) * 0.1)))
    test_groups = max(1, int(round(len(groups) * 0.1)))
    train_groups = len(groups) - validation_groups - test_groups
    if train_groups < 1:
        summary["gate"] = "insufficient_sources"
        summary["reasons"].append("no_train_group_after_split")
        return summary
    split_groups = {
        "train": groups[:train_groups],
        "validation": groups[train_groups:train_groups + validation_groups],
        "test": groups[train_groups + validation_groups:],
    }
    summaries = {split: [] for split in ("train", "validation", "test")}
    for split, split_names in split_groups.items():
        for clip in by_id.values():
            if clip["source_id"] in split_names:
                summaries[split].append(clip["id"])
    summary["splits"] = summaries
    summary["split_groups"] = split_groups
    summary["gate"] = "ready"
    return summary


def write_upstream_manifests(summary: dict[str, Any], out_dir: Path) -> dict[str, Path]:
    if summary.get("gate") != "ready":
        raise DatasetError("gate_not_ready", str(summary.get("gate")))
    records = summary["records"]
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for split, filename in (
        ("train", "train_aligned.jsonl"),
        ("validation", "valid_aligned.jsonl"),
        ("test", "test_aligned.jsonl"),
    ):
        target = out_dir / filename
        with target.open("w", encoding="utf-8") as handle:
            for clip_id in summary["splits"][split]:
                clip = records[clip_id]
                handle.write(json.dumps({
                    "path": clip["path"],
                    "duration": clip["duration_seconds"],
                    "transcript": clip["text"],
                }, ensure_ascii=False) + "\n")
        paths[split] = target
    return paths


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    records = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetError("invalid_jsonl", str(line_no)) from exc
        records.append(value)
    return records


def _audit_cli(args: argparse.Namespace) -> int:
    records = _load_jsonl(args.clips)
    summary = validate_and_split(
        records,
        seed=args.seed,
        base_dir=args.base_dir,
        min_unique_minutes=args.min_minutes,
        min_sources=args.min_sources,
    )
    sanitized = {key: value for key, value in summary.items() if key not in {"records", "clip_groups"}}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(sanitized, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "gate": summary["gate"],
        "clips": summary["clips"],
        "unique_minutes": summary["unique_minutes"],
        "source_groups": summary["source_groups"],
        "reasons": summary["reasons"],
        "summary": str(args.out),
    }))
    return 0 if summary["gate"] == "ready" else 3


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    audit = sub.add_parser("audit")
    audit.add_argument("--clips", type=Path, required=True)
    audit.add_argument("--out", type=Path, required=True)
    audit.add_argument("--base-dir", type=Path)
    audit.add_argument("--seed", type=int, default=20261020)
    audit.add_argument("--min-minutes", type=float, default=DEFAULT_MIN_UNIQUE_MINUTES)
    audit.add_argument("--min-sources", type=int, default=DEFAULT_MIN_SOURCES)
    args = parser.parse_args()
    if args.command == "audit":
        return _audit_cli(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
