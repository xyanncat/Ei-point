FROM python:3.12-slim-bookworm

# CPU-only runtime. The service loads the pre-downloaded Pocket weights and the
# precomputed Cyrene voice state from read-only mounts; it never downloads at
# runtime and never needs CUDA.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
  && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.9.1 \
  && python -m pip install --no-cache-dir "pocket-tts[audio]==3.3.0" \
  && python -m pip install --no-cache-dir "numpy==2.2.6"

RUN groupadd --system --gid 10001 appuser \
  && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/appuser appuser
WORKDIR /app
COPY apps/services/pocket-tts/src /app/src
COPY apps/services/pocket-tts/prepare_voice.py /app/prepare_voice.py
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf-cache \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1
EXPOSE 3120
CMD ["python", "-m", "src.main"]
