#!/usr/bin/env bash
# Deploy an explicit immutable release; never silently build/reuse a mutable image.
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
RELEASE_MANIFEST=${1:?Usage: deploy.sh release.json}
ENV_FILE=${ENV_FILE:-$ROOT_DIR/.env}
STATE_DIR=${RELEASE_STATE_DIR:-$ROOT_DIR/.releases}
HEALTH_ATTEMPTS=${RELEASE_HEALTH_ATTEMPTS:-180}
[[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]{0,2}$ ]] && (( HEALTH_ATTEMPTS<=180 )) || { echo 'RELEASE_HEALTH_ATTEMPTS must be between 1 and 180' >&2; exit 1; }
[[ -f "$ENV_FILE" && -f "$RELEASE_MANIFEST" ]] || { echo 'Release and environment files required' >&2; exit 1; }
: "${BACKUP_SNAPSHOT:?Select a verified BACKUP_SNAPSHOT before deployment}"
node scripts/verify-backup.mjs "$BACKUP_SNAPSHOT" --max-age-hours "${DEPLOY_BACKUP_MAX_AGE_HOURS:-24}" >/dev/null
USE=$(df -P "$ROOT_DIR" | awk 'NR==2{gsub(/%/,"",$5);print $5}')
(( USE<85 )) || { echo 'Insufficient deployment disk headroom' >&2; exit 1; }
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { echo 'Another deployment is active' >&2; exit 1; }
WORK=$(mktemp -d "$STATE_DIR/deploy.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
node scripts/release-manifest.mjs "$RELEASE_MANIFEST" "$WORK/release.compose.json"
mapfile -t BOTS < <(sed '/^$/d' "$WORK/release.compose.json.bots")
COMPOSE=(docker compose --project-name ei-point --env-file "$ENV_FILE" -f infra/docker/compose.yml -f "$WORK/release.compose.json")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull postgres nginx api web workers tts-qwen "${BOTS[@]}" migrate
# A single identity must never have old and replacement handlers running together.
"${COMPOSE[@]}" --profile legacy-disabled stop bot-security bot-moderation
bash scripts/stop-retired-bots.sh "$WORK/release.compose.json.bots"
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 90 postgres
pgid=$("${COMPOSE[@]}" ps -q postgres)
docker exec --user postgres "$pgid" sh -c 'exec pgbackrest --stanza=ei-point --pg1-user="$POSTGRES_USER" stanza-create'
docker exec --user postgres "$pgid" sh -c 'exec pgbackrest --stanza=ei-point --pg1-user="$POSTGRES_USER" check'
# Do not mutate the schema until WAL archiving has a usable repository.
"${COMPOSE[@]}" --profile maintenance run --rm --no-deps migrate
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 900 tts-qwen
"${COMPOSE[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 120 api web workers "${BOTS[@]}" nginx
healthy=false
for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++)); do
 if bash scripts/health-fleet.sh "$RELEASE_MANIFEST"; then healthy=true; break; fi
 sleep 5
done
if [[ "$healthy" != true ]]; then
 printf 'Release readiness failed. Previous release is preserved; use scripts/rollback.sh %s/current.json. Do not restore the database automatically.\n' "$STATE_DIR" >&2
 exit 1
fi
[[ ! -f "$STATE_DIR/current.json" ]] || cp -- "$STATE_DIR/current.json" "$STATE_DIR/previous.json"
cp -- "$RELEASE_MANIFEST" "$WORK/current.json"
mv -f -- "$WORK/current.json" "$STATE_DIR/current.json"
echo 'Release is ready; load/soak and restore acceptance remain separate gates.'
