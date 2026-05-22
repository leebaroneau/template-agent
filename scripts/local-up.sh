#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
./scripts/validate-env.sh .env
docker compose -f compose.yaml -f compose.build.yaml --env-file .env up -d --build

port="${PAPERCLIP_PORT:-3100}"
hermes_port="${HERMES_PORT:-9119}"
hermes_dashboard_enabled="${HERMES_DASHBOARD_ENABLED:-0}"
if [[ -f .env ]]; then
  port="$(grep '^PAPERCLIP_PORT=' .env | tail -n 1 | cut -d= -f2- || true)"
  port="${port:-3100}"
  hermes_port="$(grep '^HERMES_PORT=' .env | tail -n 1 | cut -d= -f2- || true)"
  hermes_port="${hermes_port:-9119}"
  hermes_dashboard_enabled="$(grep '^HERMES_DASHBOARD_ENABLED=' .env | tail -n 1 | cut -d= -f2- || true)"
  hermes_dashboard_enabled="${hermes_dashboard_enabled:-0}"
fi

echo "Paperclip: http://localhost:${port}"
case "$hermes_dashboard_enabled" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On) echo "Hermes: http://localhost:${hermes_port}" ;;
  *) echo "Hermes dashboard: disabled; use Paperclip or docker compose exec paperclip hermes" ;;
esac
echo "Profile sync logs: ./scripts/local-logs.sh paperclip"
echo "Hermes CLI: docker compose -f compose.yaml -f compose.build.yaml --env-file .env exec paperclip hermes --version"
echo "GBrain CLI: docker compose -f compose.yaml -f compose.build.yaml --env-file .env exec paperclip gbrain --version"
