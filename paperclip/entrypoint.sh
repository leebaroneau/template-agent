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
export PROFILE_SYNC_ENV_FILE="${PROFILE_SYNC_ENV_FILE:-/data/agent-stack/profile-sync/profile-sync.env}"

if [[ -f "$PROFILE_SYNC_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROFILE_SYNC_ENV_FILE"
  set +a
fi

export ORG_MIRROR_ROOT="${ORG_MIRROR_ROOT:-/data/agent-stack}"

# Install per-brand state-repo SSH deploy key on container start so the
# pre-deployment backup hook (paperclip/pre-deploy-backup.sh) can push to
# the state repo. Coolify supplies the key as base64 via AGENT_STATE_DEPLOY_KEY
# env var. Safe no-op when unset.
if [[ -n "${AGENT_STATE_DEPLOY_KEY:-}" ]]; then
  install -d -m 700 -o node -g node /home/node/.ssh
  KEY_FILE="${AGENT_STATE_KEY_FILE:-/home/node/.ssh/agent-state-deploy}"
  printf '%s' "$AGENT_STATE_DEPLOY_KEY" | base64 -d > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  chown node:node "$KEY_FILE"
  # Pin github.com host key once (skips first-use prompt on later ssh calls).
  if ! grep -q "^github.com " /home/node/.ssh/known_hosts 2>/dev/null; then
    ssh-keyscan -t rsa,ecdsa,ed25519 github.com 2>/dev/null >> /home/node/.ssh/known_hosts || true
    chown node:node /home/node/.ssh/known_hosts 2>/dev/null || true
  fi
  echo "[agent-stack] AGENT_STATE_DEPLOY_KEY installed at $KEY_FILE for pre-deploy backups"
fi

mkdir -p "$HERMES_DATA_ROOT" "$GBRAIN_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks
if [[ ! -e /hermes || -L /hermes ]]; then
  ln -sfn /data /hermes
fi

if [[ -f /opt/paperclip/delegation-protocol.md ]]; then
  mkdir -p /data/agent-stack "$HERMES_DATA_ROOT"
  cp /opt/paperclip/delegation-protocol.md /data/agent-stack/delegation-protocol.md
  cp /opt/paperclip/delegation-protocol.md "$HERMES_DATA_ROOT/DELEGATION_PROTOCOL.md"
fi

if [[ -f /opt/paperclip/learning-protocol.md ]]; then
  mkdir -p /data/agent-stack "$HERMES_DATA_ROOT"
  cp /opt/paperclip/learning-protocol.md /data/agent-stack/learning-protocol.md
  cp /opt/paperclip/learning-protocol.md "$HERMES_DATA_ROOT/LEARNING_PROTOCOL.md"
fi

if [[ -f /opt/paperclip/important-information-index.md ]]; then
  mkdir -p /data/agent-stack
  if [[ ! -f /data/agent-stack/important-information-index.md ]]; then
    cp /opt/paperclip/important-information-index.md /data/agent-stack/important-information-index.md
  fi
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
node /opt/paperclip/patch-hermes-profile-skill-count.mjs
node /opt/paperclip/patch-hermes-adapter-env.mjs
node /opt/paperclip/patch-hermes-adapter-skills-home.mjs
node /opt/paperclip/patch-paperclip-hermes-defaults.mjs patch
node /opt/paperclip/patch-paperclip-company-prefix.mjs
node /opt/paperclip/patch-invite-auth-flow.mjs
node /opt/paperclip/repair-paperclip-config.mjs

if [[ ! -f /data/instances/default/config.json ]]; then
  runuser -u node -- paperclipai onboard --data-dir /data --bind "${PAPERCLIP_BIND:-lan}" --yes
fi

if [[ "${PROFILE_SYNC_ENABLED:-0}" =~ ^(1|true|TRUE|yes|YES|on|ON)$ ]]; then
  echo "[agent-stack] Starting embedded profile-sync loop"
  runuser -u node -- env \
    PROFILE_SYNC_ENABLED="$PROFILE_SYNC_ENABLED" \
    PROFILE_SYNC_INTERVAL_SEC="${PROFILE_SYNC_INTERVAL_SEC:-60}" \
    PROFILE_SYNC_DELETE_MODE="${PROFILE_SYNC_DELETE_MODE:-archive}" \
    PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS="${PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS:-1}" \
    PROFILE_SYNC_MANIFEST_PATH="$PROFILE_SYNC_MANIFEST_PATH" \
    PROFILE_SYNC_TEMPLATE_DIR="$PROFILE_SYNC_TEMPLATE_DIR" \
    PAPERCLIP_API_BASE="${PROFILE_SYNC_API_BASE:-http://127.0.0.1:3100}" \
    PAPERCLIP_AGENT_API_URL="${PAPERCLIP_AGENT_API_URL:-http://127.0.0.1:3100}" \
    PAPERCLIP_PROFILE_SYNC_API_KEY="${PAPERCLIP_PROFILE_SYNC_API_KEY:-}" \
    PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}" \
    PAPERCLIP_COMPANY_IDS="${PAPERCLIP_COMPANY_IDS:-}" \
    PAPERCLIP_COMPANIES="${PAPERCLIP_COMPANIES:-}" \
    ORG_MIRROR_ROOT="$ORG_MIRROR_ROOT" \
    HERMES_DATA_ROOT="$HERMES_DATA_ROOT" \
    GBRAIN_DATA_ROOT="$GBRAIN_DATA_ROOT" \
    node /opt/paperclip/profile-sync.mjs loop &
fi

exec runuser -u node -- paperclipai run --data-dir /data --bind "${PAPERCLIP_BIND:-lan}"
