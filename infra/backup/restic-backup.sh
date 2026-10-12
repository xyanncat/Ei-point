#!/usr/bin/env bash
# Restic file volume backup script for Ei Point (§9)
# Backs up durable artwork, uploads, and configuration to encrypted off-host S3 storage.
# Excludes disposable music cache (/srv/music-cache) and logs.
set -euo pipefail

export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-s3:${S3_ENDPOINT:-s3.amazonaws.com}/${S3_BACKUP_BUCKET:-ei-point-backups}/files}"
export RESTIC_PASSWORD="${RESTIC_PASSWORD:-${BACKUP_CIPHER_PASSPHRASE:-}}"
export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}"
export AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}"

if [ -z "$RESTIC_PASSWORD" ]; then
  echo "[ERROR] RESTIC_PASSWORD or BACKUP_CIPHER_PASSPHRASE must be set" >&2
  exit 1
fi

# Ensure repository is initialized
if ! restic snapshots >/dev/null 2>&1; then
  echo "[INFO] Initializing new restic repository at $RESTIC_REPOSITORY..."
  restic init
fi

echo "[INFO] Running restic backup of durable project assets and configuration..."
restic backup \
  --tag "ei-point" \
  --exclude "*/music-cache/*" \
  --exclude "*/logs/*" \
  --exclude "*.tmp" \
  /srv/artwork \
  /etc/ei-point \
  ${EXTRA_BACKUP_PATHS:-}

echo "[INFO] Pruning old snapshots (keeping 7 daily, 4 weekly)..."
restic forget \
  --keep-daily 7 \
  --keep-weekly 4 \
  --prune

echo "[INFO] Restic backup completed successfully."
