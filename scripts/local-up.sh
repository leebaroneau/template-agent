#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
./scripts/validate-env.sh .env
docker compose -f compose.yaml -f compose.build.yaml --env-file .env up -d --build

port="${PAPERCLIP_PORT:-3100}"
hermes_port="${HERMES_PORT:-9119}"
hermes_dashboard_enabled="${HERMES_DASHBOARD_ENABLED:-0}"
paperclip_enabled="${PAPERCLIP_ENABLED:-0}"
if [[ -f .env ]]; then
  port="$(grep '^PAPERCLIP_PORT=' .env | tail -n 1 | cut -d= -f2- || true)"
  port="${port:-3100}"
  hermes_port="$(grep '^HERMES_PORT=' .env | tail -n 1 | cut -d= -f2- || true)"
  hermes_port="${hermes_port:-9119}"
  hermes_dashboard_enabled="$(grep '^HERMES_DASHBOARD_ENABLED=' .env | tail -n 1 | cut -d= -f2- || true)"
  hermes_dashboard_enabled="${hermes_dashboard_enabled:-0}"
  paperclip_enabled="$(grep '^PAPERCLIP_ENABLED=' .env | tail -n 1 | cut -d= -f2- || true)"
  paperclip_enabled="${paperclip_enabled:-0}"
fi

case "$paperclip_enabled" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On) echo "Paperclip: http://localhost:${port}" ;;
  *) echo "Paperclip: disabled (set PAPERCLIP_ENABLED=1 to start it)" ;;
esac
case "$hermes_dashboard_enabled" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On) echo "Hermes: http://localhost:${hermes_port}" ;;
  *) echo "Hermes dashboard: disabled; use docker compose exec hermes hermes" ;;
esac
echo "Hermes CLI: docker compose -f compose.yaml -f compose.build.yaml --env-file .env exec hermes hermes --version"
case "$paperclip_enabled" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On) echo "Profile sync logs: ./scripts/local-logs.sh paperclip" ;;
esac
