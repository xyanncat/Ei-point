FROM python:3.12-slim-bookworm
# Isolated music service: discord.py + yt-dlp + FFmpeg (§3). Verify on target CPU before prod.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 10001 appuser
WORKDIR /app
COPY apps/bots/music-py/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/bots/music-py/src ./src
RUN mkdir -p /srv/music-cache && chown -R appuser:appuser /srv/music-cache /app
USER appuser
CMD ["python", "src/main.py"]
