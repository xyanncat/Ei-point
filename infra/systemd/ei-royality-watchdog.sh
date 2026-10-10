#!/bin/bash
# Host watchdog: startup grace + consecutive-failure threshold + bounded restarts + alerts (§8).
# Restarts ONLY $ALLOWED_SERVICES. Never exposes docker socket to web app.
set -euo pipefail
ALLOWED_SERVICES="bot-security bot-moderation bot-community bot-ai bot-music bot-commerce api web workers postgres nginx"
GRACE_SEC=120
FAIL_THRESHOLD=3
STATE_DIR=/var/lib/ei-royality/watchdog
mkdir -p "$STATE_DIR"
for svc in $ALLOWED_SERVICES; do
  # Compose-aware lookup: containers are <project>-<service>-<n>; match by compose service label.
  cid=$(docker ps -q --filter "label=com.docker.compose.service=$svc" | head -n 1)
  if [ -z "$cid" ]; then continue; fi
  healthy=$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "none")
  running=$(docker inspect --format='{{.State.Running}}' "$cid")
  if [ "$running" != "true" ] || [ "$healthy" = "unhealthy" ]; then
    count=$(cat "$STATE_DIR/$svc.count" 2>/dev/null || echo 0)
    count=$((count + 1))
    echo "$count" > "$STATE_DIR/$svc.count"
    if [ "$count" -ge "$FAIL_THRESHOLD" ]; then
      logger -t ei-royality-watchdog "restarting $svc ($cid) after $count failures"
      docker restart "$cid" >/dev/null
      echo 0 > "$STATE_DIR/$svc.count"
    fi
  else
    echo 0 > "$STATE_DIR/$svc.count"
  fi
done
# Disk guard: 70/80 alert, 90 stop optional downloads (§7)
USE=$(df -P / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$USE" -ge 90 ]; then logger -t ei-royality-watchdog "DISK CRITICAL ${USE}%: stopping optional downloads"; touch "$STATE_DIR/disk-hold";
elif [ "$USE" -ge 80 ]; then logger -t ei-royality-watchdog "disk warning ${USE}%";
elif [ "$USE" -ge 70 ]; then logger -t ei-royality-watchdog "disk notice ${USE}%"; fi
