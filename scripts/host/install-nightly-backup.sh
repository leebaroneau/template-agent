#!/usr/bin/env bash
# Idempotent installer for the host nightly backup cron.
#
# Examples:
#   ./scripts/host/install-nightly-backup.sh --repo <Org>/agent-<brand> --brand <brand> --compose-filter <coolify-app-uuid>
#   AGENT_STATE_REPO=<Org>/agent-<brand> AGENT_STATE_BRAND=<brand> AGENT_STATE_COMPOSE_FILTER=<coolify-app-uuid> ./scripts/host/install-nightly-backup.sh --verify

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SOURCE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

usage() {
  cat <<'EOF'
Usage:
  install-nightly-backup.sh --repo <owner/repo> --brand <slug> --compose-filter <coolify-app-uuid> [options]

Required:
  --repo <owner/repo>             GitHub state repo. Env: AGENT_STATE_REPO
  --brand <slug>                  Brand slug for backup metadata. Env: AGENT_STATE_BRAND
  --compose-filter <value>        Coolify container name filter. Env: AGENT_STATE_COMPOSE_FILTER

Options:
  --retention-days <days>         Env: AGENT_STATE_RETENTION_DAYS. Default: 30
  --target-dir <dir>              Env: AGENT_STATE_TARGET_DIR. Default: /root/agent-state-backup
  --token-file <file>             Env: AGENT_STATE_TOKEN_FILE. Default: <target-dir>/github-token
  --cron-schedule <schedule>      Env: AGENT_STATE_CRON_SCHEDULE. Default: 0 17 * * *
  --source-dir <dir>              Env: AGENT_STATE_SOURCE_DIR. Default: repo root two levels above this script
  --verify                        Run nightly-backup.sh once after install with AGENT_STATE_ENV_FILE set
  -h, --help                      Show this help
EOF
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    log "ERROR: $flag requires a value"
    exit 64
  fi
}

shell_quote() {
  local value="$1"
  local i char

  if [[ "$value" =~ ^[A-Za-z0-9_./:=+,%@-]+$ ]]; then
    printf '%s' "$value"
    return
  fi

  printf "'"
  for (( i = 0; i < ${#value}; i++ )); do
    char="${value:i:1}"
    if [[ "$char" == "'" ]]; then
      printf "'\\''"
    else
      printf '%s' "$char"
    fi
  done
  printf "'"
}

write_env_line() {
  local key="$1"
  local value="$2"
  local quoted
  printf -v quoted '%q' "$value"
  printf '%s=%s\n' "$key" "$quoted"
}

REPO="${AGENT_STATE_REPO:-}"
BRAND="${AGENT_STATE_BRAND:-}"
COMPOSE_FILTER="${AGENT_STATE_COMPOSE_FILTER:-}"
RETENTION_DAYS="${AGENT_STATE_RETENTION_DAYS:-30}"
TARGET_DIR="${AGENT_STATE_TARGET_DIR:-/root/agent-state-backup}"
TOKEN_FILE="${AGENT_STATE_TOKEN_FILE:-}"
CRON_SCHEDULE="${AGENT_STATE_CRON_SCHEDULE:-0 17 * * *}"
SOURCE_DIR="${AGENT_STATE_SOURCE_DIR:-$DEFAULT_SOURCE_DIR}"
VERIFY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      require_value "$1" "${2:-}"
      REPO="$2"
      shift 2
      ;;
    --repo=*)
      REPO="${1#*=}"
      shift
      ;;
    --brand)
      require_value "$1" "${2:-}"
      BRAND="$2"
      shift 2
      ;;
    --brand=*)
      BRAND="${1#*=}"
      shift
      ;;
    --compose-filter)
      require_value "$1" "${2:-}"
      COMPOSE_FILTER="$2"
      shift 2
      ;;
    --compose-filter=*)
      COMPOSE_FILTER="${1#*=}"
      shift
      ;;
    --retention-days)
      require_value "$1" "${2:-}"
      RETENTION_DAYS="$2"
      shift 2
      ;;
    --retention-days=*)
      RETENTION_DAYS="${1#*=}"
      shift
      ;;
    --target-dir)
      require_value "$1" "${2:-}"
      TARGET_DIR="$2"
      shift 2
      ;;
    --target-dir=*)
      TARGET_DIR="${1#*=}"
      shift
      ;;
    --token-file)
      require_value "$1" "${2:-}"
      TOKEN_FILE="$2"
      shift 2
      ;;
    --token-file=*)
      TOKEN_FILE="${1#*=}"
      shift
      ;;
    --cron-schedule)
      require_value "$1" "${2:-}"
      CRON_SCHEDULE="$2"
      shift 2
      ;;
    --cron-schedule=*)
      CRON_SCHEDULE="${1#*=}"
      shift
      ;;
    --source-dir)
      require_value "$1" "${2:-}"
      SOURCE_DIR="$2"
      shift 2
      ;;
    --source-dir=*)
      SOURCE_DIR="${1#*=}"
      shift
      ;;
    --verify)
      VERIFY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log "ERROR: unknown option: $1"
      usage >&2
      exit 64
      ;;
  esac
done

if [[ -z "$REPO" ]]; then
  log "ERROR: --repo or AGENT_STATE_REPO is required"
  exit 64
fi
if [[ -z "$BRAND" ]]; then
  log "ERROR: --brand or AGENT_STATE_BRAND is required"
  exit 64
fi
if [[ -z "$COMPOSE_FILTER" ]]; then
  log "ERROR: --compose-filter or AGENT_STATE_COMPOSE_FILTER is required"
  exit 64
fi
if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  log "ERROR: --retention-days must be a non-negative integer; got '$RETENTION_DAYS'"
  exit 64
fi
if [[ -z "$CRON_SCHEDULE" ]]; then
  log "ERROR: --cron-schedule must not be empty"
  exit 64
fi

SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
mkdir -p "$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
if [[ -z "$TOKEN_FILE" ]]; then
  TOKEN_FILE="$TARGET_DIR/github-token"
fi

NIGHTLY_SRC="$SOURCE_DIR/scripts/host/nightly-backup.sh"
RELEASE_HELPER_SRC="$SOURCE_DIR/paperclip/lib/release-backup.sh"
NIGHTLY_DST="$TARGET_DIR/nightly-backup.sh"
RELEASE_HELPER_DST="$TARGET_DIR/release-backup.sh"
ENV_FILE="$TARGET_DIR/backup.env"

if [[ ! -f "$NIGHTLY_SRC" ]]; then
  log "ERROR: nightly backup script not found: $NIGHTLY_SRC"
  exit 1
fi
if [[ ! -f "$RELEASE_HELPER_SRC" ]]; then
  log "ERROR: release backup helper not found: $RELEASE_HELPER_SRC"
  exit 1
fi

log "Installing host nightly backup into $TARGET_DIR"

cp -f "$NIGHTLY_SRC" "$NIGHTLY_DST"
cp -f "$RELEASE_HELPER_SRC" "$RELEASE_HELPER_DST"
chmod 755 "$NIGHTLY_DST" "$RELEASE_HELPER_DST"

if [[ ! -s "$TOKEN_FILE" ]]; then
  log "ERROR: token file is missing or empty: $TOKEN_FILE"
  exit 1
fi
chmod 600 "$TOKEN_FILE"

{
  write_env_line "AGENT_STATE_REPO" "$REPO"
  write_env_line "AGENT_STATE_BRAND" "$BRAND"
  write_env_line "AGENT_STATE_TOKEN_FILE" "$TOKEN_FILE"
  write_env_line "AGENT_STATE_COMPOSE_FILTER" "$COMPOSE_FILTER"
  write_env_line "AGENT_STATE_RETENTION_DAYS" "$RETENTION_DAYS"
} > "$ENV_FILE"

if [[ -d "$TARGET_DIR/repo" ]]; then
  log "Removing legacy git-push repo dir: $TARGET_DIR/repo"
  rm -rf "$TARGET_DIR/repo"
fi
if [[ -e "$TARGET_DIR/git-askpass.sh" ]]; then
  log "Removing legacy git-push askpass helper: $TARGET_DIR/git-askpass.sh"
  rm -f "$TARGET_DIR/git-askpass.sh"
fi

CRON_LINE="$CRON_SCHEDULE AGENT_STATE_ENV_FILE=$(shell_quote "$ENV_FILE") $(shell_quote "$NIGHTLY_DST") >> /var/log/agent-state-backup.log 2>&1"
CRON_TMP="$(mktemp -t agent-state-cron-XXXXXX)"
trap 'rm -f "${CRON_TMP:-}"' EXIT

if CURRENT_CRON="$(crontab -l 2>/dev/null)"; then
  if [[ -n "$CURRENT_CRON" ]]; then
    while IFS= read -r line; do
      if [[ "$line" == *"$NIGHTLY_DST"* ]]; then
        continue
      fi
      printf '%s\n' "$line" >> "$CRON_TMP"
    done <<< "$CURRENT_CRON"
  fi
fi
printf '%s\n' "$CRON_LINE" >> "$CRON_TMP"
crontab - < "$CRON_TMP"
log "Installed cron entry: $CRON_LINE"

if [[ "$VERIFY" == "1" ]]; then
  log "Running verification backup"
  AGENT_STATE_ENV_FILE="$ENV_FILE" "$NIGHTLY_DST"
fi

log "Summary: target=$TARGET_DIR env=$ENV_FILE token_file=$TOKEN_FILE cron='$CRON_SCHEDULE' verify=$VERIFY"
