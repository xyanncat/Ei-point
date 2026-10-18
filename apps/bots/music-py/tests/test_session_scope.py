"""Owner decision 2026-10-18: the music queue is live-session state.

Leaving voice clears the queue (no stale songs in /queue, no repeat loop from
restored tracks) and nothing restores a queue across restarts. These tests
exercise the real functions with injected mocks (discord.py is not installed
for tests) and machine-enforce the removal of the snapshot/restore path.
"""
import ast
import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from queue_state import QueueState, Track  # noqa: E402

SRC = Path(__file__).resolve().parents[1] / "src" / "main.py"
GUILD = "100000000000000001"


def base_namespace() -> dict:
    bot = MagicMock()
    bot.user.id = 777
    return {
        "asyncio": asyncio,
        "sys": sys,
        "time": time,
        "QueueState": QueueState,
        "Track": Track,
        "discord": MagicMock(),
        "log": MagicMock(),
        "bot": bot,
        "guild_queues": {},
        "guild_panels": {},
        "playback_generations": {},
        "playback_failure_count": {},
        "active_sessions": set(),
        "track_started_at": {},
        "guild_autoplay": {},
        "close_music_panel": AsyncMock(),
        "refresh_music_panel": AsyncMock(),
        "respond": AsyncMock(),
        "check_dj_permission": AsyncMock(return_value=True),
        "start_playback": AsyncMock(),
        "end_music_session": AsyncMock(),
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


class SessionScopeTest(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_clears_the_session_queue(self):
        ns = base_namespace()
        load({"end_music_session", "cmd_disconnect"}, ns)
        ns["guild_queues"][GUILD] = QueueState(tracks=[Track("t1", "old song", 1000)], loop_mode="queue", volume=80)
        ns["guild_autoplay"][GUILD] = True
        interaction = MagicMock()
        interaction.guild_id = GUILD
        vc = MagicMock()
        vc.is_playing.return_value = False
        vc.is_paused.return_value = False
        vc.disconnect = AsyncMock()
        interaction.guild.voice_client = vc

        await ns["cmd_disconnect"](interaction)

        q = ns["guild_queues"][GUILD]
        self.assertEqual(q.tracks, [])
        self.assertEqual(q.loop_mode, "off")
        self.assertEqual(ns["playback_generations"][GUILD], 1)
        self.assertNotIn(GUILD, ns["guild_autoplay"])
        vc.disconnect.assert_awaited_once()
        ns["close_music_panel"].assert_awaited_once_with(GUILD)

    def test_no_restore_or_snapshot_sources_remain(self):
        source = SRC.read_text(encoding="utf-8")
        self.assertNotIn("restore_guild_queue", source)
        self.assertNotIn("flush_snapshots", source)
        self.assertNotIn("music.queue_snapshots", source)


class VoiceLeaveEventTest(unittest.IsolatedAsyncioTestCase):
    async def test_voice_leave_event_ends_the_session_once_for_the_bot(self):
        ns = base_namespace()
        load({"on_voice_state_update"}, ns)
        member = MagicMock()
        member.id = 777
        member.guild.id = GUILD
        after_left = MagicMock()
        after_left.channel = None

        await ns["on_voice_state_update"](member, None, after_left)
        ns["end_music_session"].assert_awaited_once_with(GUILD)

        other = MagicMock()
        other.id = 42
        other.guild.id = GUILD
        await ns["on_voice_state_update"](other, None, after_left)
        ns["end_music_session"].assert_awaited_once_with(GUILD)

        after_still_in = MagicMock()
        after_still_in.channel = MagicMock()
        await ns["on_voice_state_update"](member, None, after_still_in)
        ns["end_music_session"].assert_awaited_once_with(GUILD)


class SkipHelperTest(unittest.TestCase):
    def test_skip_advances_and_only_queue_loop_wraps(self):
        ns = base_namespace()
        load({"get_or_create_queue", "advance_for_skip"}, ns)
        q = QueueState(tracks=[Track("t1", "a", 1000), Track("t2", "b", 1000)])
        ns["guild_queues"][GUILD] = q

        nxt = ns["advance_for_skip"](GUILD)
        self.assertEqual(nxt.track_id, "t2")
        self.assertEqual(q.position, 1)
        self.assertIsNone(ns["advance_for_skip"](GUILD))

        q2 = QueueState(tracks=[Track("t1", "a", 1000), Track("t2", "b", 1000)], position=1, loop_mode="queue")
        ns["guild_queues"][GUILD] = q2
        self.assertEqual(ns["advance_for_skip"](GUILD).track_id, "t1")
        self.assertEqual(q2.position, 0)


if __name__ == "__main__":
    unittest.main()
