"""Queue-state unit tests: run with `python -m unittest discover -s tests`."""
import random
import unittest

from src.queue_state import QueueState, Track


def track(i: int) -> Track:
    return Track(track_id=f"t{i}", title=f"song {i}", duration_ms=180_000)


class QueueTest(unittest.TestCase):
    def test_add_remove(self) -> None:
        q = QueueState()
        q.add(track(1))
        q.add(track(2))
        self.assertTrue(q.remove("t1"))
        self.assertFalse(q.remove("missing"))
        self.assertEqual([t.track_id for t in q.tracks], ["t2"])

    def test_advance_plain_stops_at_end(self) -> None:
        q = QueueState(tracks=[track(1), track(2)])
        self.assertEqual(q.advance().track_id, "t2")  # type: ignore[union-attr]
        self.assertIsNone(q.advance())

    def test_loop_modes(self) -> None:
        q = QueueState(tracks=[track(1), track(2)], loop_mode="track")
        self.assertEqual(q.advance().track_id, "t1")  # type: ignore[union-attr]
        q.loop_mode = "queue"
        q.position = 1
        self.assertEqual(q.advance().track_id, "t1")  # type: ignore[union-attr]
        self.assertEqual(q.position, 0)

    def test_shuffle_keeps_current_first(self) -> None:
        q = QueueState(tracks=[track(i) for i in range(5)])
        q.position = 2
        q.shuffle(random.Random(7))
        self.assertEqual(q.tracks[0].track_id, "t2")
        self.assertEqual(q.position, 0)
        self.assertEqual(len(q.tracks), 5)



if __name__ == "__main__":
    unittest.main()
