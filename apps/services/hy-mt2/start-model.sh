#!/bin/sh
set -eu

MODEL_DIR=${MODEL_DIR:-/models}
MODEL_NAME=${MODEL_NAME:-Hy-MT2-1.8B-Q4_K_M.gguf}
MODEL_EXEC=${MODEL_EXEC:-/app/llama-server}
MODEL="$MODEL_DIR/$MODEL_NAME"
CHECKSUM="$MODEL_DIR/ei-point-model.sha256"
if [ ! -s "$MODEL" ] || [ ! -s "$CHECKSUM" ]; then
  echo "Pinned Hy-MT2 model file or checksum manifest is missing" >&2
  exit 1
fi
cd "$MODEL_DIR"
# The manifest must pin exactly the served GGUF: one well-formed entry whose
# filename equals the served model. Unrelated-only, traversal, swapped-name or
# multi-entry manifests must never satisfy verification (A10).
if [ "$(grep -c '' ei-point-model.sha256)" -ne 1 ]; then
  echo "Checksum manifest must pin exactly the served Hy-MT2 model file" >&2
  exit 1
fi
hash=
name=
IFS=' ' read -r hash name < ei-point-model.sha256 || [ -n "$hash" ]
if [ "${#hash}" -ne 64 ]; then
  echo "Checksum manifest must pin exactly the served Hy-MT2 model file" >&2
  exit 1
fi
case "$hash" in
  *[!0-9a-fA-F]*) echo "Checksum manifest must pin exactly the served Hy-MT2 model file" >&2; exit 1 ;;
esac
case "$name" in
  "$MODEL_NAME"|"*$MODEL_NAME") ;;
  *) echo "Checksum manifest must pin exactly the served Hy-MT2 model file" >&2; exit 1 ;;
esac
sha256sum --strict --check ei-point-model.sha256
exec "$MODEL_EXEC" "$@"
