#!/usr/bin/env bash
# Tests for hermes-runtime/scripts/reload-repo-access.sh
# No Docker required — tests run against temp dirs and a local config fixture.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/hermes-runtime/scripts/reload-repo-access.sh"
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

failed=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1" >&2; failed=1; }

# ── Fixture: minimal valid repo-access.yml ───────────────────────────────────
VALID_CONFIG="$TMPDIR_BASE/repo-access.yml"
cat > "$VALID_CONFIG" <<'YAML'
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

# ── Test 1: missing config exits 1 with clear message ────────────────────────
echo "Test: missing config exits 1 with clear message"
{
  OUT=$(REPO_ACCESS_CONFIG="$TMPDIR_BASE/nonexistent.yml" "$SCRIPT" 2>&1 || true)
  CODE=0
  REPO_ACCESS_CONFIG="$TMPDIR_BASE/nonexistent.yml" "$SCRIPT" >/dev/null 2>&1 || CODE=$?
  if [[ "$CODE" -eq 1 ]] && echo "$OUT" | grep -qi "no config found"; then
    pass "exits 1 and reports 'no config found' for missing config"
  else
    fail "expected exit 1 and 'no config found' message (got exit $CODE; output: $OUT)"
  fi
}

# ── Test 2: invalid YAML exits 1 ─────────────────────────────────────────────
echo "Test: invalid YAML exits 1"
{
  INVALID_CONFIG="$TMPDIR_BASE/bad.yml"
  printf 'github: {org: [bad yaml\n' > "$INVALID_CONFIG"
  OUT=$(REPO_ACCESS_CONFIG="$INVALID_CONFIG" "$SCRIPT" 2>&1 || true)
  CODE=0
  REPO_ACCESS_CONFIG="$INVALID_CONFIG" "$SCRIPT" >/dev/null 2>&1 || CODE=$?
  if [[ "$CODE" -eq 1 ]]; then
    pass "exits 1 for invalid YAML"
  else
    fail "expected exit 1 for invalid YAML (got exit $CODE; output: $OUT)"
  fi
}

# ── Test 3: --dry-run flag accepted and passed through ───────────────────────
echo "Test: --dry-run is accepted and passed through to setup script"
{
  REPOS_TMP="$TMPDIR_BASE/repos"
  mkdir -p "$REPOS_TMP"
  CODE=0
  OUT=$(REPO_ACCESS_CONFIG="$VALID_CONFIG" HERMES_REPOS_ROOT="$REPOS_TMP" \
        "$SCRIPT" --dry-run 2>&1) || CODE=$?
  # The reload script should exit 0 and produce dry-run or completion output
  if [[ "$CODE" -eq 0 ]] && \
     (echo "$OUT" | grep -qi "would clone\|skip\|done\|(dry-run)"); then
    pass "--dry-run exits 0 and produces expected dry-run output"
  else
    fail "--dry-run failed (exit $CODE; output: $OUT)"
  fi
}

# ── Test 4: bash syntax is valid ─────────────────────────────────────────────
echo "Test: reload-repo-access.sh bash syntax is valid"
{
  if bash -n "$SCRIPT" 2>/dev/null; then
    pass "bash -n reports no syntax errors"
  else
    ERR=$(bash -n "$SCRIPT" 2>&1 || true)
    fail "bash -n found syntax errors: $ERR"
  fi
}

# ── Results ──────────────────────────────────────────────────────────────────
echo
if [ "$failed" -ne 0 ]; then
  echo "FAILED"
  exit 1
fi
echo "All reload-repo-access tests passed."
