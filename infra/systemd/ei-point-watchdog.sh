#!/bin/bash
# Host watchdog: startup grace + consecutive-failure threshold + bounded restarts + alerts (§8).
# Restarts ONLY $ALLOWED_SERVICES. Never exposes docker socket to web app.
set -euo pipefail
ALLOWED_SERVICES="bot-security bot-moderation bot-community bot-ai bot-music bot-commerce api web workers postgres nginx"
GRACE_SEC=120
FAIL_THRESHOLD=3
MAX_RESTARTS_PER_HOUR=3
STATE_DIR=/var/lib/ei-point/watchdog
NOW=$(date +%s)
mkdir -p "$STATE_DIR"

for svc in $ALLOWED_SERVICES; do
  # Compose-aware lookup: containers are <project>-<service>-<n>; match by compose service label.
  cid=$(docker ps -aq --filter "label=com.docker.compose.service=$svc" | head -n 1)
  if [ -z "$cid" ]; then continue; fi

  # Check startup grace period
  started_str=$(docker inspect --format='{{.State.StartedAt}}' "$cid" 2>/dev/null || true)
  if [ -n "$started_str" ]; then
    started_ts=$(date -d "$started_str" +%s 2>/dev/null || echo 0)
    uptime=$((NOW - started_ts))
    if [ "$uptime" -lt "$GRACE_SEC" ]; then
      continue # Inside startup grace period
    fi
  fi

  healthy=$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "none")
  running=$(docker inspect --format='{{.State.Running}}' "$cid" 2>/dev/null || echo "false")

  if [ "$running" != "true" ] || [ "$healthy" = "unhealthy" ]; then
    count=$(cat "$STATE_DIR/$svc.count" 2>/dev/null || echo 0)
    count=$((count + 1))
    echo "$count" > "$STATE_DIR/$svc.count"

    if [ "$count" -ge "$FAIL_THRESHOLD" ]; then
      # Bounded restarts: check hourly restart budget
      restart_log="$STATE_DIR/$svc.restarts"
      # Purge restarts older than 3600 seconds
      if [ -f "$restart_log" ]; then
        awk -v cutoff=$((NOW - 3600)) '$1 > cutoff' "$restart_log" > "$restart_log.tmp" || true
        mv "$restart_log.tmp" "$restart_log"
      fi
      recent_restarts=$(wc -l < "$restart_log" 2>/dev/null || echo 0)

      if [ "$recent_restarts" -ge "$MAX_RESTARTS_PER_HOUR" ]; then
        logger -p user.crit -t ei-point-watchdog "CRITICAL: $svc ($cid) exceeded restart budget ($recent_restarts restarts in 1h). Manual operator intervention required!"
      else
        logger -p user.warn -t ei-point-watchdog "restarting $svc ($cid) after $count consecutive failures"
        docker restart "$cid" >/dev/null
        echo "$NOW" >> "$restart_log"
        echo 0 > "$STATE_DIR/$svc.count"
      fi
    fi
  else
    echo 0 > "$STATE_DIR/$svc.count"
  fi
done

# Disk guard: 70/80 alert, 90 stop optional downloads (§7)
USE=$(df -P / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$USE" -ge 90 ]; then
  logger -p user.emerg -t ei-point-watchdog "DISK CRITICAL ${USE}%: stopping optional downloads";
  touch "$STATE_DIR/disk-hold";
else
  if [ -f "$STATE_DIR/disk-hold" ]; then
    rm -f "$STATE_DIR/disk-hold"
    logger -p user.notice -t ei-point-watchdog "disk hold cleared (usage: ${USE}%)";
  fi
  if [ "$USE" -ge 80 ]; then
    logger -p user.warn -t ei-point-watchdog "disk warning ${USE}%";
  elif [ "$USE" -ge 70 ]; then
    logger -p user.notice -t ei-point-watchdog "disk notice ${USE}%";
  fi
fi
