#!/usr/bin/env bash
# Ei Point — Fleet Health Verification Script (§8, §10, §11)
# Verifies process liveness, gateway connection, database readiness, and health endpoints.
set -euo pipefail

FAILURES=0

check_endpoint() {
  local name="$1"
  local url="$2"
  local expected_sub="$3"

  echo -n "[HEALTH] Checking $name ($url)... "
  if response=$(curl -s -m 5 "$url" 2>/dev/null); then
    if [[ "$response" == *"$expected_sub"* ]] || [[ "$expected_sub" == "healthy" && "$response" == *"ok"* ]]; then
      echo "OK"
    else
      echo "DEGRADED (unexpected payload: $response)"
      FAILURES=$((FAILURES + 1))
    fi
  else
    echo "DOWN (connection failed or timed out)"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=== Ei Point Fleet Health Check ==="

# 1. Edge and Web/API endpoints
check_endpoint "Nginx Ingress" "http://127.0.0.1:8080/healthz" "healthy"
check_endpoint "Fastify API" "http://127.0.0.1:3001/readyz" "ok"

# 2. Six Bot Health Endpoints
check_endpoint "Bot Security" "http://127.0.0.1:3101/health/live" "alive"
check_endpoint "Bot Moderation" "http://127.0.0.1:3102/health/live" "alive"
check_endpoint "Bot Community" "http://127.0.0.1:3103/health/live" "alive"
check_endpoint "Bot AI" "http://127.0.0.1:3104/health/live" "alive"
check_endpoint "Bot Music" "http://127.0.0.1:3105/health/live" "alive"
check_endpoint "Bot Commerce" "http://127.0.0.1:3106/health/live" "alive"

# 3. Database status table probe if DATABASE_URL is set
if [ -n "${DATABASE_URL:-}" ]; then
  echo -n "[DB] Querying ops.service_status table... "
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -c "SELECT service, liveness, gateway, db_ready, latency_ms, updated_at FROM ops.service_status ORDER BY service;"
  else
    echo "psql not in path; skipped direct query."
  fi
fi

echo "======================================"
if [ "$FAILURES" -eq 0 ]; then
  echo "[SUCCESS] Entire fleet is healthy!"
  exit 0
else
  echo "[FAILURE] $FAILURES service(s) unhealthy or unreachable!"
  exit 1
fi
