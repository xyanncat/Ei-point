import hashlib
import json
import tempfile
import threading
import time
import sys
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from src.main import (
    BoundedAudioCache,
    BoundedHttpServer,
    InvalidRequest,
    ModelNotReady,
    QueueFull,
    RequestTimedOut,
    RuntimeState,
    ServiceDegraded,
    TtsService,
    QwenRuntime,
    cache_key,
    make_handler,
    validate_request,
    verify_model_manifest,
)


class FakeRuntime:
    def __init__(self, gate=None):
        self.gate = gate
        self.calls = 0

    def snapshot(self):
        return RuntimeState(revision="a" * 40, ready=True, model=object(), prompt=object())

    def synthesize(self, text):
        self.calls += 1
        if self.gate is not None:
            self.gate.wait(timeout=2)
        return b"RIFF\x00\x00\x00\x00WAVE" + text.encode("utf-8")


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
    def test_keys_do_not_disclose_text_and_cache_is_size_bounded(self):
        key = cache_key("a" * 40, "default", "private user text")
        self.assertNotIn("private", key)
        cache = BoundedAudioCache(max_bytes=5, ttl_seconds=10)
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

    def test_cache_entry_count_is_bounded_even_for_tiny_audio(self):
        cache = BoundedAudioCache(max_bytes=100, ttl_seconds=10, max_entries=1)
        cache.put("one", b"a")
        cache.put("two", b"b")
        self.assertEqual(cache.snapshot(), (1, 1))
        self.assertIsNone(cache.get("one"))


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

    def test_legacy_mp3_requests_are_transcoded_and_cached_separately(self):
        runtime = FakeRuntime()
        service = TtsService(runtime, queue_max=1, request_timeout=1)
        service.start_worker()
        with patch("src.main.subprocess.run") as run:
            run.return_value.stdout = b"ID3encoded-mp3"
            self.assertEqual(service.synthesize("hello", "default", "mp3"), b"ID3encoded-mp3")
            self.assertEqual(service.synthesize("hello", "default", "mp3"), b"ID3encoded-mp3")
            run.assert_called_once()
        self.assertEqual(runtime.calls, 1)
        self.assertNotEqual(cache_key("a" * 40, "default", "hello", "wav"), cache_key("a" * 40, "default", "hello", "mp3"))

    def test_overload_is_rejected_without_an_unbounded_queue(self):
        gate = threading.Event()
        runtime = FakeRuntime(gate)
        service = TtsService(runtime, queue_max=1, request_timeout=1)
        service.start_worker()
        first_done = threading.Event()
        thread = threading.Thread(target=lambda: (service.synthesize("first", "default"), first_done.set()), daemon=True)
        thread.start()
        deadline = time.monotonic() + 1
        while runtime.calls == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        second_done = threading.Event()
        second = threading.Thread(target=lambda: (service.synthesize("second", "default"), second_done.set()), daemon=True)
        second.start()
        deadline = time.monotonic() + 1
        while service.queue.qsize() == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        with self.assertRaises(QueueFull):
            service.synthesize("third", "default")
        gate.set()
        thread.join(timeout=1)
        second.join(timeout=1)
        self.assertTrue(first_done.is_set())
        self.assertTrue(second_done.is_set())
        self.assertLessEqual(service.queue.qsize(), 1)

    def test_timed_out_waiting_item_is_discarded_before_inference(self):
        gate = threading.Event()
        runtime = FakeRuntime(gate)
        service = TtsService(runtime, queue_max=1, request_timeout=0.1)
        service.start_worker()
        first_done = threading.Event()

        def first_call():
            try:
                service.synthesize("first", "default")
            except RequestTimedOut:
                first_done.set()

        first = threading.Thread(target=first_call, daemon=True)
        first.start()
        deadline = time.monotonic() + 1
        while runtime.calls == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        with self.assertRaises(RequestTimedOut):
            service.synthesize("abandoned", "default")
        gate.set()
        service.queue.join()
        first.join(timeout=1)
        self.assertTrue(first_done.is_set())
        self.assertEqual(runtime.calls, 1)


class HardInferenceSupervisionTests(unittest.TestCase):
    def test_stuck_inference_degrades_readiness_and_recovers_for_later_work(self):
        gate = threading.Event()
        runtime = FakeRuntime(gate)
        service = TtsService(runtime, queue_max=2, request_timeout=0.1, hard_timeout=0.3)
        service.start_worker()
        first = threading.Thread(target=lambda: _swallow_timeout(service, "stuck", "default"), daemon=True)
        first.start()
        deadline = time.monotonic() + 1
        while runtime.calls == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        # After the hard deadline the worker is considered stuck: readiness must degrade
        # and new work must be refused instead of silently queueing behind the hang.
        deadline = time.monotonic() + 2
        while service.snapshot_ready() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(service.snapshot_ready())
        self.assertTrue(service.worker_stuck)
        with self.assertRaises(ServiceDegraded):
            service.synthesize("second", "default")
        # Releasing the stuck inference restores bounded service and later work succeeds.
        gate.set()
        first.join(timeout=2)
        self.assertFalse(first.is_alive())
        deadline = time.monotonic() + 2
        while not service.snapshot_ready() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(service.snapshot_ready())
        self.assertEqual(service.synthesize("later", "default"), b"RIFF\x00\x00\x00\x00WAVE" + b"later")

    def test_repeated_inference_crashes_stay_bounded_and_the_worker_recovers(self):
        class CrashingRuntime(FakeRuntime):
            def __init__(self):
                super().__init__()
                self.fail = 2

            def synthesize(self, text):
                self.calls += 1
                if self.fail > 0:
                    self.fail -= 1
                    raise RuntimeError("transient-inference-crash")
                return b"RIFF\x00\x00\x00\x00WAVE" + text.encode("utf-8")

        runtime = CrashingRuntime()
        service = TtsService(runtime, queue_max=4, request_timeout=1, hard_timeout=1)
        service.start_worker()
        for i in range(2):
            with self.assertRaises(RuntimeError):
                service.synthesize(f"crash-{i}", "default")
        self.assertTrue(service.snapshot_ready())
        self.assertEqual(service.synthesize("after-crashes", "default"), b"RIFF\x00\x00\x00\x00WAVE" + b"after-crashes")
        self.assertIn('ei_tts_requests_total{result="failure"} 2', service.metrics())

    def test_shutdown_marks_not_ready_and_worker_exits(self):
        runtime = FakeRuntime()
        service = TtsService(runtime, queue_max=1, request_timeout=1, hard_timeout=1)
        service.start_worker()
        self.assertEqual(service.synthesize("hello", "default")[:4], b"RIFF")
        service.shutdown()
        self.assertFalse(service.snapshot_ready())
        with self.assertRaises(ModelNotReady):
            service.synthesize("after-shutdown", "default")
        service.wait_worker_stopped(timeout=2)
        self.assertFalse(service.worker_alive)


def _swallow_timeout(service, text, voice):
    try:
        service.synthesize(text, voice)
    except Exception:
        pass


class ModelManifestTests(unittest.TestCase):
    def test_manifest_checks_revision_and_file_digest(self):
        revision = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.json").write_text("{}", encoding="utf-8")
            digest = hashlib.sha256(b"{}").hexdigest()
            (root / "ei-point-model.json").write_text(
                json.dumps({
                    "version": 1,
                    "model_id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
                    "revision": revision,
                    "files": {"config.json": {"bytes": 2, "sha256": digest}},
                }),
                encoding="utf-8",
            )
            self.assertEqual(verify_model_manifest(root, revision)["revision"], revision)
            (root / "config.json").write_text("tampered", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "checksum"):
                verify_model_manifest(root, revision)


class QwenRuntimeTests(unittest.TestCase):
    def test_voice_clone_uses_model_language_detection(self):
        revision = "a" * 40
        runtime = QwenRuntime(Path("."), revision, Path("reference.wav"), "reference text", 1)
        calls = {}

        class Model:
            def generate_voice_clone(self, **kwargs):
                calls.update(kwargs)
                return [object()], 24000

        runtime.state.model = Model()
        runtime.state.prompt = object()
        runtime.state.ready = True

        def write_wav(output, _audio, _sample_rate, **_kwargs):
            output.write(b"RIFF\x00\x00\x00\x00WAVE")

        with patch.dict(sys.modules, {"soundfile": SimpleNamespace(write=write_wav)}):
            result = runtime.synthesize("hola, ¿cómo estás?")

        self.assertEqual(calls["language"], "Auto")
        self.assertTrue(result.startswith(b"RIFF"))


class HttpContractTests(unittest.TestCase):
    def test_local_synthesis_contract_and_health_routes(self):
        runtime = FakeRuntime()
        service = TtsService(runtime, queue_max=1, request_timeout=1)
        service.start_worker()
        server = BoundedHttpServer(("127.0.0.1", 0), make_handler(service))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(origin + "/health/live", timeout=2) as live:
                self.assertEqual(live.status, 200)
            with urllib.request.urlopen(origin + "/health/ready", timeout=2) as ready:
                self.assertEqual(json.loads(ready.read()), {"ready": True})
            request = urllib.request.Request(
                origin + "/v1/audio/speech",
                data=json.dumps({"text": "hello", "voice": "default", "format": "wav"}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=2) as response:
                self.assertEqual(response.headers.get_content_type(), "audio/wav")
                self.assertTrue(response.read().startswith(b"RIFF"))
            with urllib.request.urlopen(origin + "/metrics", timeout=2) as metrics:
                payload = metrics.read().decode()
                self.assertIn("ei_tts_queue_capacity 1", payload)
                self.assertIn("ei_tts_process_cpu_seconds_total", payload)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_bad_payload_is_rejected(self):
        service = TtsService(FakeRuntime(), queue_max=1, request_timeout=1)
        service.start_worker()
        server = BoundedHttpServer(("127.0.0.1", 0), make_handler(service))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/v1/audio/speech",
            data=json.dumps({"text": "x" * 501, "format": "wav"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=2)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
