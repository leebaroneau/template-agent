#!/usr/bin/env bash
# sync-repos-local.sh — Write REPOS= to profile .env files from repo-access.yml
# Runs INSIDE the container. Safe to run on every restart (idempotent).
#
# Usage:
#   sync-repos-local.sh [--config /path/to/repo-access.yml]
#
# Env:
#   REPO_ACCESS_CONFIG   path to config file   (default: /config/repo-access.yml)
#   HERMES_DATA_ROOT     hermes data directory  (default: /data/hermes)

set -euo pipefail

CONFIG_FILE="${REPO_ACCESS_CONFIG:-/config/repo-access.yml}"
DATA_ROOT="${HERMES_DATA_ROOT:-/data/hermes}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift ;;
    --data-root) DATA_ROOT="$2"; shift ;;
    -*) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

[[ -f "$CONFIG_FILE" ]] || { echo "[sync-repos] config not found at $CONFIG_FILE — skipping" >&2; exit 0; }

PYTHON="${HERMES_PYTHON:-/usr/local/lib/hermes-agent/venv/bin/python}"
# Fall back to system python3 if venv not present
[[ -x "$PYTHON" ]] || PYTHON="python3"
"$PYTHON" -c "import yaml" 2>/dev/null || { echo "[sync-repos] ERROR: pyyaml not available (tried $PYTHON)" >&2; exit 1; }

export _SYNC_CONFIG="$CONFIG_FILE"
export _DATA_ROOT="$DATA_ROOT"

"$PYTHON" << 'PYEOF'
import yaml, os

with open(os.environ['_SYNC_CONFIG']) as f:
    config = yaml.safe_load(f)

groups    = config.get('repo_groups', {})
profiles  = config.get('profiles', {})
data_root = os.environ['_DATA_ROOT']

for profile_name, entries in (profiles or {}).items():
    rw = []
    for entry in (entries or []):
        if entry.get('level') == 'rw':
            rw.extend(groups.get(entry.get('group', ''), []))
    rw = [r.split('/')[-1] if '/' in r else r for r in rw]  # strip org prefix for cross-org repos
    rw = list(dict.fromkeys(rw))  # deduplicate, preserve order
    repos_line = f"REPOS={','.join(rw)}"

    if profile_name == 'default':
        env_file = os.path.join(data_root, '.env')
    else:
        env_file = os.path.join(data_root, 'profiles', profile_name, '.env')

    if not os.path.exists(env_file):
        print(f"[sync-repos] skip: {profile_name} (.env not found — profile not yet bootstrapped)")
        continue

    with open(env_file, 'r') as f:
        lines = f.readlines()

    found = False
    new_lines = []
    for line in lines:
        if line.startswith('REPOS='):
            new_lines.append(repos_line + '\n')
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(repos_line + '\n')

    with open(env_file, 'w') as f:
        f.writelines(new_lines)

    print(f"[sync-repos] ok: {profile_name} → {len(rw)} rw repos")
PYEOF
