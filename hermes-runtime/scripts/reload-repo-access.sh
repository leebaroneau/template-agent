#!/usr/bin/env bash
# reload-repo-access — Apply /data/agent-stack/repo-access.yml immediately.
#
# Validates the config, clones any missing bare repos, and writes REPOS= into
# all matching profile .env files. Safe to run multiple times (idempotent).
#
# Usage:
#   reload-repo-access [--dry-run] [--config /path/to/repo-access.yml]
#
# Env:
#   REPO_ACCESS_CONFIG   path to config file  (default: /data/agent-stack/repo-access.yml)
#   HERMES_DATA_ROOT     hermes data dir       (default: /data/hermes)
#   HERMES_REPOS_ROOT    repos root dir        (default: /data/repos)
#   GH_TOKEN             GitHub token for private repos and auto_clone

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${REPO_ACCESS_CONFIG:-/data/agent-stack/repo-access.yml}"
DRY_RUN_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN_FLAG="--dry-run" ;;
    --config)  CONFIG_FILE="$2"; shift ;;
    -*) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[reload-repo-access] ERROR: no config found at $CONFIG_FILE" >&2
  echo "[reload-repo-access] Create it from: /opt/hermes-runtime/templates/repo-access.yml.example" >&2
  exit 1
fi

# Derive GH_TOKEN from persisted gh auth if not already set. This means no
# Coolify env var is needed — auth lives in /data/cli-auth/.config/gh (symlinked
# by the entrypoint) and is used only for cloning, never written to profile envs.
if [[ -z "${GH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  GH_TOKEN="$(gh auth token 2>/dev/null)" || true
  export GH_TOKEN
fi

PYTHON="${HERMES_PYTHON:-/usr/local/lib/hermes-agent/venv/bin/python}"
[[ -x "$PYTHON" ]] || PYTHON="python3"

if ! "$PYTHON" -c "import yaml; yaml.safe_load(open('$CONFIG_FILE'))" 2>/dev/null; then
  echo "[reload-repo-access] ERROR: invalid YAML in $CONFIG_FILE" >&2
  "$PYTHON" -c "import yaml; yaml.safe_load(open('$CONFIG_FILE'))" 2>&1 || true
  exit 1
fi

echo "[reload-repo-access] Config: $CONFIG_FILE"
echo "[reload-repo-access] Step 1/2: cloning missing repos..."
REPO_ACCESS_CONFIG="$CONFIG_FILE" "$SCRIPT_DIR/setup-repos-from-yaml.sh" $DRY_RUN_FLAG

echo "[reload-repo-access] Step 2/2: syncing profile REPOS= entries..."
REPO_ACCESS_CONFIG="$CONFIG_FILE" "$SCRIPT_DIR/sync-repos-local.sh" $DRY_RUN_FLAG

# Fix ownership so node profiles can use hermes-worktree without safe.directory
# errors regardless of which user ran this script.
REPOS_ROOT="${HERMES_REPOS_ROOT:-/data/repos}"
if [[ -d "$REPOS_ROOT" ]]; then
  chown -R node:node "$REPOS_ROOT" 2>/dev/null || true
fi

echo "[reload-repo-access] Done."
