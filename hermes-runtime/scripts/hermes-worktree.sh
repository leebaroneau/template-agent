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
