import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add project and src directories to sys.path
_TEST_DIR = Path(__file__).resolve().parent
_SRC_DIR = _TEST_DIR.parent / "src"
sys.path.insert(0, str(_SRC_DIR))
sys.path.insert(0, str(_TEST_DIR.parent))

try:
    from queue_state import QueueState, Track
except ImportError:
    from src.queue_state import QueueState, Track

try:
    from url_utils import is_safe_url
except ImportError:
    from src.url_utils import is_safe_url


class MusicServiceTest(unittest.TestCase):


    def test_queue_advancement_modes(self):
        # 1. loop_mode = 'off'
        q = QueueState()
        q.add(Track(track_id="t1", title="Song 1", duration_ms=60000))
        q.add(Track(track_id="t2", title="Song 2", duration_ms=60000))
        next_track = q.advance()
        self.assertIsNotNone(next_track)
        self.assertEqual(next_track.title, "Song 2")
        self.assertIsNone(q.advance())  # End of queue

        # 2. loop_mode = 'track'
        q_track = QueueState(loop_mode="track")
        q_track.add(Track(track_id="t1", title="Song 1", duration_ms=60000))
        q_track.add(Track(track_id="t2", title="Song 2", duration_ms=60000))
        repeat = q_track.advance()
        self.assertEqual(repeat.title, "Song 1")

        # 3. loop_mode = 'queue'
        q_queue = QueueState(loop_mode="queue")
        q_queue.add(Track(track_id="t1", title="Song 1", duration_ms=60000))
        q_queue.add(Track(track_id="t2", title="Song 2", duration_ms=60000))
        q_queue.advance()  # -> Song 2
        loop_back = q_queue.advance()  # -> loops back to Song 1
        self.assertEqual(loop_back.title, "Song 1")

    def test_shuffle_preserves_current_track(self):
        q = QueueState()
        t1 = Track(track_id="t1", title="Current Song", duration_ms=60000)
        t2 = Track(track_id="t2", title="Song 2", duration_ms=60000)
        t3 = Track(track_id="t3", title="Song 3", duration_ms=60000)
        q.add(t1)
        q.add(t2)
        q.add(t3)

        q.shuffle()
        self.assertEqual(q.tracks[0].track_id, "t1")
        self.assertEqual(len(q.tracks), 3)


    def test_is_safe_url_ssrf_protection(self):
        # Disallowed schemes and private/internal hosts
        self.assertFalse(is_safe_url("ftp://example.com/audio.mp3"))
        self.assertFalse(is_safe_url("http://localhost:8080/stream"))
        self.assertFalse(is_safe_url("http://127.0.0.1/admin"))
        self.assertFalse(is_safe_url("http://169.254.169.254/latest/meta-data"))
        self.assertFalse(is_safe_url("http://10.0.0.1/audio"))
        self.assertFalse(is_safe_url("http://192.168.1.50/stream"))
        self.assertFalse(is_safe_url("http://service.internal/secret"))
        self.assertFalse(is_safe_url("not-a-url"))

        # Allowed public HTTPS domains
        self.assertTrue(is_safe_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        self.assertTrue(is_safe_url("https://soundcloud.com/artist/track"))


if __name__ == "__main__":
    unittest.main()

