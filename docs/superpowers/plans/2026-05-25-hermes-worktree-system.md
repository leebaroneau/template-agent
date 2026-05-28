# Hermes Multi-Profile Git Worktree System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `hermes-worktree` binary and `git-worktree` agent-stack skill to the template-agent image so any Hermes profile can create isolated git worktrees for repo development, with per-profile access control stored in each profile's own `.env`.

**Architecture:** A shared `hermes-repos` Docker volume holds bare git clones (one per repo) and per-profile worktree directories created lazily on demand. The `hermes-worktree` shell binary enforces access via a `REPOS=` key in the profile's `.env`; `PROFILE_NAME=` (injected by `bootstrap-profiles.sh`) lets agents self-reference without hardcoding their name. A `git-worktree` agent-stack skill teaches all profiles the full `add → work → PR → remove` lifecycle automatically.

**Tech Stack:** bash, git worktrees, Docker named volumes, Hermes Agent profile system, template-agent image (`node:22-bookworm-slim` base)

**Spec:** `docs/specs/2026-05-25-hermes-worktree-system-design.md`

**Two phases:** Phase 1 = template-agent (Tasks 1–8). Phase 2 = agent-haverford rollout (Tasks 9–12).

---

## File map

### Phase 1 — template-agent

| Action | Path |
|--------|------|
| **Create** | `hermes-runtime/scripts/hermes-worktree.sh` |
| **Create** | `hermes-runtime/skills/git-worktree/SKILL.md` |
| **Create** | `scripts/test-hermes-worktree.sh` |
| **Modify** | `hermes-runtime/scripts/bootstrap-profiles.sh` |
| **Modify** | `paperclip/Dockerfile` |
| **Modify** | `compose.yaml` |

### Phase 2 — agent-haverford (lee-dashboard repo)

| Action | Path |
|--------|------|
| **Modify** | `haverford-brands/00_resources/scripts/setup-hermes-repos.sh` |
| **Delete** | `haverford-brands/00_resources/scripts/hermes-worktree.sh` |
| **Update** | `/root/hermes-env-snapshot.env` on the droplet (runtime, not committed) |

---

## Phase 1 — template-agent

---

### Task 1: Write `hermes-worktree.sh` (replaces the haverford-local draft)

This is a complete rewrite of the draft at `haverford-brands/00_resources/scripts/hermes-worktree.sh`.
Key changes from the draft: uses `HERMES_DATA_ROOT` + `HERMES_REPOS_ROOT` env vars for all
paths; adds `check_access()` that reads `REPOS=` from the profile's own `.env`; removes all
hardcoded `/opt/data` and `/opt/repos` paths.

**Files:**
- Create: `hermes-runtime/scripts/hermes-worktree.sh`

- [ ] **Step 1: Create the file**

```bash
cat > hermes-runtime/scripts/hermes-worktree.sh << 'EOF'
#!/usr/bin/env bash
# hermes-worktree — git worktree lifecycle tool for Hermes profiles.
#
# Baked into the template-agent image at /usr/local/bin/hermes-worktree.
# Runs inside the container as the container user (node in template-agent,
# hermes in agent-haverford custom builds).
#
# Commands:
#   add    <profile> <repo> <branch>   Create an isolated working tree
#   remove <profile> <repo>            Remove after PR is opened
#   list                               Show all active worktrees (all repos)
#   fetch  <repo>                      Fetch latest from upstream
#   sync   <repo>                      Fetch + rebase active worktrees
#
# Access control:
#   Each profile's .env must contain REPOS=repo1,repo2 for access to be granted.
#   Unset or empty REPOS= → all access denied.
#   This is tool-level enforcement (not OS-level); it governs autonomous LLM profiles.
#
# Self-reference:
#   Profiles should call: hermes-worktree add $PROFILE_NAME <repo> <branch>
#   PROFILE_NAME is injected into each profile's .env by bootstrap-profiles.sh.
#
# Environment:
#   HERMES_DATA_ROOT   Root of Hermes profile state  (default: /opt/data/hermes)
#   HERMES_REPOS_ROOT  Root of shared repos volume   (default: /opt/repos)

set -euo pipefail

HERMES_DATA_ROOT="${HERMES_DATA_ROOT:-/opt/data/hermes}"
HERMES_REPOS_ROOT="${HERMES_REPOS_ROOT:-/opt/repos}"
BARE_ROOT="$HERMES_REPOS_ROOT/bare"
WORKTREES_ROOT="$HERMES_REPOS_ROOT/worktrees"

# ── Helpers ──────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

# Returns the path to a profile's .env file.
# default profile lives at $HERMES_DATA_ROOT/.env (not profiles/default/.env).
get_profile_env() {
  local profile="$1"
  if [ "$profile" = "default" ]; then
    echo "${HERMES_DATA_ROOT}/.env"
  else
    echo "${HERMES_DATA_ROOT}/profiles/${profile}/.env"
  fi
}

# Reads REPOS= from the profile's .env. Returns empty string if not set.
get_allowed_repos() {
  local profile="$1"
  local env_file
  env_file=$(get_profile_env "$profile")
  if [ -f "$env_file" ]; then
    grep -E '^REPOS=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
  fi
}

# Exits with a clear error if the profile does not have access to the repo.
check_access() {
  local profile="$1"
  local repo="$2"
  local env_file
  env_file=$(get_profile_env "$profile")

  local allowed
  allowed=$(get_allowed_repos "$profile")

  if [ -z "$allowed" ]; then
    die "Profile '$profile' has no repo access. Add REPOS=$repo to $env_file"
  fi

  # Wrap in commas so partial matches (e.g. 'foo' matching 'foobar') don't pass.
  if ! echo ",$allowed," | grep -q ",$repo,"; then
    die "Profile '$profile' does not have access to '$repo'. Allowed: $allowed"
  fi
}

require_bare() {
  local repo="$1"
  local bare="$BARE_ROOT/${repo}.git"
  [ -d "$bare" ] || die "No bare clone for '$repo' at $bare. Run setup-hermes-repos.sh first."
  echo "$bare"
}

require_worktree() {
  local profile="$1" repo="$2"
  local wt="$WORKTREES_ROOT/$profile/$repo"
  [ -d "$wt" ] || die "No active worktree at $wt. Run: hermes-worktree add $profile $repo <branch>"
  echo "$wt"
}

# ── add ──────────────────────────────────────────────────────────────────────
cmd_add() {
  local profile="${1:-}" repo="${2:-}" branch="${3:-}"
  [ -n "$profile" ] && [ -n "$repo" ] && [ -n "$branch" ] \
    || die "Usage: hermes-worktree add <profile> <repo> <branch>"

  # Enforce access before touching the filesystem.
  check_access "$profile" "$repo"

  # Block protected base branches.
  case "$branch" in
    main|master|develop|HEAD)
      die "Cannot create a worktree on '$branch' — use a feature branch (e.g. feature/my-task or fix/my-bug)"
      ;;
  esac

  local bare
  bare=$(require_bare "$repo")
  local wt="$WORKTREES_ROOT/$profile/$repo"

  if [ -d "$wt" ]; then
    local existing_branch
    existing_branch=$(git -C "$wt" branch --show-current 2>/dev/null || echo "detached")
    if [ "$existing_branch" = "$branch" ]; then
      echo "Worktree already exists at $wt (on $branch). Reusing." >&2
      echo "$wt"
      return 0
    else
      die "Worktree at $wt is already on branch '$existing_branch'. Remove it first: hermes-worktree remove $profile $repo"
    fi
  fi

  mkdir -p "$WORKTREES_ROOT/$profile"

  echo "Fetching latest from origin for $repo..." >&2
  git -C "$bare" fetch --all --prune --quiet

  local base_branch
  if git -C "$bare" show-ref --verify --quiet refs/remotes/origin/main 2>/dev/null; then
    base_branch="origin/main"
  elif git -C "$bare" show-ref --verify --quiet refs/remotes/origin/master 2>/dev/null; then
    base_branch="origin/master"
  else
    base_branch=$(git -C "$bare" symbolic-ref --short HEAD)
    echo "Warning: no origin/main or origin/master found, branching from $base_branch" >&2
  fi

  if git -C "$bare" show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
    echo "Branch '$branch' already exists in bare clone. Creating worktree from it." >&2
    git -C "$bare" worktree add "$wt" "$branch"
  else
    echo "Creating branch '$branch' from $base_branch..." >&2
    git -C "$bare" worktree add -b "$branch" "$wt" "$base_branch"
  fi

  git -C "$wt" remote set-url origin "$(git -C "$bare" remote get-url origin)" 2>/dev/null || true

  echo "Worktree ready: $wt (branch: $branch)" >&2
  # Print path on stdout — callers capture this.
  echo "$wt"
}

# ── remove ───────────────────────────────────────────────────────────────────
cmd_remove() {
  local profile="${1:-}" repo="${2:-}"
  [ -n "$profile" ] && [ -n "$repo" ] \
    || die "Usage: hermes-worktree remove <profile> <repo>"

  local bare
  bare=$(require_bare "$repo")
  local wt
  wt=$(require_worktree "$profile" "$repo")

  local branch
  branch=$(git -C "$wt" branch --show-current 2>/dev/null || echo "detached")

  echo "Removing worktree $wt (branch: $branch)..."
  git -C "$bare" worktree remove --force "$wt"
  echo "Worktree removed. Branch '$branch' still exists in bare clone (PR may still be open)."
  echo "To delete the branch after merge: git -C $bare branch -d $branch"
}

# ── list ─────────────────────────────────────────────────────────────────────
cmd_list() {
  echo "Active worktrees across all repos:"
  echo
  local found=0
  for bare_dir in "$BARE_ROOT"/*.git; do
    [ -d "$bare_dir" ] || continue
    local repo_name
    repo_name=$(basename "$bare_dir" .git)
    local worktrees
    # Skip the first line (the bare clone itself)
    worktrees=$(git -C "$bare_dir" worktree list 2>/dev/null | tail -n +2 || true)
    if [ -n "$worktrees" ]; then
      echo "  $repo_name:"
      echo "$worktrees" | while IFS= read -r line; do
        echo "    $line"
      done
      found=1
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "  (no active worktrees)"
  fi
}

# ── fetch ────────────────────────────────────────────────────────────────────
cmd_fetch() {
  local repo="${1:-}"
  [ -n "$repo" ] || die "Usage: hermes-worktree fetch <repo>"
  local bare
  bare=$(require_bare "$repo")
  echo "Fetching $repo..."
  git -C "$bare" fetch --all --prune
  echo "Done."
}

# ── sync ─────────────────────────────────────────────────────────────────────
cmd_sync() {
  local repo="${1:-}"
  [ -n "$repo" ] || die "Usage: hermes-worktree sync <repo>"
  local bare
  bare=$(require_bare "$repo")

  echo "Fetching $repo..."
  git -C "$bare" fetch --all --prune

  echo "Rebasing active worktrees onto latest upstream..."
  git -C "$bare" worktree list --porcelain \
    | grep "^worktree " \
    | awk '{print $2}' \
    | tail -n +2 \
    | while IFS= read -r wt; do
        [ -d "$wt" ] || continue
        local branch
        branch=$(git -C "$wt" branch --show-current 2>/dev/null || echo "")
        [ -z "$branch" ] && continue
        echo "  Rebasing $wt ($branch)..."
        git -C "$wt" rebase "origin/main" 2>/dev/null \
          || git -C "$wt" rebase "origin/master" 2>/dev/null \
          || echo "    Warning: rebase failed for $branch — manual intervention needed"
      done
  echo "Sync complete."
}

# ── dispatch ─────────────────────────────────────────────────────────────────
CMD="${1:-}"
shift || true

case "$CMD" in
  add)    cmd_add "$@" ;;
  remove) cmd_remove "$@" ;;
  list)   cmd_list ;;
  fetch)  cmd_fetch "$@" ;;
  sync)   cmd_sync "$@" ;;
  *)
    cat >&2 << 'USAGE'
hermes-worktree — git worktree lifecycle for Hermes profiles

Commands:
  add    <profile> <repo> <branch>  Create an isolated working tree
  remove <profile> <repo>           Remove after PR is opened
  list                              Show all active worktrees
  fetch  <repo>                     Fetch latest from upstream
  sync   <repo>                     Fetch + rebase active worktrees

Env vars:
  HERMES_DATA_ROOT   Profile state root  (default: /opt/data/hermes)
  HERMES_REPOS_ROOT  Repos volume root   (default: /opt/repos)

Examples:
  hermes-worktree add $PROFILE_NAME haverford-dev-api feature/fix-auth
  hermes-worktree list
  hermes-worktree remove $PROFILE_NAME haverford-dev-api
USAGE
    exit 1
    ;;
esac
EOF
chmod +x hermes-runtime/scripts/hermes-worktree.sh
```

- [ ] **Step 2: Verify the script is valid bash**

```bash
bash -n hermes-runtime/scripts/hermes-worktree.sh && echo "Syntax OK"
```
Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add hermes-runtime/scripts/hermes-worktree.sh
git commit -m "feat: add hermes-worktree shell tool"
```

---

### Task 2: Write and run tests for `hermes-worktree.sh`

Tests run entirely in a temp directory using a real git bare repo — no Docker required.

**Files:**
- Create: `scripts/test-hermes-worktree.sh`

- [ ] **Step 1: Write the test file**

```bash
cat > scripts/test-hermes-worktree.sh << 'EOF'
#!/usr/bin/env bash
# Tests for hermes-runtime/scripts/hermes-worktree.sh
# Uses a temp git bare repo — no Docker required.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/hermes-runtime/scripts/hermes-worktree.sh"
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

failed=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1" >&2; failed=1; }

# ── Fixture: minimal git environment ────────────────────────────────────────
setup_env() {
  local base="$1"
  # Bare clone (source of truth)
  mkdir -p "$base/repos/bare"
  git init --bare "$base/repos/bare/myrepo.git" --initial-branch=main >/dev/null 2>&1 \
    || git init --bare "$base/repos/bare/myrepo.git" >/dev/null 2>&1

  # Seed it with one commit so worktrees can branch from HEAD
  local seed="$base/seed"
  git clone "$base/repos/bare/myrepo.git" "$seed" --quiet 2>/dev/null || true
  mkdir -p "$seed"
  git -C "$seed" config user.email "test@test.com" 2>/dev/null || true
  git -C "$seed" config user.name "Test" 2>/dev/null || true
  touch "$seed/README.md"
  git -C "$seed" add . 2>/dev/null || true
  git -C "$seed" commit -m "init" --quiet 2>/dev/null || true
  git -C "$seed" push origin HEAD:main --quiet 2>/dev/null || true

  # Profile state dir mimicking HERMES_DATA_ROOT
  mkdir -p "$base/hermes/profiles/coder"
  echo "PROFILE_NAME=coder" > "$base/hermes/profiles/coder/.env"
  echo "REPOS=myrepo"       >> "$base/hermes/profiles/coder/.env"

  # default profile (no profiles/ subdir)
  echo "PROFILE_NAME=default" > "$base/hermes/.env"
  # default has no REPOS= intentionally for denial test

  # Worktrees dir
  mkdir -p "$base/repos/worktrees"

  export HERMES_DATA_ROOT="$base/hermes"
  export HERMES_REPOS_ROOT="$base/repos"
}

# ── Test: access denied when REPOS= not set ──────────────────────────────────
echo "Test: access denied when REPOS= unset"
E="$(mktemp -d "$TMPDIR_BASE/t1.XXXX")"
setup_env "$E"
if "$SCRIPT" add default myrepo feature/x 2>&1 | grep -q "no repo access"; then
  pass "access denied for default (no REPOS=)"
else
  fail "expected denial for default profile without REPOS="
fi

# ── Test: access denied when repo not in list ────────────────────────────────
echo "Test: access denied when repo not in allowlist"
E="$(mktemp -d "$TMPDIR_BASE/t2.XXXX")"
setup_env "$E"
if "$SCRIPT" add coder otherrepo feature/x 2>&1 | grep -q "does not have access"; then
  pass "access denied for repo not in list"
else
  fail "expected denial for repo not in coder's REPOS="
fi

# ── Test: add creates worktree at correct path ───────────────────────────────
echo "Test: add creates worktree"
E="$(mktemp -d "$TMPDIR_BASE/t3.XXXX")"
setup_env "$E"
WT=$("$SCRIPT" add coder myrepo feature/test-branch 2>/dev/null)
if [ -d "$WT" ] && [ "$WT" = "$E/repos/worktrees/coder/myrepo" ]; then
  pass "worktree created at expected path"
else
  fail "worktree not at expected path (got: $WT)"
fi

# ── Test: add is idempotent on same branch ───────────────────────────────────
echo "Test: add is idempotent (same branch)"
E="$(mktemp -d "$TMPDIR_BASE/t4.XXXX")"
setup_env "$E"
"$SCRIPT" add coder myrepo feature/idem 2>/dev/null
WT2=$("$SCRIPT" add coder myrepo feature/idem 2>/dev/null)
if [ -d "$WT2" ]; then
  pass "second add on same branch reuses worktree"
else
  fail "idempotent add failed"
fi

# ── Test: add blocks protected branch names ──────────────────────────────────
echo "Test: protected branch names blocked"
E="$(mktemp -d "$TMPDIR_BASE/t5.XXXX")"
setup_env "$E"
for b in main master develop HEAD; do
  if "$SCRIPT" add coder myrepo "$b" 2>&1 | grep -q "Cannot create a worktree on"; then
    pass "protected branch '$b' blocked"
  else
    fail "protected branch '$b' was not blocked"
  fi
done

# ── Test: remove cleans up worktree ─────────────────────────────────────────
echo "Test: remove cleans up worktree"
E="$(mktemp -d "$TMPDIR_BASE/t6.XXXX")"
setup_env "$E"
"$SCRIPT" add coder myrepo feature/remove-test 2>/dev/null
"$SCRIPT" remove coder myrepo 2>/dev/null
if [ ! -d "$E/repos/worktrees/coder/myrepo" ]; then
  pass "worktree directory removed"
else
  fail "worktree directory still exists after remove"
fi

# ── Test: list shows active worktrees ────────────────────────────────────────
echo "Test: list shows active worktrees"
E="$(mktemp -d "$TMPDIR_BASE/t7.XXXX")"
setup_env "$E"
"$SCRIPT" add coder myrepo feature/list-test 2>/dev/null
LIST=$("$SCRIPT" list 2>/dev/null)
if echo "$LIST" | grep -q "myrepo"; then
  pass "list shows active worktree"
else
  fail "list did not show active worktree"
fi

# ── Results ──────────────────────────────────────────────────────────────────
echo
if [ "$failed" -ne 0 ]; then
  echo "FAILED"
  exit 1
fi
echo "All hermes-worktree tests passed."
EOF
chmod +x scripts/test-hermes-worktree.sh
```

- [ ] **Step 2: Run the tests**

```bash
bash scripts/test-hermes-worktree.sh
```

Expected output:
```
Test: access denied when REPOS= unset
  PASS: access denied for default (no REPOS=)
Test: access denied when repo not in allowlist
  PASS: access denied for repo not in list
Test: add creates worktree
  PASS: worktree created at expected path
Test: add is idempotent (same branch)
  PASS: second add on same branch reuses worktree
Test: protected branch names blocked
  PASS: protected branch 'main' blocked
  PASS: protected branch 'master' blocked
  PASS: protected branch 'develop' blocked
  PASS: protected branch 'HEAD' blocked
Test: remove cleans up worktree
  PASS: worktree directory removed
Test: list shows active worktrees
  PASS: list shows active worktree

All hermes-worktree tests passed.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/test-hermes-worktree.sh
git commit -m "test: hermes-worktree access control and lifecycle"
```

---

### Task 3: Extend `bootstrap-profiles.sh` — inject `PROFILE_NAME`

One insertion after the existing `write_env_file` call in the per-profile loop.

**Files:**
- Modify: `hermes-runtime/scripts/bootstrap-profiles.sh:275` (after `write_env_file "$profile_home/.env"`)

- [ ] **Step 1: Add `PROFILE_NAME` injection after `write_env_file`**

Find the line `write_env_file "$profile_home/.env"` in the per-profile loop and add the block immediately after it:

```bash
# In the loop body, after:   write_env_file "$profile_home/.env"
# Add:
  if ! grep -q "^PROFILE_NAME=" "$profile_home/.env" 2>/dev/null; then
    echo "PROFILE_NAME=$profile" >> "$profile_home/.env"
  fi
```

The diff in context (around line 275):

```bash
  write_env_file "$profile_home/.env"

  # Inject PROFILE_NAME so the profile can self-reference without hardcoding its name.
  # Idempotent — only appends if the key is absent.
  if ! grep -q "^PROFILE_NAME=" "$profile_home/.env" 2>/dev/null; then
    echo "PROFILE_NAME=$profile" >> "$profile_home/.env"
  fi

  install_gbrain_skills "$profile_home"
```

- [ ] **Step 2: Verify the script is valid bash**

```bash
bash -n hermes-runtime/scripts/bootstrap-profiles.sh && echo "Syntax OK"
```
Expected: `Syntax OK`

- [ ] **Step 3: Run the existing bootstrap tests to confirm nothing broke**

```bash
bash scripts/test-default-profile-only.sh
bash scripts/test-bootstrap-overlays.sh
```

Both should exit 0.

- [ ] **Step 4: Write a targeted PROFILE_NAME test**

Append to `scripts/test-hermes-worktree.sh` — add a standalone function test that calls bootstrap directly:

```bash
cat >> scripts/test-hermes-worktree.sh << 'EOF'

# ── Test: bootstrap-profiles.sh injects PROFILE_NAME ─────────────────────────
echo "Test: bootstrap injects PROFILE_NAME"
BOOTSTRAP_ROOT="$(mktemp -d "$TMPDIR_BASE/bs.XXXX")"
export HERMES_DATA_ROOT="$BOOTSTRAP_ROOT/hermes"
export GBRAIN_DATA_ROOT="$BOOTSTRAP_ROOT/gbrain"
export HERMES_PROFILES="default,devtest"
export TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hermes-runtime/templates"
# bootstrap needs gbrain binary — skip gbrain init by providing a stub
export PATH="$BOOTSTRAP_ROOT/bin:$PATH"
mkdir -p "$BOOTSTRAP_ROOT/bin"
echo '#!/usr/bin/env bash' > "$BOOTSTRAP_ROOT/bin/gbrain"
echo 'exit 0' >> "$BOOTSTRAP_ROOT/bin/gbrain"
chmod +x "$BOOTSTRAP_ROOT/bin/gbrain"

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hermes-runtime/scripts/bootstrap-profiles.sh" 2>/dev/null || true

for p in default devtest; do
  if [ "$p" = "default" ]; then
    env_file="$HERMES_DATA_ROOT/.env"
  else
    env_file="$HERMES_DATA_ROOT/profiles/$p/.env"
  fi
  if grep -q "^PROFILE_NAME=$p" "$env_file" 2>/dev/null; then
    pass "PROFILE_NAME=$p injected for '$p' profile"
  else
    fail "PROFILE_NAME not found in $env_file"
  fi
done
EOF
```

- [ ] **Step 5: Run the updated test**

```bash
bash scripts/test-hermes-worktree.sh
```

Expected: all tests pass including the new bootstrap test.

- [ ] **Step 6: Commit**

```bash
git add hermes-runtime/scripts/bootstrap-profiles.sh scripts/test-hermes-worktree.sh
git commit -m "feat: bootstrap-profiles injects PROFILE_NAME into each profile .env"
```

---

### Task 4: Add the `git-worktree` agent-stack skill

**Files:**
- Create: `hermes-runtime/skills/git-worktree/SKILL.md`

- [ ] **Step 1: Create the skill**

```bash
mkdir -p hermes-runtime/skills/git-worktree
cat > hermes-runtime/skills/git-worktree/SKILL.md << 'EOF'
# git-worktree skill

Use this skill any time you need to read or modify code in a GitHub repo.

## When to use

- Before writing or editing any code in a repo
- Before running repo-specific tests or commands
- When asked to investigate, fix, or add something in a codebase

## Your profile name

Your profile name is available as `$PROFILE_NAME` in your environment.
Always pass it as the first argument to `hermes-worktree`. Never hardcode it.

## Full lifecycle

### 1. Start a task — create a worktree

```bash
# Check your access first
hermes-worktree list

# Create the worktree — prints the path on stdout
WORKTREE=$(hermes-worktree add $PROFILE_NAME <repo> <branch>)
cd "$WORKTREE"
```

### 2. Name your branch correctly

Generic defaults:
- `feature/<short-description>` — new functionality
- `fix/<short-description>` — bug fix
- `task/<short-description>` — chore or refactor
- `spike/<short-description>` — investigation

**Pipeline-core governed repos** (any repo with `.github/pipeline-config.yml`):
Branch names MUST include the GitHub issue number: `<type>/<issue-number>-<slug>`
Example: `feature/42-add-rate-limiting`
You must open the GitHub issue BEFORE creating the branch. Check `AGENTS.md` in
the repo for the exact convention before naming anything.

### 3. Do the work

Work normally in the worktree — it is a standard git checkout.
`git status`, `git add`, `git commit`, `git push` all work as expected.

### 4. Open the PR

```bash
# Push your branch
git push origin <branch>

# Open the PR with gh CLI — always use Fixes #<issue> for pipeline-core repos
gh pr create --title "<title>" --body "Fixes #<issue-number>"
```

### 5. Clean up — remove the worktree

```bash
hermes-worktree remove $PROFILE_NAME <repo>
```

The branch continues to exist in the bare clone until the PR merges.
Remove it after merge: `git -C /opt/repos/bare/<repo>.git branch -d <branch>`

## If access is denied

```
ERROR: Profile 'coder' has no repo access. Add REPOS=<repo> to .../.env
```

Stop immediately. Report the exact error message to the user.
Do not attempt to work around the restriction. The user must grant access.

## Checking what's active

```bash
hermes-worktree list
```

Shows all profiles' active worktrees across all repos. Use this before starting
work to see if another profile is already on a branch in the same repo.

## Never

- Do not use `hermes -w` for multi-profile shared repo work (no access governance)
- Do not create a worktree on `main`, `master`, `develop`, or `HEAD`
- Do not leave worktrees open after the PR is merged
- Do not skip the `hermes-worktree add` step and work directly in the bare clone
EOF
```

- [ ] **Step 2: Verify the skill is picked up by the bootstrap skill-install pattern**

The file must live in `hermes-runtime/skills/<name>/SKILL.md`. Confirm:

```bash
ls hermes-runtime/skills/git-worktree/SKILL.md
# → hermes-runtime/skills/git-worktree/SKILL.md
```

- [ ] **Step 3: Commit**

```bash
git add hermes-runtime/skills/git-worktree/SKILL.md
git commit -m "feat: add git-worktree agent-stack skill"
```

---

### Task 5: Update `paperclip/Dockerfile`

Two additions to the final `RUN` block: symlink the script onto `PATH` and create the
`/opt/repos` directory structure so the mount point exists even before the volume is attached.

**Files:**
- Modify: `paperclip/Dockerfile:98-106`

- [ ] **Step 1: Add symlink and mkdir to the final RUN block**

Find the final `RUN` block (starts with `RUN mkdir -p /data /opt/work`). Add two lines
inside it, after the `chmod +x /opt/hermes-runtime/scripts/*.sh` line:

```dockerfile
RUN mkdir -p /data /opt/work \
  && rm -rf /opt/hermes-bootstrap /root/.hermes /data/* /data/.[!.]* /data/..?* /tmp/* \
  && rm -f /usr/local/bin/bun \
  && cp /root/.bun/bin/bun /usr/local/bin/bun \
  && chown -R node:node /data /opt/work \
  && chmod +x /opt/hermes-runtime/scripts/*.sh \
  && ln -sf /opt/hermes-runtime/scripts/hermes-worktree.sh /usr/local/bin/hermes-worktree \
  && mkdir -p /opt/repos/bare /opt/repos/worktrees \
  && chmod +x /usr/local/bin/bun \
  && chmod +x /opt/paperclip/entrypoint.sh /opt/paperclip/hermes-entrypoint.sh /opt/paperclip/pre-deploy-backup.sh
```

(Only the two `&& ln -sf ...` and `&& mkdir -p /opt/repos...` lines are new.)

- [ ] **Step 2: Verify Dockerfile syntax by linting**

```bash
docker run --rm -i hadolint/hadolint < paperclip/Dockerfile 2>&1 | grep -v "^$" | head -20 || true
# Ignore DL3008 (pin apt versions) — it's pre-existing. No new warnings expected.
```

- [ ] **Step 3: Commit**

```bash
git add paperclip/Dockerfile
git commit -m "feat: symlink hermes-worktree onto PATH in image"
```

---

### Task 6: Update `compose.yaml`

Add the `hermes-repos` volume and two new env vars to the `hermes` service.

**Files:**
- Modify: `compose.yaml`

- [ ] **Step 1: Add `hermes-repos` to the top-level `volumes:` block**

Find:
```yaml
volumes:
  paperclip-data:
```

Replace with:
```yaml
volumes:
  paperclip-data:
  hermes-repos:
```

- [ ] **Step 2: Add env vars and volume mount to the `hermes` service**

In the `hermes:` service `environment:` block, add after `HERMES_GATEWAY_PROFILES`:
```yaml
      HERMES_REPOS_ROOT: /opt/repos
      HERMES_REPOS: ${HERMES_REPOS:-}
```

In the `hermes:` service `volumes:` block, add:
```yaml
      - hermes-repos:/opt/repos
```

- [ ] **Step 3: Verify compose config is valid**

```bash
docker compose --env-file .env.example config --services
```

Expected output (two lines):
```
paperclip
hermes
```

No errors.

- [ ] **Step 4: Run the default-profile-only test to confirm no regression**

```bash
bash scripts/test-default-profile-only.sh
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add compose.yaml
git commit -m "feat: add hermes-repos volume to compose.yaml"
```

---

### Task 7: Run full test suite and build smoke-check

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass. The suite includes `test-default-profile-only.sh`,
`test-bootstrap-overlays.sh`, `test-hermes-worktree.sh`, `template-identity.test.mjs`,
and others listed in `package.json`.

- [ ] **Step 2: Build the image locally**

```bash
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.example build
```

Expected: build completes without error.

- [ ] **Step 3: Verify binary is on PATH in the built image**

```bash
docker run --rm --entrypoint which \
  "${TEMPLATE_AGENT_IMAGE:-template-agent:local}" hermes-worktree
```

Expected: `/usr/local/bin/hermes-worktree`

- [ ] **Step 4: Verify `/opt/repos` structure exists in the image**

```bash
docker run --rm --entrypoint ls \
  "${TEMPLATE_AGENT_IMAGE:-template-agent:local}" /opt/repos
```

Expected: `bare  worktrees`

- [ ] **Step 5: Run the blank-image audit**

```bash
bash scripts/audit-blank-image.sh "${TEMPLATE_AGENT_IMAGE:-template-agent:local}"
```

Expected: exits 0. No new warnings beyond pre-existing ones.

- [ ] **Step 6: Final commit and push**

```bash
git add -A
git status  # confirm nothing unstaged
git log --oneline -6  # review the task commits
```

---

### Task 8: Open PR for template-agent Phase 1

**Files:** none (GitHub action)

- [ ] **Step 1: Create GitHub issue**

```bash
gh issue create \
  --repo leebaroneau/template-agent \
  --title "Feature request: hermes-worktree multi-profile git worktree system" \
  --label "type:feature" \
  --body "Adds hermes-worktree binary, git-worktree agent-stack skill, and per-profile REPOS= access control. Spec: docs/specs/2026-05-25-hermes-worktree-system-design.md"
```

Note the issue number from the output (e.g. `#42`).

- [ ] **Step 2: Confirm branch name matches pipeline-core convention**

Branch must be `feature/<issue-number>-hermes-worktree-system`.
If you are not already on this branch:
```bash
git checkout -b feature/<issue-number>-hermes-worktree-system
git push -u origin feature/<issue-number>-hermes-worktree-system
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create \
  --repo leebaroneau/template-agent \
  --title "Feature request: hermes-worktree multi-profile git worktree system" \
  --body "Fixes #<issue-number>

## What
- Adds \`hermes-worktree\` shell binary baked into image at \`/usr/local/bin/hermes-worktree\`
- Adds \`git-worktree\` agent-stack skill (auto-symlinked to all profiles by bootstrap)
- Extends \`bootstrap-profiles.sh\` to inject \`PROFILE_NAME=\` into each profile .env
- Adds \`hermes-repos\` volume to \`compose.yaml\` + \`HERMES_REPOS_ROOT\` env var
- Adds \`/opt/repos/bare\` + \`/opt/repos/worktrees\` dirs to image layer

## Tests
- \`scripts/test-hermes-worktree.sh\` — 9 cases covering access control, add, remove, list, idempotency

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Phase 2 — agent-haverford

> **Pre-condition:** template-agent Phase 1 PR is merged and `:latest` is published.

---

### Task 9: Update `setup-hermes-repos.sh`

Replace the hardcoded `PROFILES` array with one read from `HERMES_PROFILES` env,
add `PROFILE_NAME` injection into each profile's `.env`, and fix the user ownership
to use the `hermes` user uid (10000) which is correct for agent-haverford's custom image.

**Files:**
- Modify: `haverford-brands/00_resources/scripts/setup-hermes-repos.sh`

- [ ] **Step 1: Replace hardcoded PROFILES array with env-driven one**

Find and replace:
```bash
# Profiles to pre-create worktree directories for.
PROFILES=(default planner coder reviewer)
```

With:
```bash
# Profiles come from the same env var that drives bootstrap-profiles.sh.
# Reads from the env file so it stays in sync without a manual update.
IFS=',' read -ra PROFILES <<< "$(grep -E '^HERMES_PROFILES=' "$ENV_FILE" \
  | cut -d= -f2- | tr -d '"' | tr -d "'" || echo 'default')"
```

- [ ] **Step 2: Verify the docker run block still only mounts the repos volume**

`PROFILE_NAME` injection is handled by `bootstrap-profiles.sh` (Task 3) on every
container start — no changes needed to the `docker run` block inside the heredoc.
The setup script only needs the repos volume mounted, which is already the case.

Confirm the existing docker run line remains:
```bash
docker run --rm \
  -v "$REPOS_VOLUME:/opt/repos:rw" \
  -e "GITHUB_TOKEN=$GITHUB_TOKEN" \
  -e "REPOS=${REPOS[*]}" \
  -e "PROFILES=${PROFILES[*]}" \
  --entrypoint bash \
  "$IMAGE" \
```

- [ ] **Step 3: Verify the script is valid bash**

```bash
bash -n haverford-brands/00_resources/scripts/setup-hermes-repos.sh && echo "Syntax OK"
```

- [ ] **Step 4: Commit**

```bash
git add haverford-brands/00_resources/scripts/setup-hermes-repos.sh
git commit -m "feat(haverford): setup-hermes-repos reads HERMES_PROFILES, injects PROFILE_NAME"
```

---

### Task 10: Remove local `hermes-worktree.sh` from haverford-brands

The binary now lives in the image. The local copy is dead weight.

**Files:**
- Delete: `haverford-brands/00_resources/scripts/hermes-worktree.sh`

- [ ] **Step 1: Delete the file**

```bash
git rm haverford-brands/00_resources/scripts/hermes-worktree.sh
```

- [ ] **Step 2: Confirm no other scripts reference the local path**

```bash
grep -r "hermes-worktree.sh" haverford-brands/ --include="*.sh" --include="*.md" | grep -v ".git"
```

Expected: no output (the file is gone and nothing else referenced it by path).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(haverford): remove local hermes-worktree.sh — now in template-agent image"
```

---

### Task 11: Update droplet env and redeploy

These steps run **on the droplet** (`ssh haverford-droplet`), not locally.

**Files:**
- Runtime: `/root/hermes-env-snapshot.env` on the droplet

- [ ] **Step 1: Add `HERMES_REPOS` and `HERMES_REPOS_ROOT` to the env file**

```bash
ssh haverford-droplet << 'EOF'
# Append new vars (only if not already present)
grep -q '^HERMES_REPOS=' /root/hermes-env-snapshot.env || \
  echo 'HERMES_REPOS=leebaroneau/pipeline-core,Haverford-Brands/agent-haverford,Haverford-Brands/haverford-dev-api,leebaroneau/template-agent' \
  >> /root/hermes-env-snapshot.env

grep -q '^HERMES_REPOS_ROOT=' /root/hermes-env-snapshot.env || \
  echo 'HERMES_REPOS_ROOT=/opt/repos' \
  >> /root/hermes-env-snapshot.env

echo "Env updated:"
grep -E '^HERMES_REPOS' /root/hermes-env-snapshot.env
EOF
```

- [ ] **Step 2: Pull the updated image (built from new template-agent:latest)**

```bash
ssh haverford-droplet 'docker pull hermes-droplet:rebuilt-cron || echo "pull failed — may need manual rebuild"'
```

If the image needs a manual rebuild (agent-haverford builds from template-agent), trigger
the agent-haverford CI build first, then pull.

- [ ] **Step 3: Restart the container**

```bash
ssh haverford-droplet '/root/start-hermes-droplet.sh'
```

Expected output includes:
```
Creating repos volume 'hermes-repos' (first run)...   ← only on first run
Started hermes from hermes-droplet:rebuilt-cron.
  State volume:  tate66... -> /opt/data
  Repos volume:  hermes-repos -> /opt/repos
```

- [ ] **Step 4: Commit the lee-dashboard changes**

```bash
git add haverford-brands/00_resources/scripts/
git commit -m "chore(haverford): phase 2 hermes-worktree rollout — env vars, removed local script"
```

---

### Task 12: Run `setup-hermes-repos.sh` and verify end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Run setup-hermes-repos.sh on the droplet**

```bash
ssh haverford-droplet 'bash /path/to/setup-hermes-repos.sh'
```

Or copy and run locally (it uses `docker` to reach the volume):

```bash
cd haverford-brands/00_resources/scripts
HERMES_ENV_FILE=/root/hermes-env-snapshot.env bash setup-hermes-repos.sh
```

Expected: bare clones created, PROFILE_NAME injected into existing profile `.env` files.

- [ ] **Step 2: Verify binary is on PATH**

```bash
ssh haverford-droplet 'docker exec -u hermes hermes which hermes-worktree'
```
Expected: `/usr/local/bin/hermes-worktree`

- [ ] **Step 3: Verify PROFILE_NAME in default profile**

```bash
ssh haverford-droplet 'docker exec -u hermes hermes grep PROFILE_NAME /opt/data/hermes/.env'
```
Expected: `PROFILE_NAME=default`

- [ ] **Step 4: Verify bare clones present**

```bash
ssh haverford-droplet 'docker exec -u hermes hermes ls /opt/repos/bare/'
```
Expected: `haverford-dev-api.git  pipeline-core.git  template-agent.git  ...`

- [ ] **Step 5: Test access denial**

```bash
ssh haverford-droplet 'docker exec -u hermes hermes hermes-worktree add default test-nonexistent feature/x'
```
Expected:
```
ERROR: Profile 'default' has no repo access. Add REPOS=test-nonexistent to /opt/data/hermes/.env
```

- [ ] **Step 6: Grant access and create a real worktree**

```bash
ssh haverford-droplet << 'EOF'
# Grant default profile access to haverford-dev-api
docker exec -u hermes hermes bash -c \
  "echo 'REPOS=haverford-dev-api' >> /opt/data/hermes/.env"

# Create a worktree
docker exec -u hermes hermes \
  hermes-worktree add default haverford-dev-api feature/verify-setup

# List it
docker exec -u hermes hermes hermes-worktree list

# Clean up
docker exec -u hermes hermes hermes-worktree remove default haverford-dev-api

# Remove the REPOS line we added (leave env clean)
docker exec -u hermes hermes bash -c \
  "sed -i '/^REPOS=haverford-dev-api$/d' /opt/data/hermes/.env"
EOF
```

Expected mid-output:
```
Worktree ready: /opt/repos/worktrees/default/haverford-dev-api (branch: feature/verify-setup)
Active worktrees across all repos:
  haverford-dev-api:
    /opt/repos/worktrees/default/haverford-dev-api   [feature/verify-setup]
Worktree removed. Branch 'feature/verify-setup' still exists in bare clone...
```

- [ ] **Step 7: Verify git-worktree skill is symlinked into default profile**

```bash
ssh haverford-droplet 'docker exec -u hermes hermes ls /opt/data/hermes/skills/agent-stack/'
```
Expected output includes: `git-worktree`

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| Problem / Why not Hermes `-w` | Documented in spec; skill explicitly says not to use `-w` (Task 4) |
| Volume architecture — two volumes | Task 5 (Dockerfile mkdir), Task 6 (compose volume), Task 11 (droplet restart) |
| `HERMES_DATA_ROOT` / `HERMES_REPOS_ROOT` env vars | Task 1 (script), Task 6 (compose), Task 11 (droplet env) |
| Per-profile `.env` — `REPOS=` access control | Task 1 (`check_access`), Task 2 (tests) |
| `PROFILE_NAME=` injection | Task 3 (bootstrap), Task 9 (setup script) |
| `hermes-worktree` binary on PATH | Task 1 (script), Task 5 (Dockerfile symlink) |
| `git-worktree` agent-stack skill | Task 4 |
| `bootstrap-profiles.sh` extension | Task 3 |
| `compose.yaml` volume + env vars | Task 6 |
| Rollout — template-agent PR | Task 8 |
| Rollout — agent-haverford | Tasks 9–12 |
| Verification steps from spec | Task 12 mirrors spec verification section exactly |
| `-u node` vs `-u hermes` context | Task 12 uses `-u hermes` (correct for agent-haverford custom image) |
| Branch naming / pipeline-core issue-first | Task 4 skill, Task 8 (PR follows pipeline-core convention) |
