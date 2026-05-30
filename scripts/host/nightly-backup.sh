#!/usr/bin/env bash
# Nightly state backup for a brand's dual Paperclip+Hermes Coolify deployment.
#
# This runs on the DROPLET HOST (not inside the container) via cron. It
# `docker exec`s into the running paperclip + hermes containers to dump the
# Paperclip DB and tar the Hermes profiles, then commits
# and pushes to the brand's `agent-<brand>` state repo on GitHub via SSH
# deploy key.
#
# Brand-agnostic — all per-brand values come from the env file sourced
# below. Each brand's droplet gets its own copy at
# /root/agent-state-backup/nightly-backup.sh (or wherever you prefer) and
# its own env file with the brand's deploy key path, container filter,
# and state repo URL.
#
# Install:
#   1. Copy this file onto the droplet host: scp scripts/host/nightly-backup.sh
#      root@<droplet>:/root/agent-state-backup/nightly-backup.sh
#   2. Generate a per-brand SSH deploy key, add as a write-enabled deploy key
#      on the state repo:
#        ssh-keygen -t ed25519 -C "agent-<brand>-state-backup" \
#          -f ~/.ssh/agent-<brand>-deploy -N ''
#        gh api -X POST repos/<Org>/agent-<brand>/keys \
#          -f title="<droplet> nightly backup" \
#          -f key="$(cat ~/.ssh/agent-<brand>-deploy.pub)" -F read_only=false
#   3. Create the env file `/root/agent-state-backup/backup.env` with:
#        AGENT_STATE_REPO=<Org>/agent-<brand>
#        AGENT_STATE_BRAND=<brand>
#        AGENT_STATE_KEY=/root/.ssh/agent-<brand>-deploy
#        # If deploy keys are disabled, use instead:
#        # AGENT_STATE_TOKEN_FILE=/root/agent-state-backup/github-token
#        AGENT_STATE_COMPOSE_FILTER=<coolify-app-uuid>
#        (optional) AGENT_STATE_RETENTION_DAYS=30
#   4. Configure SSH alias `github-agent-state` for the deploy key:
#        cat >> ~/.ssh/config <<EOF
#        Host github-agent-state
#          HostName github.com
#          User git
#          IdentityFile /root/.ssh/agent-<brand>-deploy
#          IdentitiesOnly yes
#          StrictHostKeyChecking accept-new
#        EOF
#   5. Clone the state repo once:
#        git clone github-agent-state:<Org>/agent-<brand>.git /root/agent-state-backup/repo
#   6. Install cron (suggest 0 17 * * * UTC = 03:00 Sydney):
#        (crontab -l; echo "0 17 * * * /root/agent-state-backup/nightly-backup.sh \
#          >> /var/log/agent-state-backup.log 2>&1") | crontab -

set -euo pipefail

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

file_size_bytes() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}

stage_snapshot_file() {
  local source_file="$1"
  local snapshot_dir="$2"
  local snapshot_name="$3"
  local split_bytes="${AGENT_STATE_ARCHIVE_SPLIT_BYTES:-95000000}"

  if [[ ! -f "$source_file" ]]; then
    log "  skipping $snapshot_name; source file missing"
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

# ── Config ─────────────────────────────────────────────────────────────
ENV_FILE="${AGENT_STATE_ENV_FILE:-/root/agent-state-backup/backup.env}"
REPO_DIR="${AGENT_STATE_REPO_DIR:-/root/agent-state-backup/repo}"
LOG_FILE="${AGENT_STATE_LOG_FILE:-/var/log/agent-state-backup.log}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${AGENT_STATE_TOKEN:-}" && -n "${AGENT_STATE_TOKEN_FILE:-}" && -f "$AGENT_STATE_TOKEN_FILE" ]]; then
  AGENT_STATE_TOKEN="$(cat "$AGENT_STATE_TOKEN_FILE")"
fi

: "${AGENT_STATE_REPO:?AGENT_STATE_REPO must be set (e.g. <Org>/agent-<brand>)}"
: "${AGENT_STATE_BRAND:?AGENT_STATE_BRAND must be set (e.g. <brand>)}"
: "${AGENT_STATE_COMPOSE_FILTER:?AGENT_STATE_COMPOSE_FILTER must be set (Coolify app UUID prefix; e.g. g1177fqvz8uyq3irqj3hl5b8)}"

RETENTION_DAYS="${AGENT_STATE_RETENTION_DAYS:-30}"
DATE="$(date -u +%Y-%m-%d)"
SNAPSHOT_DIR="$REPO_DIR/$DATE"
TMP_DIR="$(mktemp -d -t agent-state-nightly-XXXXXX)"
trap 'rm -rf "$TMP_DIR" "${GIT_ASKPASS_FILE:-}"' EXIT

log "=== Starting backup for brand=$AGENT_STATE_BRAND date=$DATE ==="

git_auth_env=()
if [[ -n "${AGENT_STATE_TOKEN:-}" ]]; then
  GIT_ASKPASS_FILE="$(mktemp -t agent-state-askpass-XXXXXX)"
  cat > "$GIT_ASKPASS_FILE" <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  Username*) printf '%s\n' 'x-access-token' ;;
  Password*) printf '%s\n' "$AGENT_STATE_TOKEN" ;;
esac
ASKPASS
  chmod 700 "$GIT_ASKPASS_FILE"
  git_auth_env=(env GIT_TERMINAL_PROMPT=0 "GIT_ASKPASS=$GIT_ASKPASS_FILE" "AGENT_STATE_TOKEN=$AGENT_STATE_TOKEN")
elif [[ -n "${AGENT_STATE_KEY:-}" ]]; then
  git_auth_env=(env "GIT_SSH_COMMAND=ssh -i $AGENT_STATE_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new")
fi

# ── Resolve container names dynamically (Coolify renames on each deploy) ───
PAPERCLIP_CONTAINER="$(docker ps --filter "name=paperclip-${AGENT_STATE_COMPOSE_FILTER}" --format '{{.Names}}' | head -1)"
HERMES_CONTAINER="$(docker ps --filter "name=hermes-${AGENT_STATE_COMPOSE_FILTER}" --format '{{.Names}}' | head -1)"

if [[ -z "$PAPERCLIP_CONTAINER" || -z "$HERMES_CONTAINER" ]]; then
  log "ERROR: containers not running (paperclip=$PAPERCLIP_CONTAINER, hermes=$HERMES_CONTAINER); aborting"
  exit 1
fi

mkdir -p "$SNAPSHOT_DIR"

# ── 1. Paperclip DB dump ───────────────────────────────────────────────
log "Dumping Paperclip DB via $PAPERCLIP_CONTAINER"
docker exec "$PAPERCLIP_CONTAINER" bash -lc 'paperclipai db:backup --dir /tmp >/dev/null 2>&1'
LATEST_DB="$(docker exec "$PAPERCLIP_CONTAINER" bash -lc 'ls -1t /tmp/paperclip-*.sql.gz | head -1')"
docker cp "$PAPERCLIP_CONTAINER:$LATEST_DB" "$TMP_DIR/paperclip-db.sql.gz"
stage_snapshot_file "$TMP_DIR/paperclip-db.sql.gz" "$SNAPSHOT_DIR" "paperclip-db.sql.gz"

# ── 2. Hermes profiles ──────────────────────────────────────────────────
log "Taring Hermes profiles via $HERMES_CONTAINER"
docker exec "$HERMES_CONTAINER" bash -lc 'cd /data && tar czf /tmp/hermes-profiles.tar.gz --exclude="hermes/profiles/*/profile-backups" --exclude="hermes/profiles/*/python-packages" --exclude="hermes/profiles/*/bin" --exclude="hermes/profiles/*/lsp" --exclude="hermes/profiles/*/cache" --exclude="hermes/profiles/*/audio_cache" --exclude="*/__pycache__" hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks 2>/dev/null'
docker cp "$HERMES_CONTAINER:/tmp/hermes-profiles.tar.gz" "$TMP_DIR/hermes-profiles.tar.gz"
stage_snapshot_file "$TMP_DIR/hermes-profiles.tar.gz" "$SNAPSHOT_DIR" "hermes-profiles.tar.gz"

# ── 4. Retention sweep ─────────────────────────────────────────────────
log "Pruning snapshots older than $RETENTION_DAYS days"
find "$REPO_DIR" -maxdepth 1 -type d -regextype posix-extended \
  -regex '.*/[0-9]{4}-[0-9]{2}-[0-9]{2}$' \
  -mtime "+$RETENTION_DAYS" -exec rm -rf {} + 2>/dev/null || true

# ── 5. Commit + push ───────────────────────────────────────────────────
cd "$REPO_DIR"
git add -A
if git diff --cached --quiet; then
  log "No changes to commit (snapshot identical to previous?)"
  log "=== Done ==="
  exit 0
fi

git -c user.name="agent-state-nightly-backup" \
    -c user.email="nightly-backup@${AGENT_STATE_BRAND}.agent" \
    commit -q -m "Nightly snapshot: $DATE ($AGENT_STATE_BRAND)"
"${git_auth_env[@]}" git push -q origin HEAD:main
log "Pushed snapshot for $DATE"
log "=== Done ==="
}

if [[ "${AGENT_STATE_TEST_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
