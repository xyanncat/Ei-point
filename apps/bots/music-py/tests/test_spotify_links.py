"""Spotify links (owner report 2026-10-18): yt-dlp refuses Spotify because of
DRM, so track/playlist/album links resolve metadata through Spotify's public
embed endpoint (no credentials) and each track plays as a lazy YouTube search
through the existing bounded metadata path. These tests exercise the parser and
routing with fixtures; the live endpoint was verified separately."""
import ast
import json
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

SRC = Path(__file__).resolve().parents[1] / "src" / "main.py"


def base_namespace() -> dict:
    return {
        "json": json,
        "re": re,
        "log": MagicMock(),
        "PLAYLIST_MAX_TRACKS": 50,
        "yt_dlp": object(),
        "is_safe_url": lambda url: True,
        "spotify_tracks": AsyncMock(return_value=[{"title": "t", "duration": 1000, "url": "", "webpage_url": ""}]),
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


def embed_html(entity: dict) -> str:
    payload = {"props": {"pageProps": {"state": {"data": {"entity": entity}}}}}
    return '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(payload) + "</script>"


class SpotifyTargetTest(unittest.TestCase):
    def setUp(self):
        self.ns = load({"spotify_target"}, base_namespace())

    def target(self, url):
        return self.ns["spotify_target"](url)

    def test_reads_track_playlist_and_album_links(self):
        self.assertEqual(self.target("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), ("track", "4cOdK2wGLETKBW3PvgPWqT"))
        self.assertEqual(self.target("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc"), ("playlist", "37i9dQZF1DXcBWIGoYBM5M"))
        self.assertEqual(self.target("https://open.spotify.com/intl-de/album/1ATL5GLyefJaxhQzSPVrLX"), ("album", "1ATL5GLyefJaxhQzSPVrLX"))

    def test_ignores_other_links(self):
        self.assertIsNone(self.target("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        self.assertIsNone(self.target(""))


class SpotifyParseTest(unittest.TestCase):
    def setUp(self):
        self.ns = load({"parse_spotify_embed", "spotify_query", "spotify_text", "spotify_artists"}, base_namespace())

    def parse(self, html, kind):
        return self.ns["parse_spotify_embed"](html, kind)

    def test_track_entity_becomes_a_lazy_search_track(self):
        html = embed_html({"name": "Never Gonna Give You Up", "artists": [{"name": "Rick Astley"}], "duration": 213573})
        tracks = self.parse(html, "track")
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["title"], "Rick Astley - Never Gonna Give You Up")
        self.assertEqual(tracks[0]["duration"], 213573)
        self.assertEqual(tracks[0]["url"], "")
        self.assertEqual(tracks[0]["webpage_url"], "")

    def test_playlist_entries_are_bounded_and_cleaned(self):
        entries = [
            {"title": f"Song {i}", "subtitle": "Artist\xa0Name", "duration": 1000 + i}
            for i in range(80)
        ]
        tracks = self.parse(embed_html({"name": "Mix", "trackList": entries}), "playlist")
        self.assertEqual(len(tracks), 50)
        self.assertEqual(tracks[0]["title"], "Artist Name - Song 0")
        self.assertEqual(tracks[0]["duration"], 1000)

    def test_malformed_pages_fail_closed(self):
        self.assertEqual(self.parse("", "track"), [])
        self.assertEqual(self.parse("<html>no data</html>", "track"), [])
        self.assertEqual(self.parse('<script id="__NEXT_DATA__" type="application/json">{oops</script>', "track"), [])
        self.assertEqual(self.parse(embed_html({}), "playlist"), [])

    def test_artists_already_in_title_are_not_duplicated(self):
        query = self.ns["spotify_query"]("Rick Astley - Never Gonna Give You Up", "Rick Astley")
        self.assertEqual(query, "Rick Astley - Never Gonna Give You Up")


class SpotifyRoutingTest(unittest.IsolatedAsyncioTestCase):
    async def test_extract_link_routes_spotify(self):
        ns = base_namespace()
        load({"extract_link", "spotify_target"}, ns)
        result = await ns["extract_link"]("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
        self.assertEqual(len(result), 1)
        ns["spotify_tracks"].assert_awaited_once_with("playlist", "37i9dQZF1DXcBWIGoYBM5M")

    async def test_unsafe_spotify_link_is_refused_before_fetching(self):
        ns = base_namespace()
        ns["is_safe_url"] = lambda url: False
        load({"extract_link", "spotify_target"}, ns)
        result = await ns["extract_link"]("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")
        self.assertEqual(result, [])
        ns["spotify_tracks"].assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
