#!/usr/bin/env bash
set -euo pipefail

export HERMES_DATA_ROOT="${HERMES_DATA_ROOT:-/data/hermes}"
export GBRAIN_DATA_ROOT="${GBRAIN_DATA_ROOT:-/data/gbrain}"
export HERMES_PROFILES="${HERMES_PROFILES:-default}"
export HERMES_HOME="${HERMES_HOME:-$HERMES_DATA_ROOT}"
export GBRAIN_HOME="${GBRAIN_HOME:-$GBRAIN_DATA_ROOT/default}"

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

node /opt/paperclip/patch-hermes-profile-skill-count.mjs

profile_has_gateway_env() {
  local profile_home="$1"
  local env_file="$profile_home/.env"

  [[ -f "$env_file" ]] || return 1

  grep -Eq '^(TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|SLACK_BOT_TOKEN|MATRIX_ACCESS_TOKEN|SIGNAL_PHONE_NUMBER|WHATSAPP_ACCESS_TOKEN)=[^[:space:]]+' "$env_file"
}

discover_gateway_profiles() {
  local setting="${HERMES_GATEWAY_PROFILES:-auto}"

  if [[ -z "$setting" || "$setting" == "none" ]]; then
    return 0
  fi

  if [[ "$setting" != "auto" ]]; then
    printf '%s\n' "$setting"
    return 0
  fi

  if profile_has_gateway_env "$HERMES_DATA_ROOT"; then
    printf 'default\n'
  fi

  if [[ -d "$HERMES_DATA_ROOT/profiles" ]]; then
    local profile_home profile
    for profile_home in "$HERMES_DATA_ROOT"/profiles/*/; do
      [[ -d "$profile_home" ]] || continue
      profile="$(basename "$profile_home")"
      if profile_has_gateway_env "$profile_home"; then
        printf '%s\n' "$profile"
      fi
    done
  fi
}

start_gateway_profiles() {
  case "${HERMES_GATEWAY_AUTOSTART:-1}" in
    0|false|FALSE|False|no|NO|No) return 0 ;;
  esac

  local raw_profiles
  raw_profiles="$(discover_gateway_profiles | paste -sd, -)"
  [[ -n "$raw_profiles" ]] || return 0

  mkdir -p "$HERMES_DATA_ROOT/logs"
  chown -R node:node "$HERMES_DATA_ROOT/logs"

  IFS=',' read -ra gateway_profiles <<< "$raw_profiles"
  local raw_profile profile log_file
  for raw_profile in "${gateway_profiles[@]}"; do
    profile="$(echo "$raw_profile" | tr '[:upper:]' '[:lower:]' | xargs)"
    [[ -n "$profile" ]] || continue
    if [[ ! "$profile" =~ ^[a-z0-9_-]+$ ]]; then
      echo "[gateway-autostart] skipping invalid profile: $profile" >&2
      continue
    fi

    log_file="$HERMES_DATA_ROOT/logs/${profile}-gateway.log"
    echo "[gateway-autostart] starting gateway for profile: $profile"
    runuser -u node -- bash -lc \
      'profile="$1"; log_file="$2"; nohup hermes --profile "$profile" gateway run --replace --accept-hooks >> "$log_file" 2>&1 < /dev/null &' \
      bash "$profile" "$log_file"
  done
}

start_gateway_profiles

case "${HERMES_DASHBOARD_ENABLED:-0}" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On) ;;
  *)
    touch /tmp/hermes-entrypoint-ready
    echo "[hermes-entrypoint] Hermes dashboard disabled; gateway autostart completed."
    exec sleep infinity
    ;;
esac

host="${HERMES_DASHBOARD_HOST:-0.0.0.0}"
port="${HERMES_DASHBOARD_PORT:-9119}"
args=(dashboard --host "$host" --port "$port" --no-open)

if [[ "$host" != "127.0.0.1" && "$host" != "localhost" ]]; then
  args+=(--insecure)
fi

case "${HERMES_DASHBOARD_TUI:-1}" in
  1|true|TRUE|True|yes|YES|Yes) args+=(--tui) ;;
esac

case "${HERMES_DASHBOARD_SKIP_BUILD:-1}" in
  1|true|TRUE|True|yes|YES|Yes) args+=(--skip-build) ;;
esac

touch /tmp/hermes-entrypoint-ready
exec runuser -u node -- hermes "${args[@]}"
