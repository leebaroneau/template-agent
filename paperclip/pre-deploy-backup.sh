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
#   AGENT_STATE_BRANCH     - branch to push snapshots to (default: agent-state).
#                            MUST NOT be the branch Coolify deploys from — Coolify
#                            auto-deploys on push to the deploy branch, so pushing
#                            snapshots there creates a pre-deploy -> deploy loop.
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
    log "ERROR: AGENT_STATE_REPO is set ($AGENT_STATE_REPO) but there is no deploy key at $key_file and AGENT_STATE_TOKEN is unset. This brand is configured to back up, so refusing to deploy without a recovery point (fail-closed). Restore the deploy key or AGENT_STATE_TOKEN, then re-deploy."
    exit 1
  fi

  log "Brand: $brand  Repo: $AGENT_STATE_REPO  Date: $date"

  # 1. Paperclip DB dump — retry against embedded-postgres warmup.
  # pre_deployment_command runs INSIDE a container; a freshly-restarted one
  # (e.g. back-to-back deploys) may not have its embedded postgres ready yet,
  # so a single attempt can fail spuriously. Retry with backoff. We stay
  # fail-closed: if no dump is produced after all attempts, abort the deploy
  # rather than let Coolify swap the container without a recovery point.
  log "Dumping Paperclip DB"
  local db_file="" attempt=0
  local max_attempts="${AGENT_STATE_BACKUP_RETRIES:-6}"
  local retry_delay="${AGENT_STATE_BACKUP_RETRY_DELAY:-10}"
  while (( attempt < max_attempts )); do
    attempt=$(( attempt + 1 ))
    if paperclipai db:backup --dir "$TMP_DIR" >/dev/null 2>"$TMP_DIR/db-backup.err"; then
      db_file="$(ls -1t "$TMP_DIR"/paperclip-*.sql.gz 2>/dev/null | head -1)"
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
    if [[ -s "$TMP_DIR/db-backup.err" ]]; then
      log "  last db:backup stderr: $(tail -n 3 "$TMP_DIR/db-backup.err" | tr '\n' ' ')"
    fi
    exit 1
  fi

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
    hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks \
    2>/dev/null || true

  # 4. Clone (or refresh) the snapshot branch via the deploy key.
  # Snapshots go to a DEDICATED branch (default: agent-state), never the branch
  # Coolify deploys from — pushing snapshots to the deploy branch triggers an
  # auto-deploy on every backup, which loops. The branch is an orphan snapshot
  # tree (no code), created on first run if it doesn't exist yet.
  local state_branch="${AGENT_STATE_BRANCH:-agent-state}"
  log "Refreshing $workdir (snapshot branch: $state_branch)"
  rm -rf "$workdir"
  if "${git_auth_env[@]}" git clone -q --depth 50 --single-branch --branch "$state_branch" "$git_auth_url" "$workdir" 2>/dev/null; then
    log "  cloned existing snapshot branch $state_branch"
  else
    log "  snapshot branch $state_branch not found; creating it (orphan)"
    "${git_auth_env[@]}" git clone -q --depth 1 "$git_auth_url" "$workdir"
    ( cd "$workdir" && git checkout -q --orphan "$state_branch" && git rm -rfq . >/dev/null 2>&1 || true )
  fi

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

  log "Pushing to $AGENT_STATE_REPO ($state_branch)"
  "${git_auth_env[@]}" git push -q origin "HEAD:$state_branch"

  log "Done."
}

if [[ "${AGENT_STATE_TEST_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
