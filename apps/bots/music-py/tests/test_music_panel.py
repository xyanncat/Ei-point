"""Live music panel (owner request 2026-10-18).

One panel message per session with six DJ/Master-gated controls: pause/resume,
skip, shuffle, loop and volume. Stable `robin_panel:*` component ids keep the
buttons alive for the bot's lifetime (persistent view registration). These
tests enforce the control surface from source and exercise the real button
callbacks with injected mocks (discord.py is not installed for tests).
"""
import ast
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from queue_state import QueueState, Track  # noqa: E402

SRC = Path(__file__).resolve().parents[1] / "src" / "main.py"
GUILD = "100000000000000001"

CONTROLS = {
    "robin_panel:toggle",
    "robin_panel:skip",
    "robin_panel:shuffle",
    "robin_panel:loop",
    "robin_panel:vol_down",
    "robin_panel:vol_up",
}


class _StubView:
    def __init__(self, *args, **kwargs):
        pass


def panel_namespace() -> dict:
    discord = MagicMock()
    discord.ui.View = _StubView
    return {
        "discord": discord,
        "log": MagicMock(),
        "bot": MagicMock(),
        "time": MagicMock(),
        "QueueState": QueueState,
        "Track": Track,
        "guild_queues": {},
        "guild_autoplay": {},
        "guild_panels": {},
        "playback_generations": {},
        "playback_failure_count": {},
        "active_sessions": set(),
        "track_started_at": {},
        "check_dj_permission": AsyncMock(return_value=True),
        "respond": AsyncMock(),
        "refresh_music_panel": AsyncMock(),
        "close_music_panel": AsyncMock(),
        "end_music_session": AsyncMock(),
        "start_playback": AsyncMock(),
        "apply_live_volume": MagicMock(),
    }


def load_panel(namespace: dict, extra=None) -> dict:
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    keep = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "MusicPanelView":
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    sub.decorator_list = []
            keep.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in (extra or set()):
            node.decorator_list = []
            keep.append(node)
    tree.body = keep
    exec(compile(tree, str(SRC), "exec"), namespace)
    return namespace


def make_interaction() -> MagicMock:
    interaction = MagicMock()
    interaction.guild_id = GUILD
    interaction.response.is_done.return_value = False
    interaction.response.defer = AsyncMock()
    interaction.guild.voice_client = MagicMock()
    interaction.guild.voice_client.is_playing.return_value = False
    interaction.guild.voice_client.is_paused.return_value = False
    return interaction


class PanelSourceContractTest(unittest.TestCase):
    def setUp(self):
        self.text = SRC.read_text(encoding="utf-8")
        self.tree = ast.parse(self.text)

    def test_six_controls_with_stable_ids(self):
        view = next(
            node for node in self.tree.body
            if isinstance(node, ast.ClassDef) and node.name == "MusicPanelView"
        )
        ids = set()
        for sub in view.body:
            if not isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in sub.decorator_list:
                if isinstance(decorator, ast.Call):
                    for keyword in decorator.keywords:
                        if keyword.arg == "custom_id" and isinstance(keyword.value, ast.Constant):
                            ids.add(keyword.value.value)
        self.assertEqual(ids, CONTROLS)

    def test_persistent_registration_and_panel_helpers(self):
        self.assertIn("bot.add_view(MusicPanelView())", self.text)
        self.assertIn("async def post_music_panel", self.text)
        self.assertIn("async def refresh_music_panel", self.text)
        self.assertIn("async def close_music_panel", self.text)
        self.assertIn("guild_panels", self.text)


class PanelControlTest(unittest.IsolatedAsyncioTestCase):
    def build(self) -> dict:
        ns = panel_namespace()
        load_panel(ns, {"get_or_create_queue", "advance_for_skip"})
        return ns

    async def test_loop_button_cycles_off_track_queue(self):
        ns = self.build()
        ns["guild_queues"][GUILD] = QueueState()
        view = ns["MusicPanelView"]()
        interaction = make_interaction()
        for expected in ("track", "queue", "off"):
            await view.loop(interaction, None)
            self.assertEqual(ns["guild_queues"][GUILD].loop_mode, expected)
        self.assertEqual(ns["refresh_music_panel"].await_count, 3)

    async def test_volume_buttons_clamp_at_bounds(self):
        ns = self.build()
        ns["guild_queues"][GUILD] = QueueState(volume=145)
        view = ns["MusicPanelView"]()
        interaction = make_interaction()
        await view.volume_up(interaction, None)
        self.assertEqual(ns["guild_queues"][GUILD].volume, 150)
        ns["guild_queues"][GUILD].volume = 5
        await view.volume_down(interaction, None)
        self.assertEqual(ns["guild_queues"][GUILD].volume, 0)
        applied = [call.args[1] for call in ns["apply_live_volume"].call_args_list]
        self.assertEqual(applied, [150, 0])

    async def test_non_dj_clicks_are_refused_without_mutation(self):
        ns = self.build()
        ns["check_dj_permission"] = AsyncMock(return_value=False)
        ns["guild_queues"][GUILD] = QueueState(loop_mode="off")
        view = ns["MusicPanelView"]()
        interaction = make_interaction()
        await view.loop(interaction, None)
        self.assertEqual(ns["guild_queues"][GUILD].loop_mode, "off")
        ns["refresh_music_panel"].assert_not_awaited()
        self.assertGreaterEqual(ns["respond"].await_count, 1)

    async def test_toggle_freezes_the_elapsed_offset(self):
        ns = self.build()
        ns["time"].time.return_value = 145
        ns["guild_queues"][GUILD] = QueueState(tracks=[Track("t1", "song", 60000)])
        ns["track_started_at"][GUILD] = 100
        view = ns["MusicPanelView"]()
        interaction = make_interaction()
        interaction.guild.voice_client.is_playing.return_value = True
        await view.toggle(interaction, None)
        self.assertEqual(ns["guild_queues"][GUILD].position_ms, 45000)
        interaction.guild.voice_client.pause.assert_called_once()
        self.assertNotIn(GUILD, ns["track_started_at"])
        ns["refresh_music_panel"].assert_awaited_with(GUILD)

    async def test_skip_button_advances_and_stops_current_playback(self):
        ns = self.build()
        ns["guild_queues"][GUILD] = QueueState(tracks=[Track("t1", "a", 1000), Track("t2", "b", 1000)])
        view = ns["MusicPanelView"]()
        interaction = make_interaction()
        interaction.guild.voice_client.is_playing.return_value = True
        await view.skip(interaction, None)
        self.assertEqual(ns["guild_queues"][GUILD].position, 1)
        interaction.guild.voice_client.stop.assert_called_once()
        ns["start_playback"].assert_awaited_once_with(GUILD)


if __name__ == "__main__":
    unittest.main()
