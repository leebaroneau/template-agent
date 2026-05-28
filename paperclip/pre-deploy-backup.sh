#!/usr/bin/env bash
# Pre-deployment backup for the dual Paperclip+Hermes container.
#
# Snapshots the live /data volume (Paperclip DB + Hermes profiles) and pushes
# a dated commit to a per-brand state repo BEFORE
# Coolify replaces this container.
#
# Wired in by setting Coolify's `pre_deployment_command` to:
#   bash /opt/paperclip/pre-deploy-backup.sh
# and `pre_deployment_container_name` to `paperclip` (this service).
#
# Required env vars (set in Coolify on the application):
#   AGENT_STATE_REPO       - e.g. <Org>/agent-<brand>
#   AGENT_STATE_BRAND      - short slug for log + commit attribution
#   AGENT_STATE_DEPLOY_KEY - preferred: base64-encoded SSH private key for the
#                            repo's deploy key (installed into ~/.ssh/agent-state-deploy
#                            by entrypoint.sh)
#   AGENT_STATE_TOKEN      - fallback: GitHub token with push access, used only
#                            when deploy keys are disabled for the repo/org
#
# Returns 0 on success AND on graceful no-op (when env vars missing) so a
# missing-config deployment doesn't block. Logs everything to stderr.

set -euo pipefail

log() { printf '[pre-deploy-backup] %s\n' "$*" >&2; }

file_size_bytes() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}

stage_snapshot_file() {
  local source_file="$1"
  local snapshot_dir="$2"
  local snapshot_name="$3"
  local missing_message="${4:-no $snapshot_name archive, skipping}"
  local split_bytes="${AGENT_STATE_ARCHIVE_SPLIT_BYTES:-95000000}"

  if [[ ! -f "$source_file" ]]; then
    log "  ($missing_message)"
    return 0
  fi

  rm -f "$snapshot_dir/$snapshot_name" "$snapshot_dir/$snapshot_name.part-"*

  local size
  size="$(file_size_bytes "$source_file")"
  if (( size > split_bytes )); then
    log "  splitting $snapshot_name ($size bytes) into ${split_bytes}-byte parts"
    split -b "$split_bytes" -d -a 4 "$source_file" "$snapshot_dir/$snapshot_name.part-"
    return 0
  fi

  mv "$source_file" "$snapshot_dir/$snapshot_name"
  log "  saved $snapshot_name ($size bytes)"
}

main() {
  if [[ -z "${AGENT_STATE_REPO:-}" ]]; then
    log "AGENT_STATE_REPO is unset; skipping pre-deploy backup (this is a no-op for unconfigured deployments)."
    exit 0
  fi

  local brand="${AGENT_STATE_BRAND:-${AGENT_STATE_REPO##*/}}"
  local key_file="${AGENT_STATE_KEY_FILE:-/home/node/.ssh/agent-state-deploy}"
  local workdir="${AGENT_STATE_WORKDIR:-/tmp/agent-state-repo}"
  local date
  date="$(date -u +%Y-%m-%d)"
  TMP_DIR="$(mktemp -d -t agent-state-XXXXXX)"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT

  local -a git_auth_env=()
  local git_auth_url="git@github.com:${AGENT_STATE_REPO}.git"
  if [[ -f "$key_file" ]]; then
    git_auth_env=(env "GIT_SSH_COMMAND=ssh -i $key_file -o IdentitiesOnly=yes -o UserKnownHostsFile=/home/node/.ssh/known_hosts -o StrictHostKeyChecking=accept-new")
  elif [[ -n "${AGENT_STATE_TOKEN:-}" ]]; then
    git_auth_url="https://github.com/${AGENT_STATE_REPO}.git"
    local git_askpass="$TMP_DIR/git-askpass.sh"
    cat > "$git_askpass" <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  Username*) printf '%s\n' 'x-access-token' ;;
  Password*) printf '%s\n' "$AGENT_STATE_TOKEN" ;;
esac
ASKPASS
    chmod 700 "$git_askpass"
    git_auth_env=(env GIT_TERMINAL_PROMPT=0 "GIT_ASKPASS=$git_askpass" "AGENT_STATE_TOKEN=$AGENT_STATE_TOKEN")
  else
    log "ERROR: no deploy key at $key_file and AGENT_STATE_TOKEN is unset. Skipping backup so this missing-auth state does not block deployment, but the operator should investigate."
    exit 0
  fi

  log "Brand: $brand  Repo: $AGENT_STATE_REPO  Date: $date"

  # 1. Paperclip DB dump
  log "Dumping Paperclip DB"
  paperclipai db:backup --dir "$TMP_DIR" >/dev/null 2>&1
  local db_file
  db_file="$(ls -1t "$TMP_DIR"/paperclip-*.sql.gz | head -1)"
  [[ -f "$db_file" ]] || { log "ERROR: paperclipai db:backup produced no .sql.gz; aborting"; exit 1; }

  # 2. Hermes profiles  (live on the shared /data volume)
  log "Taring Hermes profiles"
  tar czf "$TMP_DIR/hermes-profiles.tar.gz" \
    --exclude='hermes/profiles/*/profile-backups' \
    --exclude='hermes/profiles/*/python-packages' \
    --exclude='hermes/profiles/*/bin' \
    --exclude='hermes/profiles/*/lsp' \
    --exclude='hermes/profiles/*/cache' \
    --exclude='hermes/profiles/*/audio_cache' \
    --exclude='*/__pycache__' \
    -C /data \
    hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks 2>/dev/null || true

  # 4. Clone (or refresh) the state repo via the deploy key
  log "Refreshing $workdir"
  rm -rf "$workdir"
  "${git_auth_env[@]}" git clone -q --depth 50 "$git_auth_url" "$workdir"

  # 5. Stage the new snapshot
  local snapshot_dir="$workdir/$date"
  mkdir -p "$snapshot_dir"
  stage_snapshot_file "$db_file" "$snapshot_dir" "paperclip-db.sql.gz"
  stage_snapshot_file "$TMP_DIR/hermes-profiles.tar.gz" "$snapshot_dir" "hermes-profiles.tar.gz" "no hermes-profiles archive, skipping"

  cd "$workdir"
  git add -A
  if git diff --cached --quiet; then
    log "No changes to commit (snapshot identical to last)"
    exit 0
  fi

  # 6. Commit + push via the deploy key
  local commit_msg="Pre-deploy snapshot: $date ($brand)"
  log "Committing: $commit_msg"
  git -c user.name="agent-state-pre-deploy" \
      -c user.email="pre-deploy@${brand}.agent" \
      commit -q -m "$commit_msg"

  log "Pushing to $AGENT_STATE_REPO"
  "${git_auth_env[@]}" git push -q origin HEAD:main

  log "Done."
}

if [[ "${AGENT_STATE_TEST_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
