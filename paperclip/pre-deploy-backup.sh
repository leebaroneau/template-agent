#!/usr/bin/env bash
# Pre-deployment backup for the dual Paperclip+Hermes container.
#
# Snapshots the live /data volume (Paperclip DB + Hermes profiles + GBrain
# pglites) and pushes a dated commit to a per-brand state repo BEFORE
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

if [[ -z "${AGENT_STATE_REPO:-}" ]]; then
  log "AGENT_STATE_REPO is unset; skipping pre-deploy backup (this is a no-op for unconfigured deployments)."
  exit 0
fi

BRAND="${AGENT_STATE_BRAND:-${AGENT_STATE_REPO##*/}}"
KEY_FILE="${AGENT_STATE_KEY_FILE:-/home/node/.ssh/agent-state-deploy}"
WORKDIR="${AGENT_STATE_WORKDIR:-/tmp/agent-state-repo}"
DATE="$(date -u +%Y-%m-%d)"
TMP_DIR="$(mktemp -d -t agent-state-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

git_auth_env=()
git_auth_url="git@github.com:${AGENT_STATE_REPO}.git"
if [[ -f "$KEY_FILE" ]]; then
  git_auth_env=(env "GIT_SSH_COMMAND=ssh -i $KEY_FILE -o IdentitiesOnly=yes -o UserKnownHostsFile=/home/node/.ssh/known_hosts -o StrictHostKeyChecking=accept-new")
elif [[ -n "${AGENT_STATE_TOKEN:-}" ]]; then
  git_auth_url="https://github.com/${AGENT_STATE_REPO}.git"
  git_askpass="$TMP_DIR/git-askpass.sh"
  cat > "$git_askpass" <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  Username*) printf '%s\n' 'x-access-token' ;;
  Password*) printf '%s\n' "$AGENT_STATE_TOKEN" ;;
esac
ASKPASS
  chmod 700 "$git_askpass"
  git_auth_env=(env GIT_TERMINAL_PROMPT=0 "GIT_ASKPASS=$git_askpass")
else
  log "ERROR: no deploy key at $KEY_FILE and AGENT_STATE_TOKEN is unset. Skipping backup so this missing-auth state does not block deployment, but the operator should investigate."
  exit 0
fi

log "Brand: $BRAND  Repo: $AGENT_STATE_REPO  Date: $DATE"

# 1. Paperclip DB dump
log "Dumping Paperclip DB"
paperclipai db:backup --dir "$TMP_DIR" >/dev/null 2>&1
DB_FILE="$(ls -1t "$TMP_DIR"/paperclip-*.sql.gz | head -1)"
[[ -f "$DB_FILE" ]] || { log "ERROR: paperclipai db:backup produced no .sql.gz; aborting"; exit 1; }

# 2. Hermes profiles + 3. GBrain  (both live on the shared /data volume)
log "Taring Hermes profiles + GBrain"
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
tar czf "$TMP_DIR/gbrain.tar.gz" -C /data gbrain 2>/dev/null || true

# 4. Clone (or refresh) the state repo via the deploy key
log "Refreshing $WORKDIR"
rm -rf "$WORKDIR"
"${git_auth_env[@]}" git clone -q --depth 50 "$git_auth_url" "$WORKDIR"

# 5. Stage the new snapshot
SNAPSHOT_DIR="$WORKDIR/$DATE"
mkdir -p "$SNAPSHOT_DIR"
mv "$DB_FILE" "$SNAPSHOT_DIR/paperclip-db.sql.gz"
mv "$TMP_DIR/hermes-profiles.tar.gz" "$SNAPSHOT_DIR/hermes-profiles.tar.gz" 2>/dev/null || log "  (no hermes-profiles archive, skipping)"
mv "$TMP_DIR/gbrain.tar.gz" "$SNAPSHOT_DIR/gbrain.tar.gz" 2>/dev/null || log "  (no gbrain archive, skipping)"

cd "$WORKDIR"
git add -A
if git diff --cached --quiet; then
  log "No changes to commit (snapshot identical to last)"
  exit 0
fi

# 6. Commit + push via the deploy key
COMMIT_MSG="Pre-deploy snapshot: $DATE ($BRAND)"
log "Committing: $COMMIT_MSG"
git -c user.name="agent-state-pre-deploy" \
    -c user.email="pre-deploy@${BRAND}.agent" \
    commit -q -m "$COMMIT_MSG"

log "Pushing to $AGENT_STATE_REPO"
"${git_auth_env[@]}" git push -q origin HEAD:main

log "Done."
