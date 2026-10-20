import hashlib
import io
import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import wave
from pathlib import Path
from unittest.mock import patch

from src.main import (
    BoundedAudioCache,
    BoundedHttpServer,
    InvalidRequest,
    QueueFull,
    RequestTimedOut,
    RuntimeState,
    TtsService,
    _apply_tempo,
    cache_key,
    make_handler,
    mkldnn_enabled,
    validate_request,
    verify_voice_state,
)


def make_wav(seconds: float = 0.1, sample_rate: int = 24000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * int(seconds * sample_rate))
    return output.getvalue()


class FakeRuntime:
    def __init__(self, gate=None):
        self.gate = gate
        self.calls = 0

    def snapshot(self):
        return RuntimeState(
            revision="a" * 40,
            voice_sha256="b" * 64,
            ready=True,
            model=object(),
            voice_state=object(),
        )

    def synthesize(self, text):
        self.calls += 1
        if self.gate is not None:
            self.gate.wait(timeout=2)
        return make_wav() + text.encode("utf-8")


class ValidateRequestTests(unittest.TestCase):
    def test_normalizes_text_and_voice(self):
        self.assertEqual(validate_request({"text": " hello\n  there ", "voice": "Cyrene!"}), ("hello there", "cyrene", "wav"))

    def test_rejects_empty_long_secret_and_bad_payloads(self):
        for value in (
            {"text": " "},
            {"text": "x" * 501},
            {"text": "mfa.abcdefghij1234567890"},
            {"text": "hi", "format": "ogg"},
            {"text": "hi", "format": []},
            "not-an-object",
        ):
            with self.subTest(value=str(value)[:30]), self.assertRaises(InvalidRequest):
                validate_request(value)


class CacheTests(unittest.TestCase):
    def test_keys_include_model_and_voice_identity_without_text(self):
        key = cache_key("a" * 40, "b" * 64, "default", "private user text")
        self.assertNotIn("private", key)
        self.assertNotEqual(key, cache_key("a" * 40, "c" * 64, "default", "private user text"))
        self.assertNotEqual(key, cache_key("d" * 40, "b" * 64, "default", "private user text"))
        self.assertNotEqual(key, cache_key("a" * 40, "b" * 64, "default", "private user text", tempo=0.9))

    def test_cache_is_size_and_entry_bounded(self):
        cache = BoundedAudioCache(max_bytes=5, ttl_seconds=10, max_entries=1)
        cache.put("one", b"1234")
        cache.put("two", b"5678")
        self.assertIsNone(cache.get("one"))
        self.assertEqual(cache.get("two"), b"5678")
        self.assertEqual(cache.snapshot(), (1, 4))

    def test_cache_expires_entries(self):
        cache = BoundedAudioCache(max_bytes=10, ttl_seconds=1)
        cache.put("one", b"audio")
        time.sleep(1.05)
        self.assertIsNone(cache.get("one"))
        self.assertEqual(cache.snapshot(), (0, 0))


class VoiceStateTests(unittest.TestCase):
    def test_accepts_matching_state_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "voice.safetensors"
            path.write_bytes(b"voice-state" * 200)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(verify_voice_state(path, digest), digest)
            with self.assertRaises(RuntimeError):
                verify_voice_state(path, "c" * 64)

    def test_rejects_missing_symlink_and_short_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            missing = root / "missing.safetensors"
            with self.assertRaises(RuntimeError):
                verify_voice_state(missing, "")
            short = root / "short.safetensors"
            short.write_bytes(b"x")
            with self.assertRaises(RuntimeError):
                verify_voice_state(short, "")
            target = root / "target.safetensors"
            target.write_bytes(b"x" * 2048)
            link = root / "link.safetensors"
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            with self.assertRaises(RuntimeError):
                verify_voice_state(link, "")


class ServiceQueueTests(unittest.TestCase):
    def test_synthesizes_and_reuses_cached_audio(self):
        runtime = FakeRuntime()
        service = TtsService(runtime, queue_max=1, request_timeout=1)
        service.start_worker()
        first = service.synthesize("hello", "default")
        second = service.synthesize("hello", "default")
        self.assertEqual(first, second)
        self.assertEqual(runtime.calls, 1)
        self.assertIn("ei_tts_cache_hits_total 1", service.metrics())
        self.assertIn("ei_tts_voice_state_info", service.metrics())

    def test_overload_is_rejected_without_an_unbounded_queue(self):
        gate = threading.Event()
        runtime = FakeRuntime(gate)
        service = TtsService(runtime, queue_max=1, request_timeout=2)
        service.start_worker()
        first_done = threading.Event()
        threading.Thread(target=lambda: (service.synthesize("first", "default"), first_done.set()), daemon=True).start()
        deadline = time.monotonic() + 1
        while runtime.calls == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        second_done = threading.Event()
        threading.Thread(target=lambda: (service.synthesize("second", "default"), second_done.set()), daemon=True).start()
        deadline = time.monotonic() + 1
        while service.queue.qsize() == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        with self.assertRaises(QueueFull):
            service.synthesize("third", "default")
        gate.set()
        self.assertTrue(first_done.wait(timeout=2))
        self.assertTrue(second_done.wait(timeout=2))

    def test_request_timeout_is_bounded(self):
        gate = threading.Event()
        service = TtsService(FakeRuntime(gate), queue_max=1, request_timeout=0.1)
        service.start_worker()
        with self.assertRaises(RequestTimedOut):
            service.synthesize("slow", "default")
        gate.set()


class HttpContractTests(unittest.TestCase):
    def setUp(self):
        self.runtime = FakeRuntime()
        self.service = TtsService(self.runtime, queue_max=2, request_timeout=2)
        self.service.start_worker()
        self.server = BoundedHttpServer(("127.0.0.1", 0), make_handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_health_and_speech_contract(self):
        with urllib.request.urlopen(self.base + "/health/live", timeout=2) as response:
            self.assertEqual(response.status, 200)
        with urllib.request.urlopen(self.base + "/health/ready", timeout=2) as response:
            self.assertEqual(response.status, 200)
        body = json.dumps({"text": "Hello there.", "voice": "default", "format": "wav"}).encode()
        request = urllib.request.Request(self.base + "/v1/audio/speech", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "audio/wav")
            self.assertTrue(response.read().startswith(b"RIFF"))

    def test_invalid_request_is_400(self):
        request = urllib.request.Request(
            self.base + "/v1/audio/speech",
            data=b'{"text":"","voice":"default"}',
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(caught.exception.code, 400)


class PolicyTests(unittest.TestCase):
    def test_mkldnn_policy_respects_default_capability(self):
        self.assertFalse(mkldnn_enabled("auto", "DEFAULT"))
        self.assertTrue(mkldnn_enabled("auto", "AVX2"))
        self.assertTrue(mkldnn_enabled("on", "DEFAULT"))
        self.assertFalse(mkldnn_enabled("off", "AVX2"))

    def test_tempo_filter_is_bounded_and_pitch_preserving(self):
        with patch("src.main.subprocess.run") as run:
            run.return_value.stdout = make_wav()
            output = _apply_tempo(make_wav(), 0.9)
            args = run.call_args.args[0]
            self.assertIn("rubberband=tempo=0.900:pitch=1.0", args)
            self.assertIn("pcm_s16le", args)
            self.assertEqual(output, make_wav())
        with self.assertRaises(RuntimeError):
            _apply_tempo(make_wav(), 0.4)


if __name__ == "__main__":
    unittest.main()
