"""Owner feedback (2026-10-18): next-song gaps and cache reliability.
`start_playback` streams a resolved direct URL immediately instead of waiting
for the full cache download, warms the next queued track in the background, and
still falls back to the cache when an entry has no direct URL. The media cache
sweeps stale staging files so a leftover lock cannot poison later fetches. These
tests exercise the real functions with injected mocks (discord.py is not
installed for tests)."""
import ast
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from queue_state import QueueState, Track  # noqa: E402

SRC = Path(__file__).resolve().parents[1] / "src" / "main.py"
GUILD = "100000000000000001"


def base_namespace() -> dict:
    asyncio = MagicMock()
    asyncio.create_task.side_effect = lambda coro: (coro.close(), MagicMock())[1]
    return {
        "asyncio": asyncio,
        "log": MagicMock(),
        "QueueState": QueueState,
        "Track": Track,
        "guild_queues": {},
        "guild_autoplay": {},
        "guild_panels": {},
        "playback_generations": {},
        "playback_failure_count": {},
        "active_sessions": set(),
        "track_started_at": {},
        "MUSIC_CACHE": MagicMock(),
        "is_safe_url": lambda url: True,
        "extract_tracks": AsyncMock(return_value=[]),
        "play_track": MagicMock(),
        "refresh_music_panel": AsyncMock(),
        "download_media": MagicMock(),
    }


def load(names: set, namespace: dict) -> dict:
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    tree.body = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names
    ]
    for node in tree.body:
        node.decorator_list = []
    exec(compile(tree, str(SRC), "exec"), namespace)
    return namespace


def playable(track_id: str, url: str = "", webpage: str = "") -> Track:
    return Track(track_id=track_id, title=f"song {track_id}", duration_ms=180_000, url=url, webpage_url=webpage)


class PrefetchTest(unittest.IsolatedAsyncioTestCase):
    async def test_next_track_is_resolved_and_cached_in_the_background(self):
        ns = base_namespace()
        load({"prefetch_next"}, ns)
        ns["extract_tracks"] = AsyncMock(return_value=[{"url": "https://cdn.example/b", "title": "B"}])
        ns["MUSIC_CACHE"].lookup.return_value = None
        ns["MUSIC_CACHE"].fetch = AsyncMock(return_value="/cache/b")
        q = QueueState(tracks=[playable("a", url="https://cdn.example/a"), playable("b", webpage="https://youtu.be/b")])
        ns["guild_queues"][GUILD] = q

        await ns["prefetch_next"](GUILD)

        ns["extract_tracks"].assert_awaited_once_with("https://youtu.be/b", max_results=1)
        ns["MUSIC_CACHE"].fetch.assert_awaited()
        self.assertEqual(q.tracks[1].url, "/cache/b")

    async def test_prefetch_skips_track_loop_and_drained_queues(self):
        ns = base_namespace()
        load({"prefetch_next"}, ns)
        ns["guild_queues"][GUILD] = QueueState(tracks=[playable("a"), playable("b")], loop_mode="track")
        await ns["prefetch_next"](GUILD)
        ns["extract_tracks"].assert_not_awaited()

        ns["guild_queues"][GUILD] = QueueState(tracks=[playable("a")], position=0)
        await ns["prefetch_next"](GUILD)
        ns["extract_tracks"].assert_not_awaited()

    async def test_cached_next_track_is_left_alone(self):
        ns = base_namespace()
        load({"prefetch_next"}, ns)
        ns["MUSIC_CACHE"].lookup.return_value = "/cache/b"
        ns["guild_queues"][GUILD] = QueueState(tracks=[playable("a"), playable("b", webpage="https://youtu.be/b")])
        await ns["prefetch_next"](GUILD)
        ns["extract_tracks"].assert_not_awaited()
        ns["MUSIC_CACHE"].fetch.assert_not_called()


class StartPlaybackFastPathTest(unittest.IsolatedAsyncioTestCase):
    async def test_resolved_track_streams_directly_and_prefetches(self):
        ns = base_namespace()
        load({"get_or_create_queue", "prefetch_next", "start_playback"}, ns)
        q = QueueState(tracks=[playable("a", url="https://cdn.example/direct", webpage="https://youtu.be/a")])
        ns["guild_queues"][GUILD] = q
        ns["MUSIC_CACHE"].lookup.return_value = None
        ns["MUSIC_CACHE"].fetch = AsyncMock(return_value="/cache/a")

        await ns["start_playback"](GUILD)

        ns["extract_tracks"].assert_not_awaited()
        ns["MUSIC_CACHE"].fetch.assert_not_awaited()
        ns["play_track"].assert_called_once_with(GUILD, start_sec=0)
        self.assertEqual(q.tracks[0].url, "https://cdn.example/direct")
        ns["asyncio"].create_task.assert_called()

    async def test_lazy_playlist_entry_streams_after_page_resolution(self):
        ns = base_namespace()
        load({"get_or_create_queue", "prefetch_next", "start_playback"}, ns)
        ns["extract_tracks"] = AsyncMock(return_value=[{"url": "https://cdn.example/lazy", "title": "Lazy"}])
        ns["guild_queues"][GUILD] = QueueState(tracks=[playable("a", webpage="https://youtu.be/lazy")])
        ns["MUSIC_CACHE"].lookup.return_value = None
        ns["MUSIC_CACHE"].fetch = AsyncMock(return_value="/cache/lazy")

        await ns["start_playback"](GUILD)

        ns["extract_tracks"].assert_awaited_once_with("https://youtu.be/lazy", max_results=1)
        ns["MUSIC_CACHE"].fetch.assert_not_awaited()
        self.assertEqual(ns["guild_queues"][GUILD].tracks[0].url, "https://cdn.example/lazy")
        ns["play_track"].assert_called_once_with(GUILD, start_sec=0)

    async def test_entry_without_direct_url_still_uses_the_cache_fallback(self):
        ns = base_namespace()
        load({"get_or_create_queue", "prefetch_next", "start_playback"}, ns)
        ns["extract_tracks"] = AsyncMock(return_value=[])
        ns["guild_queues"][GUILD] = QueueState(tracks=[playable("a", webpage="https://youtu.be/a")])
        ns["MUSIC_CACHE"].lookup.return_value = None
        ns["MUSIC_CACHE"].fetch = AsyncMock(return_value="/cache/a")

        await ns["start_playback"](GUILD)

        ns["MUSIC_CACHE"].fetch.assert_awaited()
        self.assertEqual(ns["guild_queues"][GUILD].tracks[0].url, "/cache/a")
        ns["play_track"].assert_called_once_with(GUILD, start_sec=0)


if __name__ == "__main__":
    unittest.main()
