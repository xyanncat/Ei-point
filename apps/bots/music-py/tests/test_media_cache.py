import asyncio
import pathlib
import sys
import tempfile
import time
import unittest
import ast
from unittest.mock import AsyncMock, MagicMock
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'src'))
from media_cache import AudioCache

class CacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_actual_playback_entry_uses_cache_hit_without_network_resolution(self):
        source = pathlib.Path(__file__).resolve().parents[1] / 'src' / 'main.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'start_playback')
        track = MagicMock(webpage_url='https://example.test/audio', track_id='id')
        cache = MagicMock(); cache.lookup.return_value = '/cache/audio'
        play, extract = MagicMock(), AsyncMock()
        scope = {'guild_queues': {'guild': MagicMock(tracks=[track], position=0)}, 'MUSIC_CACHE': cache, 'play_track': play, 'extract_tracks': extract}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), scope)
        await scope['start_playback']('guild', start_sec=12)
        extract.assert_not_awaited()
        self.assertEqual(track.url, '/cache/audio')
        play.assert_called_once_with('guild', start_sec=12)

    async def test_hit_and_bounded_lru_preserve_active_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = AudioCache(directory, max_bytes=12, max_item_bytes=8, ttl_seconds=60, minimum_free_ratio=0)
            calls = []
            async def download(path):
                calls.append(path)
                path.write_bytes(b'123456')
            first = await cache.fetch('one', download)
            self.assertEqual(first, await cache.fetch('one', download))
            self.assertEqual(len(calls), 1)
            cache.pin(first)
            second = await cache.fetch('two', download)
            third = await cache.fetch('three', download)
            self.assertTrue(pathlib.Path(first).exists())
            self.assertFalse(pathlib.Path(second).exists())
            self.assertTrue(pathlib.Path(third).exists())
            self.assertLessEqual(sum(p.stat().st_size for p in pathlib.Path(directory).glob('*.audio')), 12)
            cache.unpin(first)

    async def test_oversize_failure_and_external_paths_never_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = AudioCache(directory, max_bytes=10, max_item_bytes=5, ttl_seconds=60, minimum_free_ratio=0)
            async def oversized(path): path.write_bytes(b'123456')
            with self.assertRaises(ValueError): await cache.fetch('oversize', oversized)
            self.assertEqual(list(pathlib.Path(directory).iterdir()), [])
            self.assertFalse(cache.managed_path('/etc/passwd'))
            async def failed(path):
                path.write_bytes(b'12')
                raise RuntimeError('download failed')
            with self.assertRaises(RuntimeError): await cache.fetch('failure', failed)
            self.assertEqual(list(pathlib.Path(directory).iterdir()), [])

    async def test_expired_audio_is_downloaded_again(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = AudioCache(directory, max_bytes=10, max_item_bytes=5, ttl_seconds=1, minimum_free_ratio=0)
            async def download(path): path.write_bytes(b'123')
            path = await cache.fetch('key', download)
            import os
            os.utime(path, (time.time()-10, time.time()-10))
            self.assertIsNone(cache.lookup('key'))
            self.assertEqual(path, await cache.fetch('key', download))
