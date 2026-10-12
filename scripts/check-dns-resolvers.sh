#!/usr/bin/env bash
# Ei Point — DNS Resolver Health Check (§8, VPS Benchmark Finding #12)
# Asserts that 1.1.1.1 is never used, and tests resolution through configured fallbacks.
set -euo pipefail

RESOLVERS=("10.0.0.1" "8.8.8.8" "9.9.9.9")
FORBIDDEN="1.1.1.1"
PROBE_DOMAINS=("discord.com" "gateway.discord.gg" "github.com")

echo "=== Ei Point DNS Resolver Audit ==="

# 1. Audit Compose configuration for forbidden 1.1.1.1
if grep -rn "$FORBIDDEN" infra/docker/; then
  echo "[FATAL] Found forbidden IP $FORBIDDEN in Docker Compose files!" >&2
  exit 1
fi
echo "[OK] No usage of forbidden $FORBIDDEN in compose configs."

# 2. Test each configured resolver
for ip in "${RESOLVERS[@]}"; do
  echo -n "[CHECK] Probing resolver $ip... "
  if dig +short +time=3 +tries=2 @$ip discord.com >/dev/null 2>&1 || nslookup -timeout=3 discord.com $ip >/dev/null 2>&1; then
    echo "HEALTHY"
  else
    echo "FAILED/UNREACHABLE (may be expected if local resolver 10.0.0.1 not yet bound on dev host)"
  fi
done

# 3. Test active resolution of critical domains
for domain in "${PROBE_DOMAINS[@]}"; do
  echo -n "[CHECK] Resolving $domain... "
  if getent hosts "$domain" >/dev/null 2>&1 || ping -c 1 -W 2 "$domain" >/dev/null 2>&1; then
    echo "RESOLVED"
  else
    echo "FAILED"
  fi
done

echo "=== DNS Resolver Audit Complete ==="
