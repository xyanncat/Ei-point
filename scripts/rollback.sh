#!/usr/bin/env bash
# Application rollback uses a previous immutable release and preserves database writes.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PREVIOUS=${1:?Usage: rollback.sh previous-release.json}
ENV_FILE=${ENV_FILE:-$ROOT_DIR/.env}
STATE_DIR=${RELEASE_STATE_DIR:-$ROOT_DIR/.releases}
HEALTH_ATTEMPTS=${RELEASE_HEALTH_ATTEMPTS:-180}
[[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]{0,2}$ ]] && (( HEALTH_ATTEMPTS<=180 )) || { echo 'RELEASE_HEALTH_ATTEMPTS must be between 1 and 180' >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo 'Environment file required' >&2; exit 1; }
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { echo 'Another release operation is active' >&2; exit 1; }
WORK=$(mktemp -d "$STATE_DIR/rollback.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
node scripts/release-manifest.mjs "$PREVIOUS" "$WORK/previous.compose.json" --allow-missing-tts
mapfile -t BOTS < <(sed '/^$/d' "$WORK/previous.compose.json.bots")
COMPOSE=(docker compose --project-name ei-point --env-file "$ENV_FILE" -f infra/docker/compose.yml -f "$WORK/previous.compose.json")
if [[ "$(cat "$WORK/previous.compose.json.tts")" == 1 ]]; then
  "${COMPOSE[@]}" pull api web workers tts-qwen "${BOTS[@]}"
else
  "${COMPOSE[@]}" pull api web workers "${BOTS[@]}"
fi
"${COMPOSE[@]}" --profile legacy-disabled stop bot-security bot-moderation
bash scripts/stop-retired-bots.sh "$WORK/previous.compose.json.bots"
if [[ "$(cat "$WORK/previous.compose.json.tts")" == 1 ]]; then
  "${COMPOSE[@]}" up -d --no-build tts-qwen
else
  # The old manifest has no local inference service, so release its CPU and memory.
  TTS_CONTAINER=$("${COMPOSE[@]}" ps -q tts-qwen)
  if [[ -n "$TTS_CONTAINER" ]]; then "${COMPOSE[@]}" stop tts-qwen; fi
fi
"${COMPOSE[@]}" up -d --no-build --no-deps --wait --wait-timeout 120 api web workers "${BOTS[@]}"
healthy=false
for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++)); do
 if bash scripts/health-fleet.sh "$PREVIOUS"; then healthy=true; break; fi
 sleep 5
done
[[ "$healthy" == true ]] || { echo 'Previous release readiness failed after bounded retries' >&2; exit 1; }
if [[ ! "$PREVIOUS" -ef "$STATE_DIR/current.json" ]]; then
 cp -- "$PREVIOUS" "$WORK/current.json"
 mv -f -- "$WORK/current.json" "$STATE_DIR/current.json"
fi
echo 'Previous application release is ready. Database and persistent volumes were preserved.'
