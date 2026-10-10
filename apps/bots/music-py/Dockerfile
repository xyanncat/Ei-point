FROM python:3.12-slim-bookworm
# Isolated music service: discord.py + yt-dlp + FFmpeg (§3). Verify on target CPU before prod.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
CMD ["python", "--version"]
