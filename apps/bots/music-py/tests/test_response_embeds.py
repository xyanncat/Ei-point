"""A18 / §8C: every Robin interaction reply goes through the embed/image helper.

The audit (A18) reproduced raw text replies on Robin's `/play`, `/skip`, `/queue`
paths. The repair routes every reply through `respond()` (which builds the
configured embed via `make_ei_embed()` and is wrapped by `embed_reply_helper`).
This test parses `main.py` without importing it (discord.py is not a test
dependency) and enforces:

  * the marked embed helper is present and the configured image env is read;
  * no interaction reply/delivery call exists outside the helper, so success,
    error, empty and callback paths cannot bypass the embed formatting;
  * the only roots left registered (declared minus the sync-time removals) are
    the approved Robin command surface.
"""
import ast
import os
import unittest
from pathlib import Path

SRC = Path(
    os.environ.get(
        "MUSIC_SOURCE_PATH", Path(__file__).resolve().parents[1] / "src" / "main.py"
    )
)

APPROVED_ROOTS = {
    "ping",
    "botinfo",
    "about",
    "play",
    "pause",
    "resume",
    "skip",
    "stop",
    "queue",
    "shuffle",
    "loop",
    "volume",
    "disconnect",
}

REMOVED_ROOTS = {"search", "nowplaying", "seek", "autoplay", "claimmaster", "masters"}

# discord.py interaction delivery methods that must never appear raw.
REPLY_ATTRS = {"send", "send_message", "edit_message", "edit_original_response"}


def _tree() -> ast.Module:
    return ast.parse(SRC.read_text(encoding="utf-8"))


def _root_name(name: str) -> str:
    for prefix in ("cmd_", "common_"):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


class RobinEmbedContractTest(unittest.TestCase):
    def setUp(self):
        self.tree = _tree()
        self.text = SRC.read_text(encoding="utf-8")

    def test_marked_embed_helper_uses_the_configured_image(self):
        self.assertIn("respond = embed_reply_helper(respond)", self.text)
        self.assertIn("EI_POINT_EMBED_IMAGE_URL", self.text)
        functions = {
            node.name
            for node in self.tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for required in ("respond", "make_ei_embed"):
            self.assertIn(required, functions)

    def test_no_interaction_reply_bypasses_the_helper(self):
        # Exemptions: `respond` routes every interaction reply, and
        # `post_music_panel` posts the live panel as a persistent channel
        # message (regular messages stay editable for the whole session,
        # unlike interaction replies, which expire with their token).
        ranges = [
            (node.lineno, node.end_lineno)
            for node in self.tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name in {"respond", "post_music_panel"}
        ]
        bypass: list[int] = []
        for node in ast.walk(self.tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in REPLY_ATTRS
                and not any(lo <= node.lineno <= hi for lo, hi in ranges)
            ):
                bypass.append(node.lineno)
        self.assertEqual(
            bypass,
            [],
            f"raw interaction replies bypass the embed helper at lines {sorted(bypass)}",
        )

    def test_registered_roots_are_the_approved_surface(self):
        declared = set()
        for node in self.tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                target = decorator.func if isinstance(decorator, ast.Call) else decorator
                if isinstance(target, ast.Attribute) and target.attr == "command":
                    declared.add(_root_name(node.name))

        removed: set[str] = set()
        for node in ast.walk(self.tree):
            if isinstance(node, ast.For) and isinstance(node.iter, ast.Tuple):
                values = [
                    element.value
                    for element in node.iter.elts
                    if isinstance(element, ast.Constant) and isinstance(element.value, str)
                ]
                if "nowplaying" in values:
                    removed = set(values)

        self.assertEqual(removed, REMOVED_ROOTS, "sync-time command removals changed")
        self.assertEqual(declared - removed, APPROVED_ROOTS)


if __name__ == "__main__":
    unittest.main()
