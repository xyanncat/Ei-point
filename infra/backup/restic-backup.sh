#!/usr/bin/env bash
# Host-root service: resolves the actual project named-volume mountpoints.
set -euo pipefail
umask 077
: "${ENV_FILE:?Set ENV_FILE to the deployment environment file}"
[[ -f "$ENV_FILE" ]] || { echo 'Environment file missing' >&2; exit 1; }
set -a
. "$ENV_FILE"
set +a
: "${RESTIC_REPOSITORY:?Configure an off-host restic repository explicitly}"
: "${RESTIC_PASSWORD:?Configure an encryption password explicitly}"
case "$RESTIC_REPOSITORY" in s3:*|sftp:*|rest:*|azure:*|gs:*|b2:*) ;; *) echo 'Off-host repository URL required' >&2; exit 1;; esac
export RESTIC_REPOSITORY RESTIC_PASSWORD
export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}"
export AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
PROJECT=${COMPOSE_PROJECT_NAME:-ei-point}
BACKUP_ROOT=${BACKUP_ROOT:-/srv/backups}
mkdir -p "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
paths=()
for name in artwork pgbackrest; do
  mapfile -t ids < <(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.volume=$name")
  [[ ${#ids[@]} == 1 && -n ${ids[0]} ]] || { echo "Expected project volume: $name" >&2; exit 1; }
  mountpoint=$(docker volume inspect --format '{{ .Mountpoint }}' "${ids[0]}")
  [[ "$mountpoint" == /* && -d "$mountpoint" ]] || { echo "Volume is not host-accessible: $name" >&2; exit 1; }
  if [[ "$name" == pgbackrest ]]; then
    [[ -f "$mountpoint/backup/ei-point/backup.info" ]] || { echo 'Physical backup stanza has not been initialized' >&2; exit 1; }
    completed=$(find "$mountpoint/backup/ei-point" -mindepth 2 -maxdepth 2 -type f -name backup.manifest -print -quit)
    [[ -n "$completed" ]] || { echo 'No completed physical base backup is available' >&2; exit 1; }
  fi
  paths+=("$mountpoint")
done
# Initialisation is a deliberate operator action. Auth, network, and corruption
# failures must never trigger init or be reported as successful backups.
restic snapshots >/dev/null
restic backup --tag ei-point --tag physical-and-artwork -- "$ENV_FILE" "${paths[@]}"
restic forget --tag ei-point --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --prune
echo 'Off-host encrypted backup completed; restore/PITR acceptance still requires a measured drill.'
