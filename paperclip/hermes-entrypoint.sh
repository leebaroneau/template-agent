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

exec runuser -u node -- hermes "${args[@]}"
