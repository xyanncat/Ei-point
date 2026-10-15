#!/usr/bin/env bash
# Isolated logical artifact restore. This is not a WAL/PITR or RPO certification.
set -euo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
: "${BACKUP_SNAPSHOT:?Select an explicit completed BACKUP_SNAPSHOT directory}"
RTO_SECONDS=${RTO_SECONDS:-7200}
READY_SECONDS=${READY_SECONDS:-60}
[[ "$RTO_SECONDS" =~ ^[1-9][0-9]*$ && "$READY_SECONDS" =~ ^[1-9][0-9]*$ ]] || exit 1
START=$(date +%s)
DEADLINE=$((START+RTO_SECONDS))
bounded(){ local remaining=$((DEADLINE-$(date +%s))); ((remaining>0)) || { echo 'RTO exceeded' >&2; return 1; }; timeout "$remaining" "$@"; }
# Verify every required artifact before starting any Docker operation.
metadata=$(bounded node "$ROOT/scripts/verify-backup.mjs" "$BACKUP_SNAPSHOT")
database=$(printf '%s' "$metadata" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).database))')
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ei-point-restore-XXXXXX")
CONTAINER="ei-point-restore-$$-$(date +%s)"
cleanup(){ timeout 15 docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf -- "$WORK"; }
trap cleanup EXIT
password=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')
bounded docker run -d --name "$CONTAINER" --network none --label ei-point.restore-drill=true -e POSTGRES_USER=ei_restore_probe -e "POSTGRES_PASSWORD=$password" -e "POSTGRES_DB=$database" postgres:17.5 >/dev/null
READY_DEADLINE=$(( $(date +%s)+READY_SECONDS ))
until bounded docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U ei_restore_probe -d "$database" >/dev/null 2>&1; do
  (( $(date +%s)<READY_DEADLINE && $(date +%s)<DEADLINE )) || { echo 'Restore database readiness timeout' >&2; exit 1; }
  sleep 1
done
bounded docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U ei_restore_probe -d "$database" < "$BACKUP_SNAPSHOT/roles.sql"
bounded docker exec -i "$CONTAINER" pg_restore --exit-on-error -U ei_restore_probe -d "$database" < "$BACKUP_SNAPSHOT/postgres.dump"
# A real SQL read after restore; schema recreation from migrations is forbidden.
bounded docker exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U ei_restore_probe -d "$database" -c "SELECT count(*) AS restored_user_tables FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"
bounded python3 "$ROOT/infra/backup/extract-artwork.py" "$BACKUP_SNAPSHOT/artwork.tar.gz" "$WORK/artwork"
ELAPSED=$(( $(date +%s)-START ))
((ELAPSED<=RTO_SECONDS)) || { echo 'Restore exceeded RTO' >&2; exit 1; }
printf 'Logical bundle restore PASS: database=%s elapsed=%ss; artifact hashes, pg_restore, SQL read and extracted artwork content verified. WAL/PITR and recovery-point age were not tested.\n' "$database" "$ELAPSED"
