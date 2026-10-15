FROM python:3.12-slim-bookworm

# PyTorch is installed from the CPU-only index. The service never needs CUDA,
# FlashAttention, or model downloads while it is running.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg sox libsox-fmt-all \
  && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
  torch==2.9.1 torchaudio==2.9.1
COPY apps/services/qwen-tts/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir --no-deps qwen-tts==0.1.1 \
  && python -m pip install --no-cache-dir -r /tmp/requirements.txt \
  && rm /tmp/requirements.txt

RUN groupadd --system --gid 10001 appuser \
  && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/appuser appuser
WORKDIR /app
COPY apps/services/qwen-tts/src /app/src
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HOME=/tmp/hf-home
EXPOSE 3120
CMD ["python", "-m", "src.main"]
