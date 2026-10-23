import hashlib
import json
import struct
import tempfile
import unittest
import wave
from pathlib import Path

from prepare_dataset import DatasetError, validate_and_split, write_upstream_manifests


def make_wav(path: Path, seconds: float = 1.0, sample_rate: int = 24000, sample_value: int = 0) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(struct.pack("<h", sample_value) * int(seconds * sample_rate))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(path: Path, source: str, session: str, start: float = 0.0, duration: float = 1.0, **overrides):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    value = {
        "id": f"{source}-{start}",
        "source_id": source,
        "session_id": session,
        "path": str(path),
        "sha256": digest,
        "start_seconds": start,
        "end_seconds": start + duration,
        "duration_seconds": duration,
        "text": "hello there",
        "speaker": "Cyrene",
        "language": "en",
        "permission_basis": "owner-supplied",
    }
    value.update(overrides)
    return value


class DatasetValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = []
        for index in range(10):
            p = self.root / f"clip{index}.wav"
            make_wav(p, sample_value=index + 1)
            self.paths.append(p)

    def tearDown(self):
        self.tmp.cleanup()

    def records_for_five_sources(self):
        records = []
        for index, path in enumerate(self.paths):
            source = f"source{index // 2}"
            records.append(record(path, source, source, start=float(index % 2)))
        return records

    def test_groups_sources_and_writes_upstream_manifests(self):
        summary = validate_and_split(
            self.records_for_five_sources(), seed=7, min_unique_minutes=0.01, min_sources=5
        )
        self.assertEqual(summary["gate"], "ready", summary)
        self.assertGreater(summary["unique_seconds"], 0)
        splits = summary["splits"]
        seen = {}
        for split, ids in splits.items():
            for clip_id in ids:
                group = summary["clip_groups"][clip_id]
                if group in seen:
                    self.assertEqual(seen[group], split, "source group leaked across splits")
                else:
                    seen[group] = split
        out = self.root / "manifests"
        paths = write_upstream_manifests(summary, out)
        for path in paths.values():
            self.assertTrue(path.is_file())
            rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
            for row in rows:
                self.assertEqual(set(row), {"path", "duration", "transcript"})
                self.assertTrue(Path(row["path"]).is_file())
                self.assertGreater(row["duration"], 0)

    def test_missing_file_is_rejected(self):
        records = self.records_for_five_sources()
        records[0]["path"] = str(self.root / "missing.wav")
        with self.assertRaises(DatasetError) as caught:
            validate_and_split(records, seed=7, min_unique_minutes=0.01)
        self.assertEqual(caught.exception.code, "missing_audio")

    def test_duplicate_audio_is_rejected(self):
        records = self.records_for_five_sources()
        records[1]["path"] = records[0]["path"]
        records[1]["sha256"] = records[0]["sha256"]
        with self.assertRaises(DatasetError) as caught:
            validate_and_split(records, seed=7, min_unique_minutes=0.01)
        self.assertEqual(caught.exception.code, "duplicate_audio")

    def test_overlapping_clips_in_one_source_are_rejected(self):
        records = self.records_for_five_sources()
        records[1]["start_seconds"] = 0.5
        records[1]["end_seconds"] = 1.5
        records[1]["duration_seconds"] = 1.0
        with self.assertRaises(DatasetError) as caught:
            validate_and_split(records, seed=7, min_unique_minutes=0.01)
        self.assertEqual(caught.exception.code, "overlapping_clip")

    def test_empty_transcript_is_rejected(self):
        records = self.records_for_five_sources()
        records[0]["text"] = "   "
        with self.assertRaises(DatasetError) as caught:
            validate_and_split(records, seed=7, min_unique_minutes=0.01)
        self.assertEqual(caught.exception.code, "invalid_transcript")

    def test_missing_permission_or_non_english_is_rejected(self):
        records = self.records_for_five_sources()
        records[0]["permission_basis"] = ""
        with self.assertRaises(DatasetError) as caught:
            validate_and_split(records, seed=7, min_unique_minutes=0.01)
        self.assertEqual(caught.exception.code, "missing_permission")
        records = self.records_for_five_sources()
        records[0]["language"] = "fr"
        with self.assertRaises(DatasetError) as caught:
            validate_and_split(records, seed=7, min_unique_minutes=0.01)
        self.assertEqual(caught.exception.code, "unsupported_language")

    def test_insufficient_minutes_returns_gate_not_a_training_manifest(self):
        summary = validate_and_split(self.records_for_five_sources(), seed=7)
        self.assertEqual(summary["gate"], "insufficient_data", summary)
        self.assertEqual(summary["splits"], {})
        with self.assertRaises(DatasetError):
            write_upstream_manifests(summary, self.root / "blocked")

    def test_too_few_sources_returns_gate(self):
        records = [record(self.paths[0], "source0", "source0"), record(self.paths[1], "source1", "source1")]
        summary = validate_and_split(records, seed=7, min_unique_minutes=0.01, min_sources=5)
        self.assertEqual(summary["gate"], "insufficient_sources", summary)
        self.assertEqual(summary["splits"], {})


if __name__ == "__main__":
    unittest.main()
