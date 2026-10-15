#!/usr/bin/env bash
# Canonical fleet only. Missing services and missing healthchecks are failures.
set -euo pipefail
umask 077
SERVICES="postgres nginx api web workers bot-kafka bot-himiko bot-community bot-ai bot-music bot-commerce"
RELEASE_MANIFEST=${RELEASE_MANIFEST:-/srv/ei-point/.releases/current.json}
PROJECT_ROOT=${PROJECT_ROOT:-/srv/ei-point}
if [[ -f "$RELEASE_MANIFEST" ]]; then SERVICES=$(node "$PROJECT_ROOT/scripts/release-roster.mjs" "$RELEASE_MANIFEST" --services); fi
GRACE_SEC=${WATCHDOG_GRACE_SECONDS:-120}
FAIL_THRESHOLD=${WATCHDOG_FAIL_THRESHOLD:-3}
MAX_RESTARTS=${WATCHDOG_MAX_RESTARTS:-3}
STATE_DIR=${WATCHDOG_STATE_DIR:-/var/lib/ei-point/watchdog}
RUN_SECONDS=${WATCHDOG_RUN_SECONDS:-120}
for value in "$GRACE_SEC" "$FAIL_THRESHOLD" "$MAX_RESTARTS" "$RUN_SECONDS"; do [[ "$value" =~ ^[1-9][0-9]*$ ]] || exit 1; done
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/watchdog.lock"
flock -n 9 || exit 0
NOW=$(date +%s)
DEADLINE=$((NOW+RUN_SECONDS))
failed=0
log(){ logger -p "$1" -t ei-point-watchdog -- "$2" || printf '%s\n' "$2" >&2; }
bounded(){ local left=$((DEADLINE-$(date +%s))); ((left>0)) || return 124; ((left>30)) && left=30; timeout "$left" "$@"; }
for svc in $SERVICES; do
  if (( $(date +%s)>=DEADLINE )); then log user.crit 'Watchdog deadline exceeded; fleet checks incomplete'; failed=1; break; fi
  # The project label is mandatory: a matching service in another project must
  # never be inspected or restarted.
  if ! ids=$(bounded docker ps -aq --filter label=com.docker.compose.project=ei-point --filter "label=com.docker.compose.service=$svc"); then log user.crit "UNHEALTHY $svc: container lookup failed"; failed=1; continue; fi
  mapfile -t containers < <(printf '%s\n' "$ids" | sed '/^$/d')
  if [[ ${#containers[@]} != 1 ]]; then log user.crit "UNHEALTHY $svc: expected one project container, found ${#containers[@]}"; failed=1; continue; fi
  cid=${containers[0]}
  if ! state=$(bounded docker inspect --format '{{.State.Running}}|{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid"); then log user.crit "UNHEALTHY $svc: inspect failed"; failed=1; continue; fi
  IFS='|' read -r running started health <<< "$state"
  previous=$(cat "$STATE_DIR/$svc.cid" 2>/dev/null || true)
  if [[ "$previous" != "$cid" ]]; then printf '0\n' > "$STATE_DIR/$svc.count"; printf '%s\n' "$cid" > "$STATE_DIR/$svc.cid"; fi
  started_ts=$(date -d "$started" +%s 2>/dev/null || printf '0')
  if [[ "$running" == true ]] && ((started_ts>0 && NOW>=started_ts && NOW-started_ts<GRACE_SEC)); then log user.notice "STARTING $svc: inside startup grace"; continue; fi
  if [[ "$running" == true && "$health" == healthy ]]; then printf '0\n' > "$STATE_DIR/$svc.count"; continue; fi
  failed=1
  if [[ "$running" == true && "$health" == none ]]; then log user.crit "UNHEALTHY $svc: no Docker healthcheck configured; operator must configure readiness; restart withheld"; continue; fi
  count=$(cat "$STATE_DIR/$svc.count" 2>/dev/null || printf '0')
  [[ "$count" =~ ^[0-9]+$ ]] || count=0
  ((count+=1))
  printf '%s\n' "$count" > "$STATE_DIR/$svc.count"
  log user.warn "UNHEALTHY $svc ($cid): running=$running health=$health failure=$count"
  ((count>=FAIL_THRESHOLD)) || continue
  restart_log="$STATE_DIR/$svc.restarts"
  touch "$restart_log"
  awk -v cutoff=$((NOW-3600)) '$1 ~ /^[0-9]+$/ && $1 > cutoff' "$restart_log" > "$restart_log.tmp"
  mv -- "$restart_log.tmp" "$restart_log"
  recent=$(wc -l < "$restart_log")
  if ((recent>=MAX_RESTARTS)); then log user.crit "UNHEALTHY $svc: restart budget exhausted; operator intervention required"; continue; fi
  # Failed restart attempts consume budget too, so failures cannot spin forever.
  printf '%s\n' "$NOW" >> "$restart_log"
  log user.warn "Restarting project service $svc ($cid)"
  if bounded docker restart --time 15 "$cid" >/dev/null; then printf '0\n' > "$STATE_DIR/$svc.count"; else log user.crit "UNHEALTHY $svc: restart failed or timed out"; fi
done
HOLD=${DISK_HOLD_FILE:-$STATE_DIR/disk-hold}
USE=$(df -P "$STATE_DIR" | awk 'NR==2{gsub(/%/,"",$5);print $5}')
if [[ ! "$USE" =~ ^[0-9]+$ ]]; then log user.crit 'Disk utilization could not be measured'; exit 1; fi
if ((USE>=90)); then
  touch "$HOLD"
  log user.emerg "DISK CRITICAL ${USE}%: optional asset build/import writes held; database, financial operations and WAL remain active"
  failed=1
else
  if [[ -f "$HOLD" ]]; then rm -f -- "$HOLD"; log user.notice "Optional asset write hold cleared: ${USE}%"; fi
  if ((USE>=80)); then log user.warn "Disk warning ${USE}%"; elif ((USE>=70)); then log user.notice "Disk notice ${USE}%"; fi
fi
exit "$failed"
