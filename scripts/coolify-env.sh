#!/usr/bin/env bash
set -euo pipefail

domain="${1:-}"
scheme="${2:-https}"

if [[ -z "$domain" ]]; then
  echo "Usage: $0 <root-domain> [scheme]" >&2
  echo "Example: $0 brand.example.com https" >&2
  exit 1
fi

paperclip_fqdn="paperclip.${domain}"
hermes_fqdn="hermes.${domain}"

cat <<EOF
COMPOSE_PROJECT_NAME=paperclip-hermes-gbrain
AGENT_STACK_IMAGE=paperclip-hermes-gbrain:blank
PAPERCLIP_PORT=3100
HERMES_PORT=9119
PAPERCLIP_PUBLIC_URL=${scheme}://${paperclip_fqdn}
PAPERCLIP_ALLOWED_HOSTNAMES=${paperclip_fqdn},localhost,127.0.0.1
PAPERCLIP_HOSTNAME=${paperclip_fqdn}
HERMES_HOSTNAME=${hermes_fqdn}
HERMES_DASHBOARD_TUI=1
HERMES_DASHBOARD_SKIP_BUILD=1
HERMES_PROFILES=default
PROFILE_SYNC_ENABLED=0
PROFILE_SYNC_INTERVAL_SEC=60
PROFILE_SYNC_DELETE_MODE=archive
PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS=1
TOOL_ACCESS_SEED_ENABLED=1
TOOL_ACCESS_APPLY_DEFAULT_PRESET=1
TOOL_ACCESS_DEFAULT_PRESET=agent-stack-hermes-default
PROFILE_SYNC_API_BASE=http://127.0.0.1:3100
PAPERCLIP_AGENT_API_URL=http://127.0.0.1:3100
PAPERCLIP_PROFILE_SYNC_API_KEY=
PAPERCLIP_COMPANY_IDS=
PAPERCLIP_COMPANIES=
PAPERCLIP_VERSION=2026.513.0
PAPERCLIP_GIT_REPO=https://github.com/paperclipai/paperclip.git
PAPERCLIP_GIT_REF=refs/pull/6243/head
HERMES_AGENT_REF=main
GBRAIN_REF=master
PAPERCLIP_TELEMETRY_DISABLED=1
EOF
