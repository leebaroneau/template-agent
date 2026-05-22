#!/usr/bin/env bash
set -euo pipefail

mode="local"
if [[ "${1:-}" == "--coolify" ]]; then
  mode="coolify"
  shift
fi

ENV_FILE="${1:-.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.example to .env first." >&2
  exit 1
fi

env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

project="$(env_value COMPOSE_PROJECT_NAME)"
project="${project:-template-agent}"
profiles="$(env_value HERMES_PROFILES)"
profiles="${profiles:-default}"

paperclip_url="$(env_value PAPERCLIP_PUBLIC_URL)"
paperclip_hosts="$(env_value PAPERCLIP_ALLOWED_HOSTNAMES)"
paperclip_hostname="$(env_value PAPERCLIP_HOSTNAME)"
hermes_hostname="$(env_value HERMES_HOSTNAME)"
hermes_dashboard_enabled="$(env_value HERMES_DASHBOARD_ENABLED)"
hermes_dashboard_enabled="${hermes_dashboard_enabled:-0}"

if [[ "$mode" == "coolify" ]]; then
  missing=0
  for pair in \
    "PAPERCLIP_PUBLIC_URL:$paperclip_url" \
    "PAPERCLIP_ALLOWED_HOSTNAMES:$paperclip_hosts" \
    "PAPERCLIP_HOSTNAME:$paperclip_hostname"; do
    key="${pair%%:*}"
    value="${pair#*:}"
    if [[ -z "$value" ]]; then
      echo "Missing required Coolify value: $key" >&2
      missing=1
    fi
  done

  if [[ -n "$paperclip_url" && "$paperclip_url" == *localhost* ]]; then
    echo "PAPERCLIP_PUBLIC_URL must be the public Paperclip URL for Coolify, not localhost." >&2
    missing=1
  fi

  paperclip_host="${paperclip_url#http://}"
  paperclip_host="${paperclip_host#https://}"
  paperclip_host="${paperclip_host%%/*}"
  paperclip_host="${paperclip_host%%:*}"
  if [[ -n "$paperclip_host" && ",$paperclip_hosts," != *",$paperclip_host,"* ]]; then
    echo "PAPERCLIP_ALLOWED_HOSTNAMES must include $paperclip_host." >&2
    missing=1
  fi

  if [[ "$paperclip_hostname" == *example.com ]]; then
    echo "Coolify hostnames must be real client hostnames, not example.com placeholders." >&2
    missing=1
  fi

  case "$hermes_dashboard_enabled" in
    1|true|TRUE|True|yes|YES|Yes|on|ON|On)
      if [[ -z "$hermes_hostname" ]]; then
        echo "Missing required Coolify value when Hermes dashboard is enabled: HERMES_HOSTNAME" >&2
        missing=1
      elif [[ "$hermes_hostname" == *example.com ]]; then
        echo "Hermes hostname must be a real client hostname when the dashboard is enabled." >&2
        missing=1
      fi
      ;;
  esac

  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
fi

echo "Compose project: $project"
echo "Services: paperclip, hermes"
if [[ "$mode" == "coolify" ]]; then
  echo "Public Paperclip URL: $paperclip_url"
  echo "Paperclip hostname: $paperclip_hostname"
  case "$hermes_dashboard_enabled" in
    1|true|TRUE|True|yes|YES|Yes|on|ON|On) echo "Hermes hostname: $hermes_hostname" ;;
    *) echo "Hermes dashboard: disabled" ;;
  esac
fi
echo "Profiles: $profiles"
