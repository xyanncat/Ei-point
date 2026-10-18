"""Queue state: pure in-memory model for the live voice session.

Owner decision 2026-10-18: the queue is session-scoped - leaving voice clears
it and nothing is restored across restarts; state lives only in memory.
No discord.py imports here — keep this module dependency-free and unit-tested.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field


@dataclass
class Track:
    track_id: str
    title: str
    duration_ms: int
    url: str = ""
    webpage_url: str = ""


@dataclass
class QueueState:
    tracks: list[Track] = field(default_factory=list)
    position: int = 0  # index of the current track
    position_ms: int = 0  # offset inside the current track
    loop_mode: str = "off"  # off | track | queue
    volume: int = 100

    def add(self, track: Track) -> int:
        self.tracks.append(track)
        return len(self.tracks)

    def remove(self, track_id: str) -> bool:
        for i, t in enumerate(self.tracks):
            if t.track_id == track_id:
                del self.tracks[i]
                if self.position >= len(self.tracks):
                    self.position = max(0, len(self.tracks) - 1)
                return True
        return False

    def shuffle(self, rng: random.Random | None = None) -> None:
        rng = rng or random.Random()
        current = self.tracks[self.position] if self.tracks else None
        rest = [t for i, t in enumerate(self.tracks) if i != self.position]
        rng.shuffle(rest)
        if current is None:
            self.tracks = rest
            self.position = 0
        else:
            self.tracks = [current, *rest]
            self.position = 0

    def advance(self) -> Track | None:
        """Move to the next track honoring loop_mode. Returns it (or None)."""
        if not self.tracks:
            return None
        if self.loop_mode == "track":
            self.position_ms = 0
            return self.tracks[self.position]
        if self.position + 1 < len(self.tracks):
            self.position += 1
            self.position_ms = 0
            return self.tracks[self.position]
        if self.loop_mode == "queue":
            self.position = 0
            self.position_ms = 0
            return self.tracks[0]
        return None
