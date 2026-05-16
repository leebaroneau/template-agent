#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data
chown -R node:node /data

export PAPERCLIP_HOME="${PAPERCLIP_HOME:-/data}"
export PAPERCLIP_TELEMETRY_DISABLED="${PAPERCLIP_TELEMETRY_DISABLED:-1}"
export HERMES_DATA_ROOT="${HERMES_DATA_ROOT:-/data/hermes}"
export GBRAIN_DATA_ROOT="${GBRAIN_DATA_ROOT:-/data/gbrain}"
export HERMES_PROFILES="${HERMES_PROFILES:-default}"
if [[ ",$HERMES_PROFILES," != *",default,"* ]]; then
  export HERMES_PROFILES="default,$HERMES_PROFILES"
fi
export HERMES_HOME="${HERMES_HOME:-$HERMES_DATA_ROOT}"
export GBRAIN_HOME="${GBRAIN_HOME:-$GBRAIN_DATA_ROOT/default}"
export PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-http://127.0.0.1:3100}"
export PROFILE_SYNC_MANIFEST_PATH="${PROFILE_SYNC_MANIFEST_PATH:-/data/agent-stack/profile-sync/manifest.json}"
export PROFILE_SYNC_TEMPLATE_DIR="${PROFILE_SYNC_TEMPLATE_DIR:-/opt/hermes-runtime/templates}"

mkdir -p "$HERMES_DATA_ROOT" "$GBRAIN_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks
if [[ ! -e /hermes || -L /hermes ]]; then
  ln -sfn /data /hermes
fi
chown -R node:node /data /home/node/.hermes /opt/work

runuser -u node -- flock /data/.locks/bootstrap-profiles.lock /opt/hermes-runtime/scripts/bootstrap-profiles.sh

if [[ ! -f /home/node/.hermes/config.yaml && -f "$HERMES_HOME/config.yaml" ]]; then
  ln -s "$HERMES_HOME/config.yaml" /home/node/.hermes/config.yaml
  chown -h node:node /home/node/.hermes/config.yaml
fi

runuser -u node -- env HERMES_HOME="$HERMES_HOME" GBRAIN_HOME="$GBRAIN_HOME" hermes --version
runuser -u node -- env HERMES_HOME="$HERMES_HOME" GBRAIN_HOME="$GBRAIN_HOME" gbrain --version

eval "$(node /opt/paperclip/patch-paperclip-hermes-defaults.mjs env)"
node /opt/paperclip/patch-hermes-adapter-env.mjs
node /opt/paperclip/patch-paperclip-hermes-defaults.mjs patch
node /opt/paperclip/patch-paperclip-company-prefix.mjs

if [[ ! -f /data/instances/default/config.json ]]; then
  runuser -u node -- paperclipai onboard --data-dir /data --bind "${PAPERCLIP_BIND:-lan}" --yes
fi

if [[ "${PROFILE_SYNC_ENABLED:-0}" =~ ^(1|true|TRUE|yes|YES|on|ON)$ ]]; then
  echo "[agent-stack] Starting embedded profile-sync loop"
  runuser -u node -- env \
    PROFILE_SYNC_ENABLED="$PROFILE_SYNC_ENABLED" \
    PROFILE_SYNC_INTERVAL_SEC="${PROFILE_SYNC_INTERVAL_SEC:-60}" \
    PROFILE_SYNC_DELETE_MODE="${PROFILE_SYNC_DELETE_MODE:-archive}" \
    PROFILE_SYNC_MANIFEST_PATH="$PROFILE_SYNC_MANIFEST_PATH" \
    PROFILE_SYNC_TEMPLATE_DIR="$PROFILE_SYNC_TEMPLATE_DIR" \
    PAPERCLIP_API_BASE="${PROFILE_SYNC_API_BASE:-http://127.0.0.1:3100}" \
    PAPERCLIP_AGENT_API_URL="${PAPERCLIP_AGENT_API_URL:-http://127.0.0.1:3100}" \
    PAPERCLIP_PROFILE_SYNC_API_KEY="${PAPERCLIP_PROFILE_SYNC_API_KEY:-}" \
    PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}" \
    PAPERCLIP_COMPANY_IDS="${PAPERCLIP_COMPANY_IDS:-}" \
    PAPERCLIP_COMPANIES="${PAPERCLIP_COMPANIES:-}" \
    HERMES_DATA_ROOT="$HERMES_DATA_ROOT" \
    GBRAIN_DATA_ROOT="$GBRAIN_DATA_ROOT" \
    node /opt/paperclip/profile-sync.mjs loop &
fi

exec runuser -u node -- paperclipai run --data-dir /data --bind "${PAPERCLIP_BIND:-lan}"
