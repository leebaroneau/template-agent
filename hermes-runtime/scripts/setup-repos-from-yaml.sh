#!/usr/bin/env bash
# setup-repos-from-yaml.sh — Clone missing bare repos from repo-access.yml
# Runs INSIDE the container. Safe to run on every restart (idempotent).
#
# Usage:
#   setup-repos-from-yaml.sh [--config /path/to/repo-access.yml] [--dry-run]
#
# Env:
#   REPO_ACCESS_CONFIG   path to config file  (default: /config/repo-access.yml)
#   HERMES_REPOS_ROOT    bare clone root parent  (default: /opt/repos; bare clones go in $HERMES_REPOS_ROOT/bare/)
#   GH_TOKEN             GitHub token for auth   (required for private repos)

set -euo pipefail

CONFIG_FILE="${REPO_ACCESS_CONFIG:-/config/repo-access.yml}"
REPOS_ROOT="${HERMES_REPOS_ROOT:-/opt/repos}/bare"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --config) CONFIG_FILE="$2"; shift ;;
    -*) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

[[ -f "$CONFIG_FILE" ]] || { echo "[setup-repos] config not found at $CONFIG_FILE — skipping" >&2; exit 0; }

PYTHON="${HERMES_PYTHON:-/usr/local/lib/hermes-agent/venv/bin/python}"
[[ -x "$PYTHON" ]] || PYTHON="python3"
"$PYTHON" -c "import yaml" 2>/dev/null || { echo "[setup-repos] ERROR: pyyaml not installed" >&2; exit 1; }

mkdir -p "$REPOS_ROOT"

# Configure git to use GH_TOKEN for HTTPS clones if available
if [[ -n "${GH_TOKEN:-}" ]]; then
  git config --global url."https://${GH_TOKEN}:x-oauth-basic@github.com/".insteadOf "https://github.com/" 2>/dev/null || true
fi

export _SETUP_CONFIG="$CONFIG_FILE"
export _REPOS_ROOT="$REPOS_ROOT"

CLONE_LIST=$("$PYTHON" << 'PYEOF'
import yaml, os, sys

with open(os.environ['_SETUP_CONFIG']) as f:
    config = yaml.safe_load(f)

github = config.get('github', {})
org = github.get('org', '')
base_url = github.get('base_url', 'https://github.com').rstrip('/')
auto_clone = github.get('auto_clone', False)

if not org:
    print('[setup-repos] ERROR: github.org is not set in config — cannot clone non-cross-org repos', file=sys.stderr)
    sys.exit(1)

seen = set()
repos = []

# Explicit repo_groups entries (unchanged from original)
groups = config.get('repo_groups', {})
for group_repos in groups.values():
    for repo in (group_repos or []):
        if repo not in seen:
            seen.add(repo)
            repos.append(repo)

# auto_clone: query GitHub org API for all non-archived repos
if auto_clone:
    gh_token = os.environ.get('GH_TOKEN', '')
    if not gh_token:
        print('[setup-repos] WARN: auto_clone=true but GH_TOKEN not set — skipping org query', file=sys.stderr)
    else:
        import urllib.request, json
        page = 1
        while True:
            url = f'https://api.github.com/orgs/{org}/repos?type=all&per_page=100&page={page}'
            req = urllib.request.Request(url, headers={
                'Authorization': f'token {gh_token}',
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            })
            try:
                with urllib.request.urlopen(req) as resp:
                    page_repos = json.loads(resp.read())
            except Exception as e:
                print(f'[setup-repos] WARN: GitHub API error on page {page}: {e}', file=sys.stderr)
                break
            if not page_repos:
                break
            for r in page_repos:
                if r.get('archived'):
                    continue
                name = r['name']
                if name not in seen:
                    seen.add(name)
                    repos.append(name)
            page += 1

for repo in repos:
    if '/' in repo:
        clone_url = f"{base_url}/{repo}.git"
        bare_name = repo.split('/')[-1]
    else:
        clone_url = f"{base_url}/{org}/{repo}.git"
        bare_name = repo
    print(f"{clone_url}\t{bare_name}")
PYEOF
)

cloned=0
skipped=0
failed=0

while IFS=$'\t' read -r clone_url bare_name; do
  bare_path="${REPOS_ROOT}/${bare_name}.git"
  if [[ -d "$bare_path" ]]; then
    echo "[setup-repos] skip: $bare_name (already cloned)"
    (( skipped++ )) || true
    continue
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[setup-repos] would clone: $bare_name ← $clone_url"
    (( cloned++ )) || true
    continue
  fi
  echo "[setup-repos] clone: $bare_name"
  clone_output=$(git clone --bare "$clone_url" "$bare_path" 2>&1) && clone_ok=1 || clone_ok=0
  [[ -n "$clone_output" ]] && echo "$clone_output" | sed 's/^/[setup-repos]   /'
  if [[ "$clone_ok" -eq 1 ]]; then
    (( cloned++ )) || true
  else
    echo "[setup-repos] WARN: failed to clone $bare_name" >&2
    rm -rf "$bare_path" 2>/dev/null || true
    (( failed++ )) || true
  fi
done <<< "$CLONE_LIST"

echo "[setup-repos] done: $cloned cloned, $skipped skipped, $failed failed"
[[ "$failed" -eq 0 ]]
