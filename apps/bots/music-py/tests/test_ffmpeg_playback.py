"""§8C: Robin playback failure and FFmpeg/reconnect handling.

Exercises the real `play_track` function with an injected voice client and
media cache (discord.py and FFmpeg are not installed for tests). Covers:

  * remote streams request FFmpeg reconnect and streamed reconnect with `-vn`;
  * a cached local file never uses network reconnect flags (`-nostdin`);
  * FFmpeg instantiation failure, unsafe URL and a disconnected client all
    route the track through the bounded failure/advance handler instead of
    claiming playback;
  * a completed-with-error callback reuses the same advance path.
"""
import ast
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from queue_state import QueueState, Track  # noqa: E402

SRC = Path(__file__).resolve().parents[1] / "src" / "main.py"
REMOTE = "https://safe.example/audio.mp3"
GUILD = "100000000000000001"


def play_track_function():
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    node = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "play_track"
    )
    node.decorator_list = []
    return node


class PlaybackTest(unittest.IsolatedAsyncioTestCase):
    def build(self, *, connected=True, cache_path=None, safe=True, ffmpeg_error=None):
        vc = MagicMock()
        vc.is_playing.return_value = False
        vc.is_paused.return_value = False
        vc.is_connected.return_value = connected
        guild = MagicMock(voice_client=vc)
        bot = MagicMock()
        bot.get_guild.return_value = guild

        source = MagicMock(name="source")
        transformed = MagicMock(name="transformed")
        discord = MagicMock()
        discord.FFmpegPCMAudio.return_value = source
        discord.PCMVolumeTransformer.return_value = transformed
        if ffmpeg_error:
            discord.FFmpegPCMAudio.side_effect = ffmpeg_error

        cache = MagicMock()
        cache.managed_path.return_value = cache_path

        queue = QueueState()
        queue.add(Track(track_id="t1", title="A", duration_ms=60000, url=REMOTE, webpage_url=REMOTE))
        queue.add(Track(track_id="t2", title="B", duration_ms=60000, url=REMOTE, webpage_url=REMOTE))

        scope = {
            "guild_queues": {GUILD: queue},
            "active_sessions": set(),
            "track_started_at": {},
            "playback_generations": {},
            "playback_failure_count": {},
            "bot": bot,
            "log": MagicMock(),
            "asyncio": MagicMock(),
            "handle_track_finished": MagicMock(name="handle_track_finished"),
            "is_safe_url": MagicMock(return_value=safe),
            "MUSIC_CACHE": cache,
            "FFMPEG_OPTIONS": {
                "before_options": "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5",
                "options": "-vn",
            },
            "discord": discord,
            "time": time,
        }
        exec(
            compile(ast.Module(body=[play_track_function()], type_ignores=[]), str(SRC), "exec"),
            scope,
        )
        return scope, {"vc": vc, "discord": discord, "cache": cache, "queue": queue, "bot": bot, "transformed": transformed}

    async def test_remote_stream_enables_reconnect_and_streams_video_off(self):
        scope, mocks = self.build()
        scope["play_track"](GUILD)
        kwargs = mocks["discord"].FFmpegPCMAudio.call_args.kwargs
        self.assertIn("-reconnect 1", kwargs["before_options"])
        self.assertIn("-reconnect_streamed 1", kwargs["before_options"])
        self.assertEqual(kwargs["options"], "-vn")
        mocks["vc"].play.assert_called_once()
        self.assertIn(GUILD, scope["active_sessions"])

    async def test_cached_local_file_never_uses_network_reconnect(self):
        scope, mocks = self.build(cache_path="/cache/audio")
        scope["play_track"](GUILD)
        kwargs = mocks["discord"].FFmpegPCMAudio.call_args.kwargs
        self.assertEqual(kwargs["before_options"], "-nostdin")
        mocks["cache"].pin.assert_called_once_with(REMOTE)

    async def test_ffmpeg_failure_routes_to_the_bounded_advance_handler(self):
        scope, mocks = self.build(ffmpeg_error=RuntimeError("ffmpeg missing"))
        scope["play_track"](GUILD)
        mocks["vc"].play.assert_not_called()
        scope["asyncio"].run_coroutine_threadsafe.assert_called_once()
        self.assertNotIn(GUILD, scope["active_sessions"])

    async def test_unsafe_url_and_disconnected_client_both_fail_and_advance(self):
        scope, mocks = self.build(safe=False)
        scope["play_track"](GUILD)
        mocks["vc"].play.assert_not_called()
        scope["asyncio"].run_coroutine_threadsafe.assert_called_once()

        scope2, mocks2 = self.build(connected=False)
        scope2["play_track"](GUILD)
        mocks2["vc"].play.assert_not_called()
        scope2["asyncio"].run_coroutine_threadsafe.assert_called_once()

    async def test_playback_error_callback_reuses_the_advance_path(self):
        scope, mocks = self.build()
        scope["play_track"](GUILD)
        after = mocks["vc"].play.call_args.kwargs["after"]
        after(RuntimeError("stream dropped"))
        scope["asyncio"].run_coroutine_threadsafe.assert_called_once()


if __name__ == "__main__":
    unittest.main()
