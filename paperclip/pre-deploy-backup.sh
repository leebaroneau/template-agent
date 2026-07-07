#!/usr/bin/env bash
# Pre-deployment backup for the dual Paperclip+Hermes container.
#
# Runs inside the old paperclip container as Coolify's pre_deployment_command:
#   bash /opt/paperclip/pre-deploy-backup.sh
#
# If AGENT_STATE_REPO is unset, this is a graceful no-op for blank templates.
# If AGENT_STATE_REPO is set, the backup is fail-closed: DB dump, Hermes tar,
# Release upload, API verification, manifest upload, and retention pruning must
# all complete or the deploy aborts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=paperclip/lib/release-backup.sh
source "$SCRIPT_DIR/lib/release-backup.sh"

log() { printf '[pre-deploy-backup] %s\n' "$*" >&2; }

snapshot_timestamp() {
  printf '%s' "${AGENT_STATE_BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
}

snapshot_created_at() {
  printf '%s' "${AGENT_STATE_BACKUP_CREATED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
}

paperclip_source_commit() {
  printf '%s' "${AGENT_STATE_SOURCE_COMMIT:-${SOURCE_COMMIT:-${GITHUB_SHA:-unknown}}}"
}

# Mirrors the truthy set in entrypoint.sh. When Paperclip is disabled its
# postgres never starts, so a DB dump can only fail; the Hermes archive is
# still taken fail-closed.
paperclip_active() {
  case "${PAPERCLIP_ENABLED:-0}" in
    1|true|TRUE|True|yes|YES|Yes|on|ON|On) return 0 ;;
    *) return 1 ;;
  esac
}

dump_paperclip_db() {
  local out_dir="$1"
  local db_file="" attempt=0
  local max_attempts="${AGENT_STATE_BACKUP_RETRIES:-6}"
  local retry_delay="${AGENT_STATE_BACKUP_RETRY_DELAY:-10}"

  log "Dumping Paperclip DB"
  while (( attempt < max_attempts )); do
    attempt=$(( attempt + 1 ))
    if paperclipai db:backup --dir "$out_dir" >/dev/null 2>"$out_dir/db-backup.err"; then
      db_file="$(ls -1t "$out_dir"/paperclip-*.sql.gz 2>/dev/null | head -1)"
      [[ -f "$db_file" ]] && break
      db_file=""
    fi
    if (( attempt < max_attempts )); then
      log "  db:backup attempt $attempt/$max_attempts produced no dump (postgres warming up?); retrying in ${retry_delay}s"
      sleep "$retry_delay"
    fi
  done

  if [[ -z "$db_file" || ! -f "$db_file" ]]; then
    log "ERROR: paperclipai db:backup produced no .sql.gz after $max_attempts attempt(s); aborting deploy to protect data (fail-closed)."
    if [[ -s "$out_dir/db-backup.err" ]]; then
      log "  last db:backup stderr: $(tail -n 3 "$out_dir/db-backup.err" | tr '\n' ' ')"
    fi
    return 1
  fi

  mv "$db_file" "$out_dir/paperclip-db.sql.gz"
}

build_hermes_archive() {
  local out_file="$1"
  local -a tar_paths=()
  local path

  for path in hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks; do
    if [[ -e "/data/$path" ]]; then
      tar_paths+=("$path")
    fi
  done

  if [[ ! -d /data/hermes/profiles ]]; then
    log "ERROR: /data/hermes/profiles is missing; refusing to create an incomplete Hermes backup."
    return 1
  fi

  log "Taring Hermes profiles"
  local tar_rc=0
  tar czf "$out_file" \
    --exclude='hermes/profiles/*/repos' \
    --exclude='hermes/profiles/*/profile-backups' \
    --exclude='hermes/profiles/*/python-packages' \
    --exclude='hermes/profiles/*/bin' \
    --exclude='hermes/profiles/*/lsp' \
    --exclude='hermes/profiles/*/cache' \
    --exclude='hermes/profiles/*/audio_cache' \
    --exclude='hermes/profiles/*/sessions' \
    --exclude='*/__pycache__' \
    -C /data \
    "${tar_paths[@]}" || tar_rc=$?

  # tar exit 1 = "some files changed/vanished as we read them" — expected and
  # benign when backing up a live system (agents write during the read); the
  # archive is a valid point-in-time snapshot. Only exit >=2 is a real failure.
  if (( tar_rc > 1 )); then
    log "ERROR: tar failed (exit $tar_rc) while archiving Hermes profiles."
    return 1
  fi
  if (( tar_rc == 1 )); then
    log "WARN: some files changed during archive (tar exit 1); point-in-time snapshot retained."
  fi
}

upload_and_verify_asset() {
  local repo="$1"
  local token="$2"
  local release_id="$3"
  local file="$4"
  local name="$5"

  log "Uploading $name"
  release_backup_upload_asset "$repo" "$token" "$release_id" "$file" "$name"
  release_backup_verify_asset "$repo" "$token" "$release_id" "$name" "$file"
}

main() {
  if [[ -z "${AGENT_STATE_REPO:-}" ]]; then
    log "AGENT_STATE_REPO is unset; skipping pre-deploy backup (this is a no-op for unconfigured deployments)."
    exit 0
  fi

  release_backup_require_token "$AGENT_STATE_REPO" || exit 1
  release_backup_validate_repo "$AGENT_STATE_REPO"

  local brand="${AGENT_STATE_BRAND:-${AGENT_STATE_REPO##*/}}"
  local retention_days="${AGENT_STATE_RETENTION_DAYS:-30}"
  local timestamp created_at tag release_id release_name release_body
  timestamp="$(snapshot_timestamp)"
  created_at="$(snapshot_created_at)"
  tag="predeploy-$timestamp"
  release_name="Pre-deploy snapshot $timestamp"
  release_body="kind=predeploy
brand=$brand
repository=$AGENT_STATE_REPO
created_at=$created_at
source_commit=$(paperclip_source_commit)"

  TMP_DIR="$(mktemp -d -t agent-state-predeploy-XXXXXX)"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT

  log "Brand: $brand  Repo: $AGENT_STATE_REPO  Release: $tag"

  local -a backup_files=()
  if paperclip_active; then
    dump_paperclip_db "$TMP_DIR"
    backup_files+=("$TMP_DIR/paperclip-db.sql.gz")
  else
    log "Paperclip disabled (PAPERCLIP_ENABLED=${PAPERCLIP_ENABLED:-0}); skipping Paperclip DB dump."
  fi
  build_hermes_archive "$TMP_DIR/hermes-profiles.tar.gz"
  backup_files+=("$TMP_DIR/hermes-profiles.tar.gz")

  release_id="$(release_backup_create_or_reuse_release "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$tag" "$release_name" "$release_body")"
  local backup_file
  for backup_file in "${backup_files[@]}"; do
    upload_and_verify_asset "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$release_id" "$backup_file" "$(basename "$backup_file")"
  done

  release_backup_write_manifest \
    "$TMP_DIR/manifest.json" \
    "predeploy" \
    "$tag" \
    "$created_at" \
    "$brand" \
    "$AGENT_STATE_REPO" \
    "pre-deploy" \
    "$(paperclip_source_commit)" \
    "${backup_files[@]}"

  upload_and_verify_asset "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$release_id" "$TMP_DIR/manifest.json" "manifest.json"

  log "Pruning predeploy releases older than $retention_days days"
  release_backup_prune_releases "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "predeploy" "$retention_days"

  log "Done."
}

if [[ "${AGENT_STATE_TEST_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
