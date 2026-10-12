"""Queue state: pure in-memory model with snapshot serialization.

Playback position snapshots persist every 15 s (music.queue_snapshots); a reboot
restores the queue but Discord voice continuity is best-effort (plan section 4).
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

    def snapshot(self) -> dict:
        return {
            "queue": [
                {
                    "track_id": t.track_id,
                    "title": t.title,
                    "duration_ms": t.duration_ms,
                    "url": getattr(t, "url", ""),
                    "webpage_url": getattr(t, "webpage_url", ""),
                }
                for t in self.tracks
            ],
            "position": self.position,
            "position_ms": self.position_ms,
            "loop_mode": self.loop_mode,
            "volume": self.volume,
        }

    @classmethod
    def restore(cls, data: dict) -> "QueueState":
        tracks = [
            Track(
                track_id=t["track_id"],
                title=t["title"],
                duration_ms=t.get("duration_ms", 0),
                url=t.get("url", ""),
                webpage_url=t.get("webpage_url", ""),
            )
            for t in data.get("queue", [])
        ]
        q = cls(tracks=tracks)
        q.position = min(int(data.get("position", 0)), max(0, len(tracks) - 1)) if tracks else 0
        q.position_ms = max(0, int(data.get("position_ms", 0)))
        if data.get("loop_mode") in ("off", "track", "queue"):
            q.loop_mode = data["loop_mode"]
        volume = int(data.get("volume", 100))
        q.volume = max(0, min(150, volume))
        return q
