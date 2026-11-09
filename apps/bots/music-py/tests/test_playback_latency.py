"""Regression guard for Robin's phone playback latency fixes.

The phone's bottleneck was yt-dlp extraction (with the EJS solver), IPv6
stalls, and waiting for a full YouTube audio download before starting playback.
These source-level invariants keep the fast path, IPv4 forcing, low-bitrate
format, chunked cache download and stream-first playback in place.
"""
import ast
from pathlib import Path
import unittest

SRC = Path(__file__).resolve().parents[1] / "src" / "main.py"


class PlaybackLatencyGuard(unittest.TestCase):
    def setUp(self):
        self.text = SRC.read_text(encoding="utf-8")
        self.tree = ast.parse(self.text)

    def function_source(self, name: str) -> str:
        node = next(
            node for node in ast.walk(self.tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
        )
        return ast.get_source_segment(self.text, node) or ""

    def test_ytdlp_uses_ipv4_low_bitrate_and_fast_path(self):
        self.assertIn('YTDLP_FORMAT = "bestaudio[abr<=72]/bestaudio/best"', self.text)
        self.assertIn('"--force-ipv4"', self.text)
        self.assertIn("YTDLP_FAST_PATH", self.text)
        self.assertIn("YTDLP_EJS_ARGS", self.text)
        download = self.function_source("download_media")
        self.assertIn("http_chunk_size", download)
        self.assertIn("source_address", download)

    def test_playback_streams_before_waiting_for_the_cache(self):
        playback = self.function_source("start_playback")
        self.assertIn("Streaming %s without waiting", playback)
        self.assertLess(
            playback.index("Streaming %s without waiting"),
            playback.index("MUSIC_CACHE.fetch"),
        )
        self.assertIn("prefetch_next", playback)

    def test_metadata_helper_retries_with_ejs(self):
        helper = self.function_source("run_ytdlp_json")
        self.assertIn("for fallback in (False, True)", helper)
        self.assertIn("YTDLP_EJS_ARGS if fallback", helper)


if __name__ == "__main__":
    unittest.main()
