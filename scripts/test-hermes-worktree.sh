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
  mkdir -p "$base/repos/bare"
  git init --bare "$base/repos/bare/myrepo.git" --initial-branch=main >/dev/null 2>&1 \
    || git init --bare "$base/repos/bare/myrepo.git" >/dev/null 2>&1

  # Seed with one commit so worktrees can branch from HEAD
  local seed="$base/seed"
  git clone "$base/repos/bare/myrepo.git" "$seed" --quiet 2>/dev/null || true
  git -C "$seed" config user.email "test@test.com" 2>/dev/null || true
  git -C "$seed" config user.name "Test" 2>/dev/null || true
  touch "$seed/README.md"
  git -C "$seed" add . 2>/dev/null || true
  git -C "$seed" commit -m "init" --quiet 2>/dev/null || true
  git -C "$seed" push origin HEAD:main --quiet 2>/dev/null || true

  mkdir -p "$base/hermes/profiles/coder"
  echo "PROFILE_NAME=coder" > "$base/hermes/profiles/coder/.env"
  echo "REPOS=myrepo"       >> "$base/hermes/profiles/coder/.env"

  echo "PROFILE_NAME=default" > "$base/hermes/.env"
  # default has no REPOS= intentionally

  mkdir -p "$base/repos/worktrees"

  export HERMES_DATA_ROOT="$base/hermes"
  export HERMES_REPOS_ROOT="$base/repos"
}

# ── Test: access denied when REPOS= not set ──────────────────────────────────
echo "Test: access denied when REPOS= unset"
E="$(mktemp -d "$TMPDIR_BASE/t1.XXXX")"
setup_env "$E"
OUT=$("$SCRIPT" add default myrepo feature/x 2>&1 || true)
if echo "$OUT" | grep -q "no repo access"; then
  pass "access denied for default (no REPOS=)"
else
  fail "expected denial for default profile without REPOS="
fi

# ── Test: access denied when repo not in list ────────────────────────────────
echo "Test: access denied when repo not in allowlist"
E="$(mktemp -d "$TMPDIR_BASE/t2.XXXX")"
setup_env "$E"
OUT=$("$SCRIPT" add coder otherrepo feature/x 2>&1 || true)
if echo "$OUT" | grep -q "does not have access"; then
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
  OUT=$("$SCRIPT" add coder myrepo "$b" 2>&1 || true)
  if echo "$OUT" | grep -q "Cannot create a worktree on"; then
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
