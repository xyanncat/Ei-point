#!/usr/bin/env bash
# Check actual readiness, not just a running process; project-scoped DB heartbeat validation.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT_DIR/scripts/health-fleet.mjs" "$@"
cid=$(docker ps -q --filter label=com.docker.compose.project=ei-point --filter label=com.docker.compose.service=api)
[[ -n "$cid" && "$cid" != *$'\n'* ]] || { echo 'Exactly one API container is required' >&2; exit 1; }
keys=$(node "$ROOT_DIR/scripts/release-roster.mjs" "$@")
docker exec "$cid" node scripts/check-heartbeats.mjs "$keys"
