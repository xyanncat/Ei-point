#!/usr/bin/env bash
# Application rollback uses a previous immutable release and preserves database writes.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PREVIOUS=${1:?Usage: rollback.sh previous-release.json}
ENV_FILE=${ENV_FILE:-$ROOT_DIR/.env}
STATE_DIR=${RELEASE_STATE_DIR:-$ROOT_DIR/.releases}
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { echo 'Another release operation is active' >&2; exit 1; }
WORK=$(mktemp -d "$STATE_DIR/rollback.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
node scripts/release-manifest.mjs "$PREVIOUS" "$WORK/previous.compose.json"
mapfile -t BOTS < <(sed '/^$/d' "$WORK/previous.compose.json.bots")
COMPOSE=(docker compose --project-name ei-point --env-file "$ENV_FILE" -f infra/docker/compose.yml -f "$WORK/previous.compose.json")
"${COMPOSE[@]}" pull api web workers "${BOTS[@]}"
"${COMPOSE[@]}" --profile legacy-disabled stop bot-security bot-moderation
bash scripts/stop-retired-bots.sh "$WORK/previous.compose.json.bots"
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 120 api web workers "${BOTS[@]}"
healthy=false
for attempt in {1..12}; do
 if bash scripts/health-fleet.sh "$PREVIOUS"; then healthy=true; break; fi
 sleep 5
done
[[ "$healthy" == true ]] || { echo 'Previous release readiness failed after bounded retries' >&2; exit 1; }
if [[ ! "$PREVIOUS" -ef "$STATE_DIR/current.json" ]]; then
 cp -- "$PREVIOUS" "$WORK/current.json"
 mv -f -- "$WORK/current.json" "$STATE_DIR/current.json"
fi
echo 'Previous application release is ready. Database and persistent volumes were preserved.'
