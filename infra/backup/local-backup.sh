#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
: "${ENV_FILE:?Set ENV_FILE to the deployment environment file}"
[[ -f "$ENV_FILE" ]] || { echo 'Environment file missing' >&2; exit 1; }
set -a
. "$ENV_FILE"
set +a
BACKUP_ROOT=${BACKUP_ROOT:-/srv/backups}
PROJECT=${COMPOSE_PROJECT_NAME:-ei-point}
KEEP=${LOCAL_BACKUP_KEEP:-28}
PHYSICAL_TYPE=${PGBACKREST_BACKUP_TYPE:-incr}
[[ "$PHYSICAL_TYPE" =~ ^(full|diff|incr)$ ]] || { echo 'Invalid physical backup type' >&2; exit 1; }
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo 'LOCAL_BACKUP_KEEP must be positive' >&2; exit 1; }
: "${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD required}"
POSTGRES_ADMIN_USER=${POSTGRES_ADMIN_USER:-ei_point_admin}
POSTGRES_DB=${POSTGRES_DB:-ei_point}
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
mapfile -t containers < <(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=postgres)
[[ ${#containers[@]} == 1 && -n ${containers[0]} ]] || { echo 'Expected exactly one running project postgres' >&2; exit 1; }
cid=${containers[0]}
mapfile -t volumes < <(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.volume=artwork)
[[ ${#volumes[@]} == 1 && -n ${volumes[0]} ]] || { echo 'Expected artwork volume; refusing incomplete backup' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
SNAP="$BACKUP_ROOT/$stamp"
[[ ! -e "$SNAP" ]] || { echo 'Snapshot timestamp already exists' >&2; exit 1; }
WORK=$(mktemp -d "$BACKUP_ROOT/$stamp.partial.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
# Logical recovery bundle. Passwords are omitted from role exports.
docker exec -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" "$cid" pg_dump -U "$POSTGRES_ADMIN_USER" -d "$POSTGRES_DB" -Fc > "$WORK/postgres.dump"
docker exec -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" "$cid" pg_dumpall -U "$POSTGRES_ADMIN_USER" --roles-only --no-role-passwords > "$WORK/roles.sql"
docker run --rm -v "${volumes[0]}:/src:ro" -v "$WORK:/dst" alpine:3.20 tar -czf /dst/artwork.tar.gz -C /src .
node "$ROOT/infra/backup/bundle.mjs" create "$WORK" "$POSTGRES_DB"
# Physical tier must also succeed; do not publish a successful partial run.
docker exec --user postgres "$cid" pgbackrest --stanza=ei-point --pg1-user="$POSTGRES_ADMIN_USER" stanza-create
docker exec --user postgres "$cid" pgbackrest --stanza=ei-point --pg1-user="$POSTGRES_ADMIN_USER" check
docker exec --user postgres "$cid" pgbackrest --stanza=ei-point --pg1-user="$POSTGRES_ADMIN_USER" --type="$PHYSICAL_TYPE" backup
mv -- "$WORK" "$SNAP"
trap - EXIT
# Only exact timestamp directories are retention candidates. Never sweep partials.
mapfile -t snapshots < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort -r)
count=0
for name in "${snapshots[@]}"; do
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  ((count+=1))
  if (( count > KEEP )); then rm -rf -- "$BACKUP_ROOT/$name"; fi
done
echo "Backup complete: $SNAP (logical artifacts plus local physical tier; no off-host or RPO certification)"
