"""Offline-first Qwen3-TTS HTTP service for Cyrene.

Only standard-library HTTP, queueing, metrics, and cache code is imported at
module load. Qwen/PyTorch are imported on the model-loader thread so the
service can expose liveness and metrics while a local model is loading.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import queue
import re
import signal
import subprocess
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
MAX_TEXT_CHARS = 500
MAX_BODY_BYTES = 16 * 1024
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_CACHE_BYTES = 64 * 1024 * 1024
CACHE_TTL_SECONDS = 3600
SECRET_PATTERN = re.compile(r"mfa\.[\w-]{10,}|ghp_[A-Za-z0-9]{36}|BEGIN [A-Z ]*PRIVATE KEY")
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
VOICE_PATTERN = re.compile(r"^[a-z0-9_-]{1,40}$")

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("ei-point.qwen-tts")


class ModelNotReady(Exception):
    pass


class ServiceDegraded(Exception):
    """The inference worker exceeded its hard deadline and has not yet recovered."""


class QueueFull(Exception):
    pass


class RequestTimedOut(Exception):
    pass


class InvalidRequest(Exception):
    pass


def validate_request(value: Any) -> tuple[str, str, str]:
    if not isinstance(value, dict):
        raise InvalidRequest("invalid-body")
    text = value.get("text")
    voice = value.get("voice", "default")
    output_format = value.get("format", "wav")
    if not isinstance(text, str) or not isinstance(voice, str) or not isinstance(output_format, str) or output_format not in {"wav", "mp3"}:
        raise InvalidRequest("invalid-body")
    text = " ".join(text.split())
    voice = re.sub(r"[^a-z0-9_-]", "", voice.strip().lower())[:40] or "default"
    try:
        utf16_length = len(text.encode("utf-16-le")) // 2
    except UnicodeEncodeError as exc:
        raise InvalidRequest("invalid-unicode") from exc
    if len(text) == 0 or utf16_length > MAX_TEXT_CHARS or not VOICE_PATTERN.fullmatch(voice):
        raise InvalidRequest("invalid-text-or-voice")
    if SECRET_PATTERN.search(text):
        raise InvalidRequest("secret-rejected")
    return text, voice, output_format


def cache_key(revision: str, voice: str, text: str, output_format: str = "wav") -> str:
    # The source text never appears in cache identifiers or metrics.
    material = f"v1\0{revision}\0{voice}\0{output_format}\0{text}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


class BoundedAudioCache:
    def __init__(self, max_bytes: int = MAX_CACHE_BYTES, ttl_seconds: int = CACHE_TTL_SECONDS, max_entries: int = 256):
        if max_bytes < 1 or ttl_seconds < 1 or max_entries < 1:
            raise ValueError("cache bounds must be positive")
        self.max_bytes = max_bytes
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._items: OrderedDict[str, tuple[float, bytes, int]] = OrderedDict()
        self._size_bytes = 0
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> bytes | None:
        now = time.monotonic()
        with self._lock:
            self._purge_expired(now)
            item = self._items.get(key)
            if item is None:
                self.misses += 1
                return None
            expires, audio, _ = item
            if expires <= now:
                self._remove(key)
                self.misses += 1
                return None
            self._items.move_to_end(key)
            self.hits += 1
            return audio

    def put(self, key: str, audio: bytes) -> None:
        if not audio or len(audio) > self.max_bytes:
            return
        now = time.monotonic()
        with self._lock:
            self._purge_expired(now)
            self._remove(key)
            while self._items and (len(self._items) >= self.max_entries or self._size_bytes + len(audio) > self.max_bytes):
                oldest = next(iter(self._items))
                self._remove(oldest)
            self._items[key] = (now + self.ttl_seconds, audio, len(audio))
            self._size_bytes += len(audio)

    def snapshot(self) -> tuple[int, int]:
        with self._lock:
            self._purge_expired(time.monotonic())
            return len(self._items), self._size_bytes

    def _purge_expired(self, now: float) -> None:
        expired = [key for key, (expires, _, _) in self._items.items() if expires <= now]
        for key in expired:
            self._remove(key)

    def _remove(self, key: str) -> None:
        item = self._items.pop(key, None)
        if item is not None:
            self._size_bytes -= item[2]


def verify_model_manifest(model_dir: Path, expected_revision: str) -> dict[str, Any]:
    if not REVISION_PATTERN.fullmatch(expected_revision):
        raise RuntimeError("QWEN_TTS_MODEL_REVISION must be a pinned 40-character commit hash")
    manifest_path = model_dir / "ei-point-model.json"
    if model_dir.is_symlink() or not model_dir.is_dir() or not manifest_path.is_file():
        raise RuntimeError("local Qwen model or integrity manifest is missing")
    if manifest_path.stat().st_size > 1024 * 1024:
        raise RuntimeError("local Qwen model manifest is too large")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        manifest.get("version") != 1
        or manifest.get("model_id") != MODEL_ID
        or manifest.get("revision") != expected_revision
        or not isinstance(manifest.get("files"), dict)
        or not manifest["files"]
    ):
        raise RuntimeError("local Qwen model manifest does not match configured revision")

    expected_files: set[str] = set()
    for relative_name, record in manifest["files"].items():
        relative = Path(relative_name)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise RuntimeError("unsafe path in Qwen model manifest")
        target = model_dir / relative
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(model_dir.resolve()):
            raise RuntimeError("Qwen model file missing or linked outside pinned directory")
        if (
            not isinstance(record, dict)
            or not isinstance(record.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"])
            or record.get("sha256") != _sha256(target)
        ):
            raise RuntimeError("Qwen model file checksum does not match pinned manifest")
        if record.get("bytes") != target.stat().st_size:
            raise RuntimeError("Qwen model file size does not match pinned manifest")
        expected_files.add(relative.as_posix())

    actual_files: set[str] = set()
    for target in model_dir.rglob("*"):
        if target.is_symlink():
            raise RuntimeError("symbolic links are not allowed in the Qwen model directory")
        if target.is_file() and ".cache" not in target.relative_to(model_dir).parts:
            relative = target.relative_to(model_dir).as_posix()
            if relative != manifest_path.name:
                actual_files.add(relative)
    if actual_files != expected_files:
        raise RuntimeError("Qwen model directory differs from its pinned integrity manifest")
    return manifest


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


@dataclass
class RuntimeState:
    model: Any = None
    prompt: Any = None
    revision: str = ""
    ready: bool = False
    load_seconds: float = 0.0
    load_error: str = ""


class QwenRuntime:
    def __init__(self, model_dir: Path, revision: str, reference_audio: Path, reference_text: str, torch_threads: int):
        self.model_dir = model_dir
        self.expected_revision = revision
        self.reference_audio = reference_audio
        self.reference_text = " ".join(reference_text.split())
        self.torch_threads = torch_threads
        self.state = RuntimeState(revision=revision if REVISION_PATTERN.fullmatch(revision) else "")
        self._lock = threading.Lock()

    def load(self) -> None:
        start = time.monotonic()
        try:
            manifest = verify_model_manifest(self.model_dir, self.expected_revision)
            if not self.reference_audio.is_file():
                raise RuntimeError("Cyrene reference audio file is missing")
            if not self.reference_text or len(self.reference_text) > 2000:
                raise RuntimeError("Cyrene reference transcript is missing or too long")

            # This import is intentionally deferred until the service starts.
            import torch
            from qwen_tts import Qwen3TTSModel

            torch.set_num_threads(self.torch_threads)
            try:
                torch.set_num_interop_threads(1)
            except RuntimeError:
                pass
            model = Qwen3TTSModel.from_pretrained(
                str(self.model_dir),
                device_map="cpu",
                dtype=torch.float32,
                local_files_only=True,
                use_safetensors=True,
            )
            prompt = model.create_voice_clone_prompt(
                ref_audio=str(self.reference_audio),
                ref_text=self.reference_text,
                x_vector_only_mode=False,
            )
            with self._lock:
                self.state.model = model
                self.state.prompt = prompt
                self.state.revision = manifest["revision"]
                self.state.ready = True
                self.state.load_error = ""
        except Exception as exc:
            # Do not log user text, transcript, or full local paths.
            logger.error("Qwen model preload failed (%s)", type(exc).__name__)
            with self._lock:
                self.state.ready = False
                self.state.load_error = type(exc).__name__
        finally:
            with self._lock:
                self.state.load_seconds = time.monotonic() - start

    def snapshot(self) -> RuntimeState:
        with self._lock:
            return RuntimeState(**vars(self.state))

    def synthesize(self, text: str) -> bytes:
        state = self.snapshot()
        if not state.ready or state.model is None or state.prompt is None:
            raise ModelNotReady()
        wavs, sample_rate = state.model.generate_voice_clone(
            text=text,
            language="Auto",
            voice_clone_prompt=state.prompt,
        )
        if not wavs:
            raise RuntimeError("empty-audio")
        import soundfile as sf

        output = io.BytesIO()
        sf.write(output, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
        audio = output.getvalue()
        if not audio or len(audio) > MAX_AUDIO_BYTES:
            raise RuntimeError("audio-size-out-of-range")
        return audio


@dataclass
class WorkItem:
    key: str
    text: str
    output_format: str
    done: threading.Event
    audio: bytes | None = None
    error: Exception | None = None
    cancelled: bool = False


class TtsService:
    def __init__(self, runtime: QwenRuntime, queue_max: int, request_timeout: float, hard_timeout: float | None = None):
        self.runtime = runtime
        self.queue: queue.Queue[WorkItem] = queue.Queue(maxsize=queue_max)
        self.request_timeout = request_timeout
        # Hard deadline: a request that outlives it marks the worker stuck, degrades
        # readiness, and refuses new work until the stuck inference actually settles.
        self.hard_timeout = hard_timeout if hard_timeout is not None else request_timeout + 30.0
        self.cache = BoundedAudioCache()
        self._lock = threading.Lock()
        self._requests: dict[str, int] = {"success": 0, "invalid": 0, "overload": 0, "timeout": 0, "failure": 0, "degraded": 0}
        self._inference_seconds_sum = 0.0
        self._inference_count = 0
        self._inference_active = False
        self._inference_started_at = 0.0
        self._worker_stuck = False
        self._shutdown = False
        self._worker = threading.Thread(target=self._run_worker, name="qwen-inference", daemon=True)

    def start(self) -> None:
        self.start_worker()
        threading.Thread(target=self.runtime.load, name="qwen-preload", daemon=True).start()

    def start_worker(self) -> None:
        self._worker.start()

    def shutdown(self) -> None:
        with self._lock:
            self._shutdown = True
            self._worker_stuck = False
        self.queue.put(WorkItem(key="__shutdown__", text="", output_format="wav", done=threading.Event()))

    def wait_worker_stopped(self, timeout: float = 5.0) -> None:
        self._worker.join(timeout=timeout)

    @property
    def worker_alive(self) -> bool:
        return self._worker.is_alive()

    @property
    def worker_stuck(self) -> bool:
        with self._lock:
            return self._worker_stuck

    def snapshot_ready(self) -> bool:
        self.check_hard_deadline()
        state = self.runtime.snapshot()
        with self._lock:
            return bool(state.ready and not self._worker_stuck and not self._shutdown)

    def synthesize(self, text: str, voice: str, output_format: str = "wav") -> bytes:
        state = self.runtime.snapshot()
        if not state.ready:
            raise ModelNotReady()
        self.check_hard_deadline()
        with self._lock:
            if self._shutdown:
                raise ModelNotReady()
            if self._worker_stuck:
                self._requests["degraded"] = self._requests.get("degraded", 0) + 1
                raise ServiceDegraded()
        key = cache_key(state.revision, voice, text, output_format)
        cached = self.cache.get(key)
        if cached is not None:
            self._count("success")
            return cached
        item = WorkItem(key=key, text=text, output_format=output_format, done=threading.Event())
        try:
            self.queue.put_nowait(item)
        except queue.Full as exc:
            self._count("overload")
            raise QueueFull() from exc
        if not item.done.wait(self.request_timeout):
            item.cancelled = True
            self._count("timeout")
            raise RequestTimedOut()
        if item.error is not None:
            self._count("failure")
            raise item.error
        if not item.audio:
            self._count("failure")
            raise RuntimeError("empty-audio")
        self._count("success")
        return item.audio

    def _run_worker(self) -> None:
        while True:
            item = self.queue.get()
            if item.key == "__shutdown__":
                self.queue.task_done()
                return
            if item.cancelled:
                item.done.set()
                self.queue.task_done()
                continue
            with self._lock:
                self._inference_active = True
                self._inference_started_at = time.monotonic()
            started = time.monotonic()
            try:
                wav_audio = self.runtime.synthesize(item.text)
                item.audio = wav_audio if item.output_format == "wav" else _transcode_wav_to_mp3(wav_audio)
                self.cache.put(item.key, item.audio)
            except Exception as exc:
                item.error = exc
            finally:
                elapsed = time.monotonic() - started
                with self._lock:
                    self._inference_active = False
                    self._worker_stuck = False
                    self._inference_seconds_sum += elapsed
                    self._inference_count += 1
                item.done.set()
                self.queue.task_done()
                # Watchdog: sets the stuck flag from outside when the hard deadline elapses.
                # Clearing it here is correct only because the inference actually settled.

    def check_hard_deadline(self, now: float | None = None) -> bool:
        """Mark the worker stuck when the active inference exceeded its hard deadline.
        Returns True when the service is degraded by this check."""
        moment = now if now is not None else time.monotonic()
        with self._lock:
            if self._shutdown:
                return False
            if self._inference_active and not self._worker_stuck and moment - self._inference_started_at > self.hard_timeout:
                self._worker_stuck = True
                logger.error("TTS inference exceeded its hard deadline; readiness degraded until it settles")
            return self._worker_stuck

    def _count(self, result: str) -> None:
        with self._lock:
            self._requests[result] = self._requests.get(result, 0) + 1

    def metrics(self) -> str:
        state = self.runtime.snapshot()
        cache_entries, cache_bytes = self.cache.snapshot()
        with self._lock:
            requests = dict(self._requests)
            inference_sum = self._inference_seconds_sum
            inference_count = self._inference_count
            active = self._inference_active
        rss = _resident_memory_bytes()
        lines = [
            "# HELP ei_tts_ready Whether the pinned local TTS model and voice prompt are ready.",
            "# TYPE ei_tts_ready gauge",
            f"ei_tts_ready {int(state.ready)}",
            "# HELP ei_tts_model_load_seconds Last model preload duration.",
            "# TYPE ei_tts_model_load_seconds gauge",
            f"ei_tts_model_load_seconds {state.load_seconds:.6f}",
            "# HELP ei_tts_model_load_errors_total Model preload failures.",
            "# TYPE ei_tts_model_load_errors_total counter",
            f"ei_tts_model_load_errors_total {int(bool(state.load_error))}",
            "# HELP ei_tts_model_revision_info Configured immutable model revision.",
            "# TYPE ei_tts_model_revision_info gauge",
            f'ei_tts_model_revision_info{{revision="{state.revision}"}} 1' if state.revision else "ei_tts_model_revision_info 0",
            "# HELP ei_tts_inference_seconds Time spent generating audio.",
            "# TYPE ei_tts_inference_seconds summary",
            f"ei_tts_inference_seconds_sum {inference_sum:.6f}",
            f"ei_tts_inference_seconds_count {inference_count}",
            "# HELP ei_tts_requests_total Requests by bounded outcome label.",
            "# TYPE ei_tts_requests_total counter",
        ]
        for result, count in sorted(requests.items()):
            lines.append(f'ei_tts_requests_total{{result="{result}"}} {count}')
        lines.extend(
            [
                "# HELP ei_tts_queue_depth Number of waiting synthesis requests.",
                "# TYPE ei_tts_queue_depth gauge",
                f"ei_tts_queue_depth {self.queue.qsize()}",
                "# HELP ei_tts_queue_capacity Maximum number of waiting synthesis requests.",
                "# TYPE ei_tts_queue_capacity gauge",
                f"ei_tts_queue_capacity {self.queue.maxsize}",
                "# HELP ei_tts_inference_active Whether a synthesis is running.",
                "# TYPE ei_tts_inference_active gauge",
                f"ei_tts_inference_active {int(active)}",
                "# HELP ei_tts_cache_entries Number of cached audio responses.",
                "# TYPE ei_tts_cache_entries gauge",
                f"ei_tts_cache_entries {cache_entries}",
                "# HELP ei_tts_cache_bytes Bytes occupied by cached audio.",
                "# TYPE ei_tts_cache_bytes gauge",
                f"ei_tts_cache_bytes {cache_bytes}",
                "# HELP ei_tts_cache_capacity_bytes Maximum cached audio bytes.",
                "# TYPE ei_tts_cache_capacity_bytes gauge",
                f"ei_tts_cache_capacity_bytes {self.cache.max_bytes}",
                "# HELP ei_tts_cache_entry_capacity Maximum cached response count.",
                "# TYPE ei_tts_cache_entry_capacity gauge",
                f"ei_tts_cache_entry_capacity {self.cache.max_entries}",
                "# HELP ei_tts_cache_hits_total Bounded audio cache hits.",
                "# TYPE ei_tts_cache_hits_total counter",
                f"ei_tts_cache_hits_total {self.cache.hits}",
                "# HELP ei_tts_cache_misses_total Bounded audio cache misses.",
                "# TYPE ei_tts_cache_misses_total counter",
                f"ei_tts_cache_misses_total {self.cache.misses}",
                "# HELP ei_tts_process_cpu_seconds_total Process CPU time.",
                "# TYPE ei_tts_process_cpu_seconds_total counter",
                f"ei_tts_process_cpu_seconds_total {time.process_time():.6f}",
                "# HELP ei_tts_process_resident_memory_bytes Resident process memory in bytes.",
                "# TYPE ei_tts_process_resident_memory_bytes gauge",
                f"ei_tts_process_resident_memory_bytes {rss}",
            ]
        )
        return "\n".join(lines) + "\n"


def _resident_memory_bytes() -> int:
    try:
        for line in Path("/proc/self/status").read_text(encoding="ascii").splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return 0


def _transcode_wav_to_mp3(wav_audio: bytes) -> bytes:
    result = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-threads", "1", "-f", "wav", "-i", "pipe:0", "-vn",
            "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "96k",
            "-f", "mp3", "pipe:1",
        ],
        input=wav_audio,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=True,
    )
    audio = result.stdout
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise RuntimeError("audio-size-out-of-range")
    return audio


def make_handler(service: TtsService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "EiPointTTS/1"
        sys_version = ""

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, _format: str, *args: Any) -> None:
            # Default access logs can include request paths; keep operational
            # logs small and never emit request bodies or synthesized text.
            logger.info("http request handled")

        def do_GET(self) -> None:
            if self.path == "/health/live":
                self._json(200, {"ok": True})
            elif self.path == "/health/ready":
                ready = service.snapshot_ready()
                state = service.runtime.snapshot()
                self._json(200 if ready else 503, {"ready": ready, **({"error": state.load_error} if state.load_error else {}), **({"degraded": True} if not ready and service.worker_stuck else {})})
            elif self.path == "/metrics":
                body = service.metrics().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            else:
                self._json(404, {"error": "not-found"})

        def do_POST(self) -> None:
            if self.path != "/v1/audio/speech":
                self._json(404, {"error": "not-found"})
                return
            if self.headers.get_content_type() != "application/json":
                service._count("invalid")
                self._json(415, {"error": "application-json-required"})
                return
            try:
                size = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                size = -1
            if size < 0 or size > MAX_BODY_BYTES:
                service._count("invalid")
                self._json(413, {"error": "request-too-large"})
                return
            try:
                value = json.loads(self.rfile.read(size))
                text, voice, output_format = validate_request(value)
            except (UnicodeDecodeError, json.JSONDecodeError, InvalidRequest):
                service._count("invalid")
                self._json(400, {"error": "invalid-request"})
                return
            try:
                audio = service.synthesize(text, voice, output_format)
            except ModelNotReady:
                service._count("failure")
                self._json(503, {"error": "model-not-ready"})
                return
            except ServiceDegraded:
                self._json(503, {"error": "service-degraded"}, {"Retry-After": "5"})
                return
            except QueueFull:
                self._json(429, {"error": "queue-full"}, {"Retry-After": "2"})
                return
            except RequestTimedOut:
                self._json(504, {"error": "synthesis-timeout"})
                return
            except Exception as exc:
                logger.error("Qwen synthesis failed (%s)", type(exc).__name__)
                self._json(502, {"error": "synthesis-failed"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav" if output_format == "wav" else "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(audio)

        def _json(self, status: int, value: dict[str, Any], headers: dict[str, str] | None = None) -> None:
            body = json.dumps(value, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for name, header_value in (headers or {}).items():
                self.send_header(name, header_value)
            self.end_headers()
            self.wfile.write(body)

    return Handler


class BoundedHttpServer(ThreadingHTTPServer):
    """Keep handler threads bounded independently of the synthesis queue."""

    daemon_threads = True
    request_slots = threading.BoundedSemaphore(16)

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self.request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()


def main() -> None:
    model_dir = Path(os.environ.get("QWEN_TTS_MODEL_DIR", "/models/qwen3-tts-12hz-0.6b-base"))
    model_revision = os.environ.get("QWEN_TTS_MODEL_REVISION", "")
    reference_audio = Path(os.environ.get("QWEN_TTS_REFERENCE_AUDIO", "/reference/cyrene.wav"))
    reference_text = os.environ.get("QWEN_TTS_REFERENCE_TEXT", "")
    threads = _positive_int("QWEN_TTS_TORCH_THREADS", 2, 1, 8)
    queue_max = _positive_int("QWEN_TTS_QUEUE_MAX", 8, 1, 32)
    request_timeout = _positive_int("QWEN_TTS_REQUEST_TIMEOUT_SECONDS", 90, 5, 300)
    hard_timeout = _positive_int("QWEN_TTS_HARD_TIMEOUT_SECONDS", request_timeout + 30, 5, 600)
    if hard_timeout < request_timeout:
        hard_timeout = request_timeout + 30
    port = _positive_int("QWEN_TTS_PORT", 3120, 1024, 65535)
    runtime = QwenRuntime(model_dir, model_revision, reference_audio, reference_text, threads)
    service = TtsService(runtime, queue_max=queue_max, request_timeout=request_timeout, hard_timeout=hard_timeout)
    service.start()
    server = BoundedHttpServer(("0.0.0.0", port), make_handler(service))

    def _stop(_signum: int, _frame: Any) -> None:
        # Bounded shutdown: stop accepting work, give the worker a short join, then
        # stop the server. A genuinely hung inference is the container runtime's
        # problem to replace; readiness has already been degraded for it.
        service.shutdown()
        service.wait_worker_stopped(timeout=5.0)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    logger.info("local Qwen TTS HTTP service listening on port %s; model loading is offline", port)
    server.serve_forever()


def _positive_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} is outside the supported range")
    return value


if __name__ == "__main__":
    main()
