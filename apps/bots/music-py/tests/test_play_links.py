"""Owner requirement (2026-10-17): Robin playback is link-driven.

`/play` must require a link of the song or playlist; a song link enqueues one
track, a playlist link enqueues its tracks bounded by PLAYLIST_MAX_TRACKS
(default 50), each resolved lazily at playback. Non-links and unsafe links are
refused honestly without any extraction. Dependency-free: cmd_play and
tracks_from_dump are executed from the module AST with injected mocks.
"""
import ast
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from queue_state import QueueState, Track  # noqa: E402
from url_utils import is_safe_url  # noqa: E402

SRC = Path(__file__).resolve().parents[1] / "src" / "main.py"
TREE = ast.parse(SRC.read_text(encoding="utf-8"))


def function(name):
    node = next(
        n for n in TREE.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    node.decorator_list = []
    return node


def exec_function(node, scope):
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(SRC), "exec"), scope)


class Member:
    """Stands in for discord.Member: cmd_play only isinstance-checks it."""


def make_scope(interaction, *, extract_link=None, extract_tracks=None, queue=None):
    vc = MagicMock()
    vc.is_playing.return_value = False
    vc.is_paused.return_value = False
    discord = MagicMock()
    discord.Member = Member
    respond = AsyncMock()
    scope = {
        "ALLOWED_GUILDS": set(),
        "discord": discord,
        "app_commands": MagicMock(),
        "respond": respond,
        "ensure_voice_connection": AsyncMock(return_value=vc),
        "extract_link": extract_link if extract_link is not None else AsyncMock(return_value=[]),
        "extract_tracks": extract_tracks if extract_tracks is not None else AsyncMock(return_value=[]),
        "get_or_create_queue": (lambda gid: queue) if queue is not None else MagicMock(return_value=QueueState()),
        "start_playback": AsyncMock(),
        "Track": Track,
        "is_safe_url": is_safe_url,
        "PLAYLIST_MAX_TRACKS": 50,
        "log": MagicMock(),
    }
    interaction.user = Member()
    return scope, respond


def make_interaction(guild_id="100000000000000001"):
    interaction = MagicMock()
    interaction.guild_id = guild_id
    interaction.response.defer = AsyncMock()
    return interaction


async def run_play(link, *, extract_link=None, extract_tracks=None, queue=None, interaction=None):
    interaction = interaction or make_interaction()
    scope, respond = make_scope(interaction, extract_link=extract_link, extract_tracks=extract_tracks, queue=queue)
    exec_function(function("cmd_play"), scope)
    await scope["cmd_play"](interaction, link)
    replies = [str(call.args[1]) if len(call.args) > 1 else str(call.kwargs.get("message", "")) for call in respond.call_args_list]
    return scope, replies, interaction


class LinkOptionContract(unittest.TestCase):
    def test_play_requires_a_link_option_and_describes_song_or_playlist(self):
        node = next(
            n for n in TREE.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "cmd_play"
        )
        parameters = [a.arg for a in node.args.args]
        self.assertEqual(parameters, ["interaction", "link"], "the /play option must be named `link`")
        describes = [
            kw.value.value
            for dec in node.decorator_list
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr == "describe"
            for kw in dec.keywords
        ]
        self.assertTrue(any("song or playlist" in str(value).lower() for value in describes), describes)


class PlayLinkBehavior(unittest.IsolatedAsyncioTestCase):
    async def test_non_link_input_is_refused_without_any_extraction(self):
        queue = QueueState()
        scope, replies, _ = await run_play("never gonna give you up", queue=queue)
        self.assertTrue(any("link" in r.lower() for r in replies), replies)
        scope["extract_link"].assert_not_awaited()
        scope["extract_tracks"].assert_not_awaited()
        self.assertEqual(len(queue.tracks), 0)
        scope["start_playback"].assert_not_awaited()

    async def test_unsafe_link_is_refused_fail_closed(self):
        queue = QueueState()
        scope, replies, _ = await run_play("http://169.254.169.254/latest/meta-data", queue=queue)
        self.assertTrue(any("link" in r.lower() for r in replies), replies)
        scope["extract_link"].assert_not_awaited()
        self.assertEqual(len(queue.tracks), 0)

    async def test_song_link_enqueues_one_track(self):
        queue = QueueState()
        extract_link = AsyncMock(return_value=[{
            "title": "Song", "duration": 200000, "url": "https://cdn.example/stream",
            "webpage_url": "https://www.youtube.com/watch?v=1",
        }])
        scope, replies, _ = await run_play("https://www.youtube.com/watch?v=1", extract_link=extract_link, queue=queue)
        self.assertEqual(len(queue.tracks), 1)
        self.assertEqual(queue.tracks[0].title, "Song")
        self.assertEqual(queue.tracks[0].webpage_url, "https://www.youtube.com/watch?v=1")
        self.assertTrue(any("added to queue" in r.lower() for r in replies), replies)
        scope["start_playback"].assert_awaited_once()

    async def test_playlist_link_enqueues_bounded_tracks(self):
        queue = QueueState()
        entries = [
            {"title": f"Track {i}", "duration": 1000, "url": "", "webpage_url": f"https://www.youtube.com/watch?v={i}"}
            for i in range(200)
        ]
        extract_link = AsyncMock(return_value=entries)
        scope, replies, _ = await run_play("https://www.youtube.com/playlist?list=abc", extract_link=extract_link, queue=queue)
        self.assertEqual(len(queue.tracks), 50, "playlist enqueue must be bounded by PLAYLIST_MAX_TRACKS")
        self.assertEqual(queue.tracks[0].webpage_url, "https://www.youtube.com/watch?v=0")
        self.assertTrue(any("50" in r for r in replies), replies)
        self.assertTrue(any("playlist" in r.lower() for r in replies), replies)
        scope["start_playback"].assert_awaited_once()

    async def test_unresolvable_link_gets_an_honest_reply_and_queues_nothing(self):
        queue = QueueState()
        extract_link = AsyncMock(return_value=[])
        scope, replies, _ = await run_play("https://www.youtube.com/watch?v=gone", extract_link=extract_link, queue=queue)
        self.assertTrue(any("could not resolve" in r.lower() for r in replies), replies)
        self.assertEqual(len(queue.tracks), 0)
        scope["start_playback"].assert_not_awaited()


class TracksFromDump(unittest.IsolatedAsyncioTestCase):
    async def test_single_video_dump_becomes_one_lazy_resolvable_track(self):
        scope = {}
        exec_function(function("tracks_from_dump"), scope)
        result = scope["tracks_from_dump"](
            {"title": "Song", "duration": 200, "url": "https://cdn.example/stream", "webpage_url": "https://example.test/watch?v=1"},
            50,
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["url"], "https://cdn.example/stream")
        self.assertEqual(result[0]["webpage_url"], "https://example.test/watch?v=1")
        self.assertEqual(result[0]["duration"], 200000)

    async def test_playlist_dump_is_bounded_and_playlist_entries_resolve_lazily(self):
        scope = {}
        exec_function(function("tracks_from_dump"), scope)
        data = {"entries": [{"title": f"T{i}", "url": f"https://example.test/watch?v={i}"} for i in range(80)]}
        result = scope["tracks_from_dump"](data, 50)
        self.assertEqual(len(result), 50)
        for entry in result:
            self.assertEqual(entry["url"], "", "flat playlist entries must resolve lazily at playback")
            self.assertTrue(entry["webpage_url"].startswith("https://example.test/watch?v="))

    async def test_malformed_dumps_fail_closed_to_empty(self):
        scope = {}
        exec_function(function("tracks_from_dump"), scope)
        for malformed in [None, [], "text", {}, {"entries": None}, {"entries": [None, "nope", {"url": ""}]}, {"entries": "nope"}]:
            self.assertEqual(scope["tracks_from_dump"](malformed, 50), [], repr(malformed))


if __name__ == "__main__":
    unittest.main()
