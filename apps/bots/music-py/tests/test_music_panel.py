"""Live music panel (owner decisions 2026-10-18).

One components-v2 panel message per session with the six DJ/Master-gated
controls rendered *inside* the panel container: pause/resume, skip, shuffle,
loop and volume +/-10. Stable ``robin_panel:*`` ids plus a persistent
registration keep the buttons working for the bot's lifetime. These tests
enforce the control surface from source and exercise the real button callbacks
with injected mocks (discord.py is not installed for tests).
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
PANEL_PREFIX = "robin_panel:"

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

    def add_item(self, item):
        self._item = item


def panel_namespace() -> dict:
    discord = MagicMock()
    discord.ui.LayoutView = _StubView
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
        "ROBIN_PANEL_COLOR": 0x9078D8,
        "ROBIN_EMBLEM": "★",
        "panel_text": MagicMock(return_value="panel"),
        "panel_image_url": MagicMock(return_value="https://example.test/robin.png"),
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

    def test_six_controls_with_stable_ids_inside_a_layout_container(self):
        view = next(
            node for node in self.tree.body
            if isinstance(node, ast.ClassDef) and node.name == "MusicPanelView"
        )
        ids = {
            node.value
            for node in ast.walk(view)
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith(PANEL_PREFIX)
        }
        self.assertEqual(ids, CONTROLS)
        self.assertIn("class MusicPanelView(discord.ui.LayoutView):", self.text)
        self.assertIn("Container(accent_colour=ROBIN_PANEL_COLOR)", self.text)
        self.assertIn("discord.ui.TextDisplay(", self.text)
        self.assertIn("discord.ui.MediaGallery(", self.text)

    def test_persistent_registration_and_panel_helpers(self):
        self.assertIn("bot.add_view(MusicPanelView())", self.text)
        self.assertIn("async def post_music_panel", self.text)
        self.assertIn("async def refresh_music_panel", self.text)
        self.assertIn("async def close_music_panel", self.text)
        self.assertIn("guild_panels", self.text)

    def test_registration_instance_builds_without_a_guild(self):
        ns = panel_namespace()
        load_panel(ns)
        view = ns["MusicPanelView"]()
        self.assertIsNone(view.guild_id)
        ns["panel_text"].assert_not_called()


class PanelControlTest(unittest.IsolatedAsyncioTestCase):
    def build(self) -> dict:
        ns = panel_namespace()
        load_panel(ns, {"get_or_create_queue", "advance_for_skip"})
        return ns

    async def test_loop_button_cycles_off_track_queue(self):
        ns = self.build()
        ns["guild_queues"][GUILD] = QueueState()
        view = ns["MusicPanelView"](GUILD)
        interaction = make_interaction()
        for expected in ("track", "queue", "off"):
            await view._on_loop(interaction)
            self.assertEqual(ns["guild_queues"][GUILD].loop_mode, expected)
        self.assertEqual(ns["refresh_music_panel"].await_count, 3)

    async def test_volume_buttons_clamp_at_bounds(self):
        ns = self.build()
        ns["guild_queues"][GUILD] = QueueState(volume=145)
        view = ns["MusicPanelView"](GUILD)
        interaction = make_interaction()
        await view._adjust_volume(interaction, 10)
        self.assertEqual(ns["guild_queues"][GUILD].volume, 150)
        ns["guild_queues"][GUILD].volume = 5
        await view._adjust_volume(interaction, -10)
        self.assertEqual(ns["guild_queues"][GUILD].volume, 0)
        applied = [call.args[1] for call in ns["apply_live_volume"].call_args_list]
        self.assertEqual(applied, [150, 0])

    async def test_non_dj_clicks_are_refused_without_mutation(self):
        ns = self.build()
        ns["check_dj_permission"] = AsyncMock(return_value=False)
        ns["guild_queues"][GUILD] = QueueState(loop_mode="off")
        view = ns["MusicPanelView"](GUILD)
        interaction = make_interaction()
        await view._on_loop(interaction)
        self.assertEqual(ns["guild_queues"][GUILD].loop_mode, "off")
        ns["refresh_music_panel"].assert_not_awaited()
        self.assertGreaterEqual(ns["respond"].await_count, 1)

    async def test_toggle_freezes_the_elapsed_offset(self):
        ns = self.build()
        ns["time"].time.return_value = 145
        ns["guild_queues"][GUILD] = QueueState(tracks=[Track("t1", "song", 60000)])
        ns["track_started_at"][GUILD] = 100
        view = ns["MusicPanelView"](GUILD)
        interaction = make_interaction()
        interaction.guild.voice_client.is_playing.return_value = True
        await view._on_toggle(interaction)
        self.assertEqual(ns["guild_queues"][GUILD].position_ms, 45000)
        interaction.guild.voice_client.pause.assert_called_once()
        self.assertNotIn(GUILD, ns["track_started_at"])
        ns["refresh_music_panel"].assert_awaited_with(GUILD)

    async def test_skip_button_advances_and_stops_current_playback(self):
        ns = self.build()
        ns["guild_queues"][GUILD] = QueueState(tracks=[Track("t1", "a", 1000), Track("t2", "b", 1000)])
        view = ns["MusicPanelView"](GUILD)
        interaction = make_interaction()
        interaction.guild.voice_client.is_playing.return_value = True
        await view._on_skip(interaction)
        self.assertEqual(ns["guild_queues"][GUILD].position, 1)
        interaction.guild.voice_client.stop.assert_called_once()
        ns["start_playback"].assert_awaited_once_with(GUILD)


class RobinThemeTest(unittest.TestCase):
    def test_embeds_use_the_robin_theme_and_themed_titles(self):
        ns = panel_namespace()
        load_panel(ns, {"make_ei_embed"})
        ns["make_ei_embed"]("Body", "Robin · Queue")
        kwargs = ns["discord"].Embed.call_args.kwargs
        self.assertEqual(kwargs["color"], 0x9078D8)
        self.assertEqual(kwargs["title"], "★ Robin · Queue")
        self.assertEqual(
            ns["discord"].Embed.return_value.set_footer.call_args.kwargs["text"],
            "★ Robin · Ei Point · powered by Ei-Flow",
        )
        ns["discord"].Embed.reset_mock()
        ns["make_ei_embed"]("Body")
        self.assertEqual(ns["discord"].Embed.call_args.kwargs["title"], "★ Robin · Ei Point")


if __name__ == "__main__":
    unittest.main()
