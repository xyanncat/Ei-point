#!/usr/bin/env bash
# Ei Point — local VPS backup to /srv/backups (§9 local tier).
# No outer source required. Runs every 6h via ei-point-local-backup.timer.
# Captures: postgres custom-format dump + roles, artwork volume tarball, manifest.
# Retention: keep newest $LOCAL_BACKUP_KEEP snapshots (default 28 = 7 days @6h).
# Install: install -m 0750 infra/backup/local-backup.sh /usr/local/bin/ei-point-local-backup.sh
#          cp infra/systemd/ei-point-local-backup.* /etc/systemd/system/
#          systemctl daemon-reload && systemctl enable --now ei-point-local-backup.timer
set -euo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups}"
KEEP="${LOCAL_BACKUP_KEEP:-28}"
# Guard the only operator-tunable destructive input: non-numeric aborts -gt,
# 0/negative would prune the snapshot published seconds earlier.
[[ "$KEEP" =~ ^[0-9]+$ ]] || KEEP=28
(( KEEP >= 1 )) || KEEP=1
ENV_FILE="${ENV_FILE:-/srv/ei-point/.env}"
SNAP="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$SNAP.partial"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
# SIGKILL/power loss skips the EXIT trap: drop orphaned partials from dead runs.
rm -rf "$BACKUP_ROOT"/*.partial 2>/dev/null || true
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Load DB credentials (600-root file, never echoed).
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-ei_point_admin}"
POSTGRES_DB="${POSTGRES_DB:-ei_point}"
if [ -z "${POSTGRES_ADMIN_PASSWORD:-}" ]; then
  echo "[ERROR] POSTGRES_ADMIN_PASSWORD not set (checked $ENV_FILE)" >&2
  exit 1
fi

cid=$(docker ps -q --filter "label=com.docker.compose.project=ei-point" --filter "label=com.docker.compose.service=postgres" | head -n 1)
if [ -z "$cid" ]; then
  echo "[ERROR] postgres container not running — aborting snapshot" >&2
  rmdir "$WORK"
  trap - EXIT
  exit 1
fi

echo "[INFO] dumping postgres ($POSTGRES_DB) ..."
# Note: -e embeds the password in the docker client argv (briefly visible in
# host ps). Accepted residual risk: single-tenant VPS, root-only users, and
# compose already exposes the same value in container env. Never echoed/logged.
docker exec -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" "$cid" \
  pg_dump -U "$POSTGRES_ADMIN_USER" -d "$POSTGRES_DB" -Fc > "$WORK/postgres.dump"
docker exec -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" "$cid" \
  pg_dumpall -U "$POSTGRES_ADMIN_USER" --roles-only > "$WORK/roles.sql"

artwork_vol=$(docker volume ls -q --filter "label=com.docker.compose.project=ei-point" --filter "label=com.docker.compose.volume=artwork" | head -n 1 || true)
artwork_state="present"
if [ -n "$artwork_vol" ]; then
  echo "[INFO] archiving volume $artwork_vol ..."
  docker run --rm -v "$artwork_vol:/src:ro" -v "$WORK:/dst" alpine:3.20 \
    tar -czf /dst/artwork.tar.gz -C /src . >/dev/null
else
  echo "[WARN] artwork volume not found — skipping file tier" >&2
  artwork_state="skipped (volume not found)"
fi

chmod 600 "$WORK"/postgres.dump "$WORK"/roles.sql 2>/dev/null || true
[ -f "$WORK/artwork.tar.gz" ] && chmod 600 "$WORK/artwork.tar.gz" || true
{
  echo "date=$(date -u +%FT%TZ)"
  echo "db=$POSTGRES_DB"
  echo "artwork=$artwork_state"
  ( cd "$WORK" && sha256sum postgres.dump roles.sql artwork.tar.gz 2>/dev/null || true )
  du -sh "$WORK" | awk '{print "size="$1}'
} > "$WORK/manifest.txt"
chmod 600 "$WORK/manifest.txt"

# Atomic publish: prune only ever sees completed snapshots.
mv -T "$WORK" "$SNAP"
trap - EXIT

# Prune oldest beyond $KEEP (newest-first sort keeps $KEEP; partials excluded —
# startup already swept them, this is belt-and-braces for concurrent readers).
mapfile -t snaps < <(ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | grep -v '\.partial/$' | sort -r || true)
if [ "${#snaps[@]}" -gt "$KEEP" ]; then
  for old in "${snaps[@]:$KEEP}"; do rm -rf "$old"; done
  echo "[INFO] pruned to $KEEP snapshots"
fi

logger -t ei-point-backup "local snapshot OK: $SNAP" || true
echo "[OK] $SNAP"
