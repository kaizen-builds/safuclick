#!/usr/bin/env bash
# Keeps the SafuClick relay worker running on a Kane-logged-in machine (restarts it if it exits).
# Needs SAFU_RELAY_SECRET (+ optional SAFU_IP_SALT) in ~/.safuclick-relay.env — never commit that file.
cd "$(dirname "$0")/.." || exit 1
set -a; . "${SAFU_ENV_FILE:-$HOME/.safuclick-relay.env}"; set +a
mkdir -p .safuclick/live-api
while true; do
  node src/live-api/relay-worker.js >> .safuclick/live-api/relay.log 2>&1
  echo "$(date -Is) worker exited ($?), restarting in 5s" >> .safuclick/live-api/relay.log
  sleep 5
done
