"""Phase 2 stub: isolated music service (discord.py + yt-dlp + FFmpeg). Full queue + persistence in Phase 8."""
import os

token = os.environ.get("BOT_TOKEN")
if not token:
    raise SystemExit("BOT_TOKEN is not set (see .env.example)")

print("music-py init ok (Phase 8 implements playback)")

# Keep the container alive until real playback loop lands (Phase 8).
import time
while True:
    time.sleep(3600)
