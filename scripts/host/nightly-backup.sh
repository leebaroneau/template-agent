#!/usr/bin/env bash
# Nightly state backup for a brand's dual Paperclip+Hermes Coolify deployment.
#
# Runs on the DROPLET HOST via cron. It docker-execs into the running
# paperclip + hermes containers to dump the Paperclip DB and tar Hermes
# profiles, then uploads the snapshot as GitHub Release assets on the brand's
# agent-<brand> state repo.
#
# Install:
#   1. Copy this file and the shared helper onto the droplet host:
#        scp scripts/host/nightly-backup.sh <host>:/root/agent-state-backup/nightly-backup.sh
#        scp paperclip/lib/release-backup.sh <host>:/root/agent-state-backup/release-backup.sh
#   2. Create `/root/agent-state-backup/backup.env`:
#        AGENT_STATE_REPO=<Org>/agent-<brand>
#        AGENT_STATE_BRAND=<brand>
#        AGENT_STATE_TOKEN_FILE=/root/agent-state-backup/github-token
#        AGENT_STATE_COMPOSE_FILTER=<coolify-app-uuid>
#        AGENT_STATE_RETENTION_DAYS=30
#   3. Store a GitHub token with contents:write at AGENT_STATE_TOKEN_FILE.
#      GitHub Release assets cannot be uploaded with an SSH deploy key.
#   4. Install cron (suggest 0 17 * * * UTC = 03:00 Sydney):
#        (crontab -l; echo "0 17 * * * /root/agent-state-backup/nightly-backup.sh \
#          >> /var/log/agent-state-backup.log 2>&1") | crontab -

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

load_release_helper() {
  local helper="${AGENT_STATE_RELEASE_BACKUP_LIB:-}"
  if [[ -z "$helper" ]]; then
    if [[ -f "$SCRIPT_DIR/release-backup.sh" ]]; then
      helper="$SCRIPT_DIR/release-backup.sh"
    else
      helper="$SCRIPT_DIR/../../paperclip/lib/release-backup.sh"
    fi
  fi

  if [[ ! -f "$helper" ]]; then
    log "ERROR: release backup helper not found. Copy paperclip/lib/release-backup.sh next to nightly-backup.sh or set AGENT_STATE_RELEASE_BACKUP_LIB."
    return 1
  fi

  # shellcheck source=paperclip/lib/release-backup.sh
  source "$helper"
}

load_env() {
  ENV_FILE="${AGENT_STATE_ENV_FILE:-/root/agent-state-backup/backup.env}"
  LOG_FILE="${AGENT_STATE_LOG_FILE:-/var/log/agent-state-backup.log}"

  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi

  if [[ -z "${AGENT_STATE_TOKEN:-}" && -n "${AGENT_STATE_TOKEN_FILE:-}" && -f "$AGENT_STATE_TOKEN_FILE" ]]; then
    AGENT_STATE_TOKEN="$(tr -d '\r\n' < "$AGENT_STATE_TOKEN_FILE")"
  fi
}

validate_config() {
  : "${AGENT_STATE_REPO:?AGENT_STATE_REPO must be set (e.g. <Org>/agent-<brand>)}"
  : "${AGENT_STATE_BRAND:?AGENT_STATE_BRAND must be set (e.g. <brand>)}"
  : "${AGENT_STATE_COMPOSE_FILTER:?AGENT_STATE_COMPOSE_FILTER must be set (Coolify app UUID prefix)}"

  release_backup_require_token "$AGENT_STATE_REPO"
  release_backup_validate_repo "$AGENT_STATE_REPO"
}

snapshot_timestamp() {
  printf '%s' "${AGENT_STATE_BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
}

snapshot_created_at() {
  printf '%s' "${AGENT_STATE_BACKUP_CREATED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
}

source_commit() {
  printf '%s' "${AGENT_STATE_SOURCE_COMMIT:-${SOURCE_COMMIT:-unknown}}"
}

resolve_containers() {
  PAPERCLIP_CONTAINER="$(docker ps --filter "name=paperclip-${AGENT_STATE_COMPOSE_FILTER}" --format '{{.Names}}' | head -1)"
  HERMES_CONTAINER="$(docker ps --filter "name=hermes-${AGENT_STATE_COMPOSE_FILTER}" --format '{{.Names}}' | head -1)"

  if [[ -z "$PAPERCLIP_CONTAINER" || -z "$HERMES_CONTAINER" ]]; then
    log "ERROR: containers not running (paperclip=$PAPERCLIP_CONTAINER, hermes=$HERMES_CONTAINER); aborting"
    return 1
  fi
}

dump_paperclip_db() {
  local tmp_dir="$1"
  local latest_db

  log "Dumping Paperclip DB via $PAPERCLIP_CONTAINER"
  docker exec "$PAPERCLIP_CONTAINER" bash -lc 'paperclipai db:backup --dir /tmp >/dev/null 2>&1'
  latest_db="$(docker exec "$PAPERCLIP_CONTAINER" bash -lc 'ls -1t /tmp/paperclip-*.sql.gz | head -1')"
  docker cp "$PAPERCLIP_CONTAINER:$latest_db" "$tmp_dir/paperclip-db.sql.gz"
}

build_hermes_archive() {
  local tmp_dir="$1"

  log "Taring Hermes profiles via $HERMES_CONTAINER"
  # tar exit 1 = files changed/vanished mid-read (benign on a live system);
  # only exit >=2 is a real failure. Translate so the docker exec succeeds on 0/1.
  docker exec "$HERMES_CONTAINER" bash -lc 'cd /data || exit 2; tar czf /tmp/hermes-profiles.tar.gz --exclude="hermes/profiles/*/profile-backups" --exclude="hermes/profiles/*/python-packages" --exclude="hermes/profiles/*/bin" --exclude="hermes/profiles/*/lsp" --exclude="hermes/profiles/*/cache" --exclude="hermes/profiles/*/audio_cache" --exclude="*/__pycache__" hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks 2>/dev/null; rc=$?; [ "$rc" -le 1 ]'
  docker cp "$HERMES_CONTAINER:/tmp/hermes-profiles.tar.gz" "$tmp_dir/hermes-profiles.tar.gz"
}

upload_and_verify_asset() {
  local release_id="$1"
  local file="$2"
  local name="$3"

  log "Uploading $name"
  release_backup_upload_asset "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$release_id" "$file" "$name"
  release_backup_verify_asset "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$release_id" "$name" "$file"
}

main() {
  load_env
  load_release_helper
  validate_config

  local retention_days="${AGENT_STATE_RETENTION_DAYS:-30}"
  local timestamp created_at tag release_id release_name release_body
  timestamp="$(snapshot_timestamp)"
  created_at="$(snapshot_created_at)"
  tag="nightly-$timestamp"
  release_name="Nightly snapshot $timestamp"
  release_body="kind=nightly
brand=$AGENT_STATE_BRAND
repository=$AGENT_STATE_REPO
created_at=$created_at
source_commit=$(source_commit)"

  TMP_DIR="$(mktemp -d -t agent-state-nightly-XXXXXX)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  log "=== Starting release backup for brand=$AGENT_STATE_BRAND release=$tag ==="

  resolve_containers
  dump_paperclip_db "$TMP_DIR"
  build_hermes_archive "$TMP_DIR"

  release_id="$(release_backup_create_or_reuse_release "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$tag" "$release_name" "$release_body")"
  upload_and_verify_asset "$release_id" "$TMP_DIR/paperclip-db.sql.gz" "paperclip-db.sql.gz"
  upload_and_verify_asset "$release_id" "$TMP_DIR/hermes-profiles.tar.gz" "hermes-profiles.tar.gz"

  release_backup_write_manifest \
    "$TMP_DIR/manifest.json" \
    "nightly" \
    "$tag" \
    "$created_at" \
    "$AGENT_STATE_BRAND" \
    "$AGENT_STATE_REPO" \
    "host-nightly" \
    "$(source_commit)" \
    "$TMP_DIR/paperclip-db.sql.gz" \
    "$TMP_DIR/hermes-profiles.tar.gz"

  upload_and_verify_asset "$release_id" "$TMP_DIR/manifest.json" "manifest.json"

  log "Pruning nightly releases older than $retention_days days"
  release_backup_prune_releases "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "nightly" "$retention_days"

  log "=== Done ==="
}

if [[ "${AGENT_STATE_TEST_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
