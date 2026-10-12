#!/usr/bin/env bash
# Ei Point — Safe Deployment and Cutover Script (§10, §12)
# Enforces pre-flight checks, schema migrations, asset validation, container updates, and health gating.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "=========================================================="
echo " Starting Ei Point Fleet Deployment"
echo "=========================================================="

# 1. Pre-flight Environment Checks
echo "[STEP 1/5] Checking environment and resource envelopes..."
if [ ! -f ".env" ]; then
  echo "[FATAL] .env file not found! Copy from .env.example and configure secrets." >&2
  exit 1
fi

# Disk usage check
DISK_USAGE=$(df -P / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -ge 85 ]; then
  echo "[FATAL] Host disk usage is critical (${DISK_USAGE}%). Clean disk before deploying." >&2
  exit 1
fi
echo "[OK] Host disk usage is ${DISK_USAGE}%."

# 2. Asset and Manifest Validation
echo "[STEP 2/5] Validating project assets and generating manifests..."
node scripts/build-project-assets.mjs

# 3. Database Schema Migrations (backward-compatible)
echo "[STEP 3/5] Applying forward database migrations..."
node infra/postgres/run-migrations.mjs

# 4. Compose Service Rolling Update
echo "[STEP 4/5] Deploying container release with Docker Compose..."
docker compose --env-file .env -f infra/docker/compose.yml up -d --remove-orphans

# 5. Post-deploy Fleet Health Gate
echo "[STEP 5/5] Running fleet health check and gating..."
ATTEMPTS=0
MAX_ATTEMPTS=12
until bash scripts/health-fleet.sh || [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  echo "[WAIT] Fleet warming up... attempt $ATTEMPTS of $MAX_ATTEMPTS (sleeping 5s)"
  sleep 5
done

if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
  echo "[FATAL] Fleet health check failed after deploy!" >&2
  echo "[ROLLBACK] To roll back, run: docker compose --env-file .env -f infra/docker/compose.yml down && docker compose --env-file .env -f infra/docker/compose.yml up -d" >&2
  exit 1
fi

echo "=========================================================="
echo " [SUCCESS] Ei Point Fleet Deployed and Verified Healthy"
echo "=========================================================="
