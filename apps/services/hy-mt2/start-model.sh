#!/bin/sh
set -eu

MODEL=/models/Hy-MT2-1.8B-Q4_K_M.gguf
CHECKSUM=/models/ei-point-model.sha256
if [ ! -s "$MODEL" ] || [ ! -s "$CHECKSUM" ]; then
  echo "Pinned Hy-MT2 model file or checksum manifest is missing" >&2
  exit 1
fi
(cd /models && sha256sum --strict --check "$(basename "$CHECKSUM")")
exec /app/llama-server "$@"
