#!/usr/bin/env bash
# Run only as part of an explicit release/cutover. Never match another project.
set -euo pipefail
WANTED=${1:?Validated release bot list required}
[[ -f "$WANTED" ]] || exit 1
mapfile -t active < <(docker ps --filter label=com.docker.compose.project=ei-point --format '{{.Label "com.docker.compose.service"}}' | sort -u)
for service in "${active[@]}"; do
 [[ "$service" =~ ^bot-[a-z0-9-]+$ ]] || continue
 if grep -Fxq -- "$service" "$WANTED"; then continue; fi
 mapfile -t ids < <(docker ps -q --filter label=com.docker.compose.project=ei-point --filter "label=com.docker.compose.service=$service")
 [[ ${#ids[@]} == 1 && -n ${ids[0]} ]] || { echo "Ambiguous retired service: $service" >&2; exit 1; }
 docker stop --time 15 "${ids[0]}" >/dev/null
done
