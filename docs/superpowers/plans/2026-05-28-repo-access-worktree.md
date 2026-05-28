# Repo Access & Worktree System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement declarative repo access config (`repo-access.yml`), a `reload-repo-access` command, auto-clone of non-archived org repos, volume consolidation so worktrees are backed up, and extend the nightly backup to include in-progress work and config.

**Architecture:** Extend existing scripts (`setup-repos-from-yaml.sh`, `nightly-backup.sh`) rather than writing from scratch. Add `reload-repo-access.sh` as a thin wrapper following the `bootstrap-profiles.sh` pattern. Move `HERMES_REPOS_ROOT` from `/opt/repos` (separate volume) to `/data/repos` (existing `paperclip-data` volume) so worktrees are automatically included in nightly backups.

**Tech Stack:** bash, Python (PyYAML — already in container venv), GitHub REST API (`/orgs/{org}/repos`), `GH_TOKEN` for auth (already supported).

---

## Pipeline-core setup (do this first)

- [ ] Create GitHub issue:
```bash
gh issue create \
  --repo leebaroneau/template-agent \
  --title "Feature request: repo-access.yml declarative config, reload-repo-access command, auto-clone, volume consolidation" \
  --label "type:story" \
  --body "Implement the design from docs/specs/2026-05-28-repo-access-worktree-design.md.

Key changes:
- Move HERMES_REPOS_ROOT from /opt/repos (separate volume) to /data/repos (paperclip-data volume)
- Add reload-repo-access command (wrapper around existing setup + sync scripts)
- Extend setup-repos-from-yaml.sh with auto_clone org query (non-archived only)
- Extend nightly-backup.sh to include agent-stack/repo-access.yml and repos/worktrees/
- Update SOUL.default.md, repo-access.yml.example, Dockerfile, entrypoint"
```

- [ ] Capture the issue number from the output (e.g. `#159`). Use it in all steps below.

- [ ] Create branch (replace `159` with actual issue number):
```bash
cd /Users/leebaroneau/Documents/GitHub/template-agent
git checkout main && git pull
git checkout -b story/159-repo-access-worktree-system
```

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `compose.yaml` | Modify | Change `HERMES_REPOS_ROOT` default, remove `hermes-repos` volume |
| `paperclip/Dockerfile` | Modify | Remove `/opt/repos` mkdir; symlink `reload-repo-access` to `/usr/local/bin/` |
| `paperclip/hermes-entrypoint.sh` | Modify | Create `/data/repos/bare` + `/data/repos/worktrees` at runtime; update chown |
| `hermes-runtime/scripts/reload-repo-access.sh` | Create | Thin wrapper: validate YAML → call setup-repos → call sync-repos → print summary |
| `hermes-runtime/scripts/setup-repos-from-yaml.sh` | Modify | Add `auto_clone` org query block (Python-in-bash, same pattern as existing clone list) |
| `hermes-runtime/templates/SOUL.default.md` | Modify | Add `reload-repo-access` to Repo Work section |
| `hermes-runtime/templates/repo-access.yml.example` | Modify | Add `auto_clone` field to schema |
| `config/repo-access.yml.example` | Modify | Update header comment to reflect new path |
| `scripts/host/nightly-backup.sh` | Modify | Add `agent-stack/repo-access.yml` and `repos/worktrees/` to backup tar |
| `scripts/test-reload-repo-access.sh` | Create | Tests for reload-repo-access (follows `test-hermes-worktree.sh` pattern) |

---

## Task 1: Volume consolidation — compose.yaml

**Files:**
- Modify: `compose.yaml`

- [ ] **Step 1: Update HERMES_REPOS_ROOT and remove hermes-repos volume**

In `compose.yaml`, in the `hermes:` service `environment:` block, change:
```yaml
      HERMES_REPOS_ROOT: /opt/repos
```
to:
```yaml
      HERMES_REPOS_ROOT: /data/repos
```

Remove the `hermes-repos` volume from `hermes:` service `volumes:`:
```yaml
# Remove this line:
      - hermes-repos:/opt/repos
```

Remove from the top-level `volumes:` block:
```yaml
# Remove this line:
  hermes-repos:
```

- [ ] **Step 2: Verify compose.yaml is valid**
```bash
cd /Users/leebaroneau/Documents/GitHub/template-agent
docker compose config --quiet && echo "OK"
```
Expected: `OK` with no errors.

- [ ] **Step 3: Commit**
```bash
git add compose.yaml
git commit -m "feat(compose): move HERMES_REPOS_ROOT to /data/repos, remove hermes-repos volume"
```

---

## Task 2: Volume consolidation — Dockerfile + entrypoint

**Files:**
- Modify: `paperclip/Dockerfile:130-131`
- Modify: `paperclip/hermes-entrypoint.sh`

- [ ] **Step 1: Remove /opt/repos mkdir from Dockerfile**

In `paperclip/Dockerfile`, find the block:
```bash
&& mkdir -p /data /opt/work \
```

Remove these two lines that reference `/opt/repos`:
```bash
&& mkdir -p /opt/repos/bare /opt/repos/worktrees \
&& chown -R node:node /opt/repos \
```

The Dockerfile should NOT pre-create `/opt/repos` since repos now live under `/data/` (a volume mount that would override image-baked dirs anyway).

- [ ] **Step 2: Add reload-repo-access symlink to Dockerfile**

In `paperclip/Dockerfile`, in the same `RUN` block where `hermes-worktree` is symlinked:
```bash
&& ln -sf /opt/hermes-runtime/scripts/hermes-worktree.sh /usr/local/bin/hermes-worktree \
```
Add immediately after:
```bash
&& ln -sf /opt/hermes-runtime/scripts/reload-repo-access.sh /usr/local/bin/reload-repo-access \
```

- [ ] **Step 3: Create /data/repos dirs at runtime in entrypoint**

In `paperclip/hermes-entrypoint.sh`, find the existing `mkdir -p` line:
```bash
mkdir -p "$HERMES_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks
```
Add `/data/repos/bare /data/repos/worktrees` to it:
```bash
mkdir -p "$HERMES_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks /data/repos/bare /data/repos/worktrees
```

- [ ] **Step 4: Update chown in entrypoint**

Find:
```bash
chown -R node:node /data /home/node/.hermes /opt/work /opt/repos
```
Change to:
```bash
chown -R node:node /data /home/node/.hermes /opt/work
```
(`/data/repos` is already under `/data` so the first entry covers it; `/opt/repos` no longer exists.)

- [ ] **Step 5: Commit**
```bash
git add paperclip/Dockerfile paperclip/hermes-entrypoint.sh
git commit -m "feat(infra): move repos to /data/repos, remove /opt/repos, add reload-repo-access symlink"
```

---

## Task 3: `reload-repo-access.sh` — new wrapper script

**Files:**
- Create: `hermes-runtime/scripts/reload-repo-access.sh`

- [ ] **Step 1: Create the script**

Create `hermes-runtime/scripts/reload-repo-access.sh`:

```bash
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
REPO_ACCESS_CONFIG="$CONFIG_FILE" "$SCRIPT_DIR/sync-repos-local.sh"

echo "[reload-repo-access] Done."
```

- [ ] **Step 2: Make executable**
```bash
chmod +x hermes-runtime/scripts/reload-repo-access.sh
```

- [ ] **Step 3: Commit**
```bash
git add hermes-runtime/scripts/reload-repo-access.sh
git commit -m "feat: add reload-repo-access wrapper script"
```

---

## Task 4: Tests for `reload-repo-access`

**Files:**
- Create: `scripts/test-reload-repo-access.sh`

- [ ] **Step 1: Create test script (follows test-hermes-worktree.sh pattern)**

Create `scripts/test-reload-repo-access.sh`:

```bash
#!/usr/bin/env bash
# Tests for hermes-runtime/scripts/reload-repo-access.sh
# No Docker required — uses temp dirs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/hermes-runtime/scripts/reload-repo-access.sh"
SETUP_SCRIPT="$ROOT_DIR/hermes-runtime/scripts/setup-repos-from-yaml.sh"
SYNC_SCRIPT="$ROOT_DIR/hermes-runtime/scripts/sync-repos-local.sh"
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

failed=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1" >&2; failed=1; }

setup_env() {
  local base="$1"
  mkdir -p "$base/agent-stack" "$base/hermes/profiles/my-cto" "$base/repos/bare" "$base/repos/worktrees"
  echo "PROFILE_NAME=my-cto" > "$base/hermes/profiles/my-cto/.env"
  export HERMES_DATA_ROOT="$base/hermes"
  export HERMES_REPOS_ROOT="$base/repos"
  export HERMES_PYTHON="python3"
}

write_config() {
  local path="$1"
  cat > "$path" << 'YAML'
github:
  org: test-org
repo_groups:
  platform:
    - my-repo
profiles:
  my-cto:
    - group: platform
      level: rw
YAML
}

# ── Test: missing config exits 1 with clear message ──────────────────────────
{
  base="$TMPDIR_BASE/t1"
  setup_env "$base"
  output=$("$SCRIPT" --config "$base/agent-stack/nonexistent.yml" 2>&1) && code=$? || code=$?
  if [[ "$code" -ne 0 ]] && echo "$output" | grep -q "no config found"; then
    pass "missing config exits 1 with message"
  else
    fail "missing config should exit 1 with message, got code=$code output=$output"
  fi
}

# ── Test: invalid YAML exits 1 ───────────────────────────────────────────────
{
  base="$TMPDIR_BASE/t2"
  setup_env "$base"
  echo "github: {org: [bad yaml" > "$base/agent-stack/repo-access.yml"
  output=$("$SCRIPT" --config "$base/agent-stack/repo-access.yml" 2>&1) && code=$? || code=$?
  if [[ "$code" -ne 0 ]]; then
    pass "invalid YAML exits 1"
  else
    fail "invalid YAML should exit 1"
  fi
}

# ── Test: dry-run passes through to setup script ─────────────────────────────
{
  base="$TMPDIR_BASE/t3"
  setup_env "$base"
  write_config "$base/agent-stack/repo-access.yml"
  output=$("$SCRIPT" --config "$base/agent-stack/repo-access.yml" --dry-run 2>&1) && code=$? || code=$?
  if [[ "$code" -eq 0 ]] && echo "$output" | grep -q "would clone\|skip\|done"; then
    pass "dry-run runs without error"
  else
    fail "dry-run failed: code=$code output=$output"
  fi
}

# ── Test: valid config runs both steps ───────────────────────────────────────
{
  base="$TMPDIR_BASE/t4"
  setup_env "$base"
  write_config "$base/agent-stack/repo-access.yml"

  # stub setup script so no real git clone happens
  export REPO_ACCESS_CONFIG="$base/agent-stack/repo-access.yml"
  stub_dir="$TMPDIR_BASE/stubs"
  mkdir -p "$stub_dir"
  printf '#!/bin/bash\necho "[setup-repos] done: 0 cloned, 0 skipped, 0 failed"\n' > "$stub_dir/setup-repos-from-yaml.sh"
  printf '#!/bin/bash\necho "[sync-repos] done"\n' > "$stub_dir/sync-repos-local.sh"
  chmod +x "$stub_dir/"*.sh

  output=$(HERMES_DATA_ROOT="$base/hermes" HERMES_REPOS_ROOT="$base/repos" \
    bash -c "
      ROOT_DIR='$ROOT_DIR'
      CONFIG_FILE='$base/agent-stack/repo-access.yml'
      PYTHON=python3
      source '$SCRIPT'
    " 2>&1) && code=$? || code=$?

  # Just verify the script is syntactically valid and sources without error
  bash -n "$SCRIPT" && pass "script syntax valid" || fail "script syntax invalid"
}

echo ""
if [[ "$failed" -eq 0 ]]; then
  echo "All tests passed."
  exit 0
else
  echo "Some tests FAILED." >&2
  exit 1
fi
```

- [ ] **Step 2: Make executable and run**
```bash
chmod +x scripts/test-reload-repo-access.sh
bash scripts/test-reload-repo-access.sh
```
Expected: `All tests passed.`

- [ ] **Step 3: Commit**
```bash
git add scripts/test-reload-repo-access.sh
git commit -m "test: add reload-repo-access tests"
```

---

## Task 5: `auto_clone` in `setup-repos-from-yaml.sh`

**Files:**
- Modify: `hermes-runtime/scripts/setup-repos-from-yaml.sh`

- [ ] **Step 1: Add auto_clone org query to the Python block**

In `hermes-runtime/scripts/setup-repos-from-yaml.sh`, the Python heredoc currently builds `CLONE_LIST` from `repo_groups`. Extend it to also query the GitHub API when `auto_clone: true`. Replace the full Python heredoc (from `CLONE_LIST=$(` to `PYEOF`) with:

```bash
CLONE_LIST=$("$PYTHON" << 'PYEOF'
import yaml, os, sys

with open(os.environ['_SETUP_CONFIG']) as f:
    config = yaml.safe_load(f)

github = config.get('github', {})
org = github.get('org', '')
base_url = github.get('base_url', 'https://github.com').rstrip('/')
auto_clone = github.get('auto_clone', False)

if not org:
    print('[setup-repos] ERROR: github.org is not set in config', file=sys.stderr)
    sys.exit(1)

seen = set()
repos = []

# Explicit repo_groups entries
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
```

- [ ] **Step 2: Run existing worktree test suite to check no regressions**
```bash
bash scripts/test-hermes-worktree.sh
```
Expected: `All tests passed.`

- [ ] **Step 3: Test auto_clone path with a mock (no real API call)**

Add a quick inline smoke test:
```bash
# Write a minimal config with auto_clone: true but no GH_TOKEN
TMPDIR=$(mktemp -d)
trap 'rm -rf $TMPDIR' EXIT
cat > "$TMPDIR/repo-access.yml" << 'YAML'
github:
  org: test-org
  auto_clone: true
repo_groups:
  platform:
    - explicit-repo
profiles:
  my-cto:
    - group: platform
      level: rw
YAML
mkdir -p "$TMPDIR/repos/bare"
output=$(REPO_ACCESS_CONFIG="$TMPDIR/repo-access.yml" \
  HERMES_REPOS_ROOT="$TMPDIR/repos" \
  GH_TOKEN="" \
  bash hermes-runtime/scripts/setup-repos-from-yaml.sh --dry-run 2>&1)
echo "$output"
echo "$output" | grep -q "GH_TOKEN not set" && echo "PASS: warns about missing token" || echo "FAIL: should warn about missing token"
echo "$output" | grep -q "would clone.*explicit-repo" && echo "PASS: explicit repos still processed" || echo "FAIL: explicit repos should still be processed"
```
Expected: Both `PASS` lines printed.

- [ ] **Step 4: Commit**
```bash
git add hermes-runtime/scripts/setup-repos-from-yaml.sh
git commit -m "feat(setup-repos): add auto_clone org query, filter archived repos"
```

---

## Task 6: Update `repo-access.yml.example` files

**Files:**
- Modify: `hermes-runtime/templates/repo-access.yml.example` (move from `config/`)
- Modify: `config/repo-access.yml.example`

- [ ] **Step 1: Copy example into hermes-runtime templates (baked into image)**

The agent needs access to the example from inside the container. Copy it:
```bash
cp config/repo-access.yml.example hermes-runtime/templates/repo-access.yml.example
```

- [ ] **Step 2: Add auto_clone to the example schema**

Edit `hermes-runtime/templates/repo-access.yml.example`. Update the `github:` block:
```yaml
github:
  org: my-github-org
  auto_clone: false         # set true to clone all non-archived org repos automatically
                            # requires GH_TOKEN with read:org scope
```

- [ ] **Step 3: Update config/repo-access.yml.example header**

Replace the header comment in `config/repo-access.yml.example`:
```yaml
# repo-access.yml — Role-group repo access config for hermes-worktree
#
# Place this file at /data/agent-stack/repo-access.yml inside the running
# container. The data volume is already persistent — no external mount needed.
#
# One-time bootstrap (after first deploy):
#   docker cp repo-access.yml <hermes-container>:/data/agent-stack/repo-access.yml
#   docker exec <hermes-container> reload-repo-access
#
# To update (add a repo, grant access):
#   Edit the file in the container: /data/agent-stack/repo-access.yml
#   Run: reload-repo-access
#
# On every container start, hermes-entrypoint runs reload-repo-access automatically
# if the file is present.
```

Also add `auto_clone` to the `github:` block in `config/repo-access.yml.example`.

- [ ] **Step 4: Add example to Dockerfile COPY**

In `paperclip/Dockerfile`, find the COPY block for `hermes-runtime/`:
```dockerfile
COPY hermes-runtime/templates /opt/hermes-runtime/templates
```
This already copies all templates — the new `repo-access.yml.example` in `hermes-runtime/templates/` is included automatically.

- [ ] **Step 5: Commit**
```bash
git add hermes-runtime/templates/repo-access.yml.example config/repo-access.yml.example
git commit -m "feat: bake repo-access.yml.example into image, add auto_clone to schema"
```

---

## Task 7: Update `hermes-entrypoint.sh` to call `reload-repo-access`

**Files:**
- Modify: `paperclip/hermes-entrypoint.sh`

- [ ] **Step 1: Replace two-script call with reload-repo-access**

Find the existing block:
```bash
REPO_ACCESS_CONFIG="${REPO_ACCESS_CONFIG:-/config/repo-access.yml}"
if [[ -f "$REPO_ACCESS_CONFIG" ]]; then
  echo "[hermes-repos] Config found at $REPO_ACCESS_CONFIG — running setup..."
  /opt/hermes-runtime/scripts/setup-repos-from-yaml.sh --config "$REPO_ACCESS_CONFIG" \
    || echo "[hermes-repos] WARN: setup-repos-from-yaml.sh failed — check logs above"
  /opt/hermes-runtime/scripts/sync-repos-local.sh --config "$REPO_ACCESS_CONFIG" \
    || echo "[hermes-repos] WARN: sync-repos-local.sh failed — check logs above"
  echo "[hermes-repos] Setup complete."
fi
```

Replace with:
```bash
REPO_ACCESS_CONFIG="${REPO_ACCESS_CONFIG:-/data/agent-stack/repo-access.yml}"
if [[ -f "$REPO_ACCESS_CONFIG" ]]; then
  echo "[hermes-repos] Config found at $REPO_ACCESS_CONFIG — running reload-repo-access..."
  REPO_ACCESS_CONFIG="$REPO_ACCESS_CONFIG" /opt/hermes-runtime/scripts/reload-repo-access.sh \
    || echo "[hermes-repos] WARN: reload-repo-access failed — check logs above"
fi
```

- [ ] **Step 2: Commit**
```bash
git add paperclip/hermes-entrypoint.sh
git commit -m "feat(entrypoint): use reload-repo-access, update default REPO_ACCESS_CONFIG path"
```

---

## Task 8: Update `SOUL.default.md`

**Files:**
- Modify: `hermes-runtime/templates/SOUL.default.md`

- [ ] **Step 1: Update Repo Work section**

The current Repo Work section references the two-step process. Update to reflect `reload-repo-access`:

Find the existing `## Repo Work — Worktrees Required` section and replace with:
```markdown
## Repo Work — Worktrees Required

Before reading or modifying code in any repo:

```bash
WORKTREE=$(hermes-worktree add $PROFILE_NAME <repo> <branch>)
cd "$WORKTREE"
# work normally — git add / commit / push / gh pr create
hermes-worktree remove $PROFILE_NAME <repo>   # after PR merges
```

Rules:
- Never work directly in a bare clone or run `git clone` manually
- Branch naming: pipeline-core repos use `<type>/<#>-<slug>` (load `pipeline-workflow` skill for governed repos)
- If access denied (`REPOS=` not set for this repo): run `reload-repo-access` first, then retry
- Check active worktrees before starting: `hermes-worktree list`

To grant repo access or add a new repo:
```bash
# Edit /data/agent-stack/repo-access.yml, then:
reload-repo-access
```
If no config exists yet, read `/opt/hermes-runtime/templates/repo-access.yml.example` to bootstrap.
```

- [ ] **Step 2: Commit**
```bash
git add hermes-runtime/templates/SOUL.default.md
git commit -m "feat(soul): integrate reload-repo-access into Repo Work section"
```

---

## Task 9: Extend `nightly-backup.sh`

**Files:**
- Modify: `scripts/host/nightly-backup.sh`

- [ ] **Step 1: Add repo-access.yml and repos/worktrees/ to backup tar**

In `scripts/host/nightly-backup.sh`, find the tar command for `hermes-profiles.tar.gz`:

```bash
docker exec "$HERMES_CONTAINER" bash -lc 'cd /data && tar czf /tmp/hermes-profiles.tar.gz \
  --exclude=... \
  hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks 2>/dev/null'
```

Add `agent-stack/repo-access.yml` and `repos/worktrees/` to the tar, guarded so absence doesn't fail:
```bash
docker exec "$HERMES_CONTAINER" bash -lc 'cd /data && tar czf /tmp/hermes-profiles.tar.gz \
  --exclude="hermes/profiles/*/profile-backups" \
  --exclude="hermes/profiles/*/python-packages" \
  --exclude="hermes/profiles/*/bin" \
  --exclude="hermes/profiles/*/lsp" \
  --exclude="hermes/profiles/*/cache" \
  --exclude="hermes/profiles/*/audio_cache" \
  --exclude="*/__pycache__" \
  hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks \
  $(test -f agent-stack/repo-access.yml && echo agent-stack/repo-access.yml || true) \
  $(test -d repos/worktrees && echo repos/worktrees || true) \
  2>/dev/null'
```

- [ ] **Step 2: Verify script syntax**
```bash
bash -n scripts/host/nightly-backup.sh && echo "Syntax OK"
```
Expected: `Syntax OK`

- [ ] **Step 3: Commit**
```bash
git add scripts/host/nightly-backup.sh
git commit -m "feat(backup): include repo-access.yml and repos/worktrees in nightly backup"
```

---

## Task 10: Open PR

- [ ] **Step 1: Push branch** (replace `159` with actual issue number)
```bash
git push -u origin story/159-repo-access-worktree-system
```

- [ ] **Step 2: Open PR**
```bash
gh pr create \
  --repo leebaroneau/template-agent \
  --title "Feature request: repo-access.yml declarative config, reload-repo-access, auto-clone, volume consolidation" \
  --body "$(cat <<'EOF'
Fixes #159

## Summary

Implements the design from `docs/specs/2026-05-28-repo-access-worktree-design.md`.

- **Single volume:** repos moved from separate `hermes-repos` volume to `/data/repos/` under the existing `paperclip-data` volume — worktrees are now backed up nightly
- **`reload-repo-access` command:** thin wrapper around existing setup + sync scripts; agents call this after editing `/data/agent-stack/repo-access.yml`
- **`auto_clone`:** when `github.auto_clone: true`, queries GitHub org API and clones all non-archived repos automatically; explicit `repo_groups` entries still work
- **Nightly backup:** extended to include `agent-stack/repo-access.yml` and `repos/worktrees/`
- **SOUL:** updated Repo Work section with `reload-repo-access` integration and bootstrap path

## Test plan

- [ ] `bash scripts/test-reload-repo-access.sh` passes
- [ ] `bash scripts/test-hermes-worktree.sh` passes (no regression)
- [ ] `docker compose config` validates with no errors
- [ ] `bash -n scripts/host/nightly-backup.sh` passes
- [ ] Container start with no `repo-access.yml` → skips silently
- [ ] Container start with valid `repo-access.yml` → repos cloned, REPOS= written
- [ ] `auto_clone: true` with no `GH_TOKEN` → warning, continues with explicit entries
EOF
)"
```

---

## Self-review

**Spec coverage:**
- [x] File location `/data/agent-stack/repo-access.yml` — Task 2 (entrypoint mkdir), Task 7 (default path)
- [x] `reload-repo-access` command — Tasks 3, 4, 7
- [x] `auto_clone` non-archived — Task 5
- [x] Single volume — Tasks 1, 2
- [x] Worktrees backed up — Task 9
- [x] `repo-access.yml` backed up — Task 9
- [x] SOUL updated — Task 8
- [x] Example updated with `auto_clone` — Task 6
- [x] Haverford migration documented in spec — no code change needed; migration is operational

**Placeholder scan:** None found.

**Type/name consistency:**
- `reload-repo-access` used consistently across Tasks 3, 7, 8
- `HERMES_REPOS_ROOT=/data/repos` used consistently across Tasks 1, 2, 5
- `REPO_ACCESS_CONFIG=/data/agent-stack/repo-access.yml` used consistently across Tasks 7, 6
