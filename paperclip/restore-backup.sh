#!/usr/bin/env bash
# Restore Paperclip/Hermes state from GitHub Release backup assets.
#
# Destructive by design: requires --force because it restores the DB and
# extracts Hermes state into /data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=paperclip/lib/release-backup.sh
source "$SCRIPT_DIR/lib/release-backup.sh"

log() { printf '[restore-backup] %s\n' "$*" >&2; }

usage() {
  cat >&2 <<'USAGE'
Usage:
  restore-backup.sh --force [latest]
  restore-backup.sh --force --tag predeploy-YYYYMMDDTHHMMSSZ
  restore-backup.sh --force --kind nightly --timestamp YYYYMMDDTHHMMSSZ

Environment:
  AGENT_STATE_REPO      <owner>/<repo> that owns the Release backups
  AGENT_STATE_TOKEN     GitHub token with contents:read access

Options:
  --kind KIND           predeploy or nightly. Optional for latest; required with --timestamp.
  --tag TAG             Exact release tag to restore.
  --timestamp UTC       Timestamp portion, e.g. 20260623T010203Z.
  --force               Required. Restore overwrites live state.
USAGE
}

parse_args() {
  FORCE=0
  RESTORE_KIND="${AGENT_STATE_RESTORE_KIND:-}"
  RESTORE_TAG=""
  RESTORE_TIMESTAMP=""
  RESTORE_SELECTOR="latest"

  while (($#)); do
    case "$1" in
      --force)
        FORCE=1
        shift
        ;;
      --kind)
        RESTORE_KIND="${2:-}"
        shift 2
        ;;
      --tag)
        RESTORE_TAG="${2:-}"
        shift 2
        ;;
      --timestamp)
        RESTORE_TIMESTAMP="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      latest)
        RESTORE_SELECTOR="latest"
        shift
        ;;
      predeploy-*|nightly-*)
        RESTORE_TAG="$1"
        shift
        ;;
      [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z)
        RESTORE_TIMESTAMP="$1"
        shift
        ;;
      *)
        log "ERROR: unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done

  if [[ "$RESTORE_KIND" != "" && "$RESTORE_KIND" != "predeploy" && "$RESTORE_KIND" != "nightly" ]]; then
    log "ERROR: --kind must be predeploy or nightly"
    exit 1
  fi

  if (( FORCE != 1 )); then
    log "ERROR: --force is required because restore will overwrite live state in /data and the Paperclip DB."
    exit 1
  fi
}

resolve_restore_tag() {
  if [[ -n "$RESTORE_TAG" ]]; then
    printf '%s\n' "$RESTORE_TAG"
    return 0
  fi

  if [[ -n "$RESTORE_TIMESTAMP" ]]; then
    if [[ -z "$RESTORE_KIND" ]]; then
      log "ERROR: --timestamp requires --kind predeploy|nightly so the release tag is unambiguous."
      return 1
    fi
    printf '%s-%s\n' "$RESTORE_KIND" "$RESTORE_TIMESTAMP"
    return 0
  fi

  if [[ "$RESTORE_SELECTOR" == "latest" ]]; then
    release_backup_latest_release_tag "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$RESTORE_KIND"
    return
  fi

  log "ERROR: no restore target selected"
  return 1
}

download_manifest_and_assets() {
  local release_id="$1"
  local out_dir="$2"
  local name _sha _size
  local manifest_lines

  log "Downloading manifest.json"
  release_backup_download_asset "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$release_id" "manifest.json" "$out_dir/manifest.json"
  release_backup_verify_asset "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$release_id" "manifest.json" "$out_dir/manifest.json"

  manifest_lines="$(release_backup_json manifest-files "$out_dir/manifest.json")" || return 1
  if [[ -z "$manifest_lines" ]]; then
    log "ERROR: manifest contains no files"
    return 1
  fi
  while IFS=$'\t' read -r name _sha _size; do
    log "Downloading $name"
    release_backup_download_asset "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$release_id" "$name" "$out_dir/$name"
  done <<< "$manifest_lines"

  release_backup_verify_manifest_files "$out_dir/manifest.json" "$out_dir"

  if [[ ! -f "$out_dir/paperclip-db.sql.gz" || ! -f "$out_dir/hermes-profiles.tar.gz" ]]; then
    log "ERROR: manifest must include paperclip-db.sql.gz and hermes-profiles.tar.gz"
    return 1
  fi
}

restore_database() {
  local db_file="$1"

  log "Restoring Paperclip DB"
  paperclipai db:restore "$db_file"
}

restore_hermes_profiles() {
  local profiles_file="$1"

  log "Extracting Hermes profiles into /data"
  tar xzf "$profiles_file" -C /data
}

fix_ownership() {
  local owner="${AGENT_STATE_RESTORE_OWNER:-}"

  if [[ -z "$owner" ]]; then
    if id hermes >/dev/null 2>&1; then
      owner="hermes:hermes"
    elif id node >/dev/null 2>&1; then
      owner="node:node"
    fi
  fi

  if [[ -z "$owner" ]]; then
    log "WARN: no hermes or node user found; skipping ownership repair."
    return 0
  fi

  log "Fixing /data/hermes ownership to $owner"
  chown -R "$owner" /data/hermes
}

main() {
  parse_args "$@"

  : "${AGENT_STATE_REPO:?AGENT_STATE_REPO must be set (e.g. <Org>/agent-<brand>)}"
  release_backup_require_token "$AGENT_STATE_REPO"
  release_backup_validate_repo "$AGENT_STATE_REPO"

  local tag release_id
  tag="$(resolve_restore_tag)"
  log "Restoring release $tag from $AGENT_STATE_REPO"
  release_id="$(release_backup_release_id_for_tag "$AGENT_STATE_REPO" "$AGENT_STATE_TOKEN" "$tag")"

  TMP_DIR="$(mktemp -d -t agent-state-restore-XXXXXX)"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT

  download_manifest_and_assets "$release_id" "$TMP_DIR"
  restore_database "$TMP_DIR/paperclip-db.sql.gz"
  restore_hermes_profiles "$TMP_DIR/hermes-profiles.tar.gz"
  fix_ownership

  log "Restore complete."
}

if [[ "${AGENT_STATE_TEST_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
