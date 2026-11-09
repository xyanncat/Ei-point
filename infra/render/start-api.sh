#!/bin/sh
# Render free tier allows one always-on service per workspace. The API and the
# job worker therefore share this container: the worker runs in the background
# and the API is the process Render health-checks and restarts.
set -e
node /app/workers/dist/index.js &
worker=$!
api=""
trap 'kill "$worker" ${api:+"$api"} 2>/dev/null || true' TERM INT
node /app/dist/index.js &
api=$!
wait "$api"
status=$?
kill "$worker" 2>/dev/null || true
exit "$status"
