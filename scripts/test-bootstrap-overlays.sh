#!/usr/bin/env bash
set -euo pipefail

# Test harness for bootstrap-profiles.sh sync_mcp_servers_from_template
# overlay support (issue #84). Extracts the function definition from the
# script, evals it into scope, and invokes it against tmpdir fixtures with
# TEMPLATE_DIR and BOOTSTRAP_PYTHON_BIN overridden.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Use system python3 instead of the image-bundled Hermes venv.
PYTHON_BIN="$(command -v python3 || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "FAIL: python3 not found on PATH" >&2
  exit 1
fi
if ! "$PYTHON_BIN" -c "import yaml" 2>/dev/null; then
  echo "FAIL: PyYAML not available in $PYTHON_BIN — install with: $PYTHON_BIN -m pip install pyyaml" >&2
  exit 1
fi

failed=0
passed=0
case_num=0

setup_case() {
  TMPDIR_CASE="$(mktemp -d)"
  export TEMPLATE_DIR="$TMPDIR_CASE/templates"
  export BOOTSTRAP_PYTHON_BIN="$PYTHON_BIN"
  mkdir -p "$TEMPLATE_DIR"
  PROFILE_CONFIG="$TMPDIR_CASE/profile.yaml"
  # default canonical template — just a paperclip MCP, mirroring production
  cat > "$TEMPLATE_DIR/config.yaml" <<'YAML'
mcp_servers:
  paperclip:
    command: node
    args: ["/opt/paperclip/mcp-paperclip/server.mjs"]
    enabled: true
YAML
  # default profile — empty mcp_servers
  cat > "$PROFILE_CONFIG" <<'YAML'
mcp_servers: {}
YAML
}

teardown_case() {
  rm -rf "$TMPDIR_CASE"
  unset TEMPLATE_DIR BOOTSTRAP_PYTHON_BIN
}

# Extract the sync_mcp_servers_from_template function from bootstrap-profiles.sh
# and eval it into this shell. Done per-case in case the function definition is
# being edited mid-run, but the extraction itself is cheap.
source_bootstrap_fn() {
  local fn_def
  fn_def="$(awk '/^sync_mcp_servers_from_template\(\) \{$/,/^\}$/' "$ROOT_DIR/hermes-runtime/scripts/bootstrap-profiles.sh")"
  if [[ -z "$fn_def" ]]; then
    echo "FAIL: could not extract sync_mcp_servers_from_template from bootstrap-profiles.sh" >&2
    return 1
  fi
  eval "$fn_def"
}

assert_profile_has_key() {
  local label="$1"
  local key="$2"
  if "$PYTHON_BIN" -c "
import yaml, sys
d = yaml.safe_load(open('$PROFILE_CONFIG')) or {}
sys.exit(0 if '$key' in (d.get('mcp_servers') or {}) else 1)
"; then
    return 0
  else
    echo "  FAIL ($label): expected key '$key' in profile mcp_servers" >&2
    return 1
  fi
}

assert_profile_lacks_key() {
  local label="$1"
  local key="$2"
  if "$PYTHON_BIN" -c "
import yaml, sys
d = yaml.safe_load(open('$PROFILE_CONFIG')) or {}
sys.exit(1 if '$key' in (d.get('mcp_servers') or {}) else 0)
"; then
    return 0
  else
    echo "  FAIL ($label): expected key '$key' NOT in profile mcp_servers" >&2
    return 1
  fi
}

assert_profile_key_value() {
  local label="$1"
  local key="$2"
  local jsonpath="$3"   # dotted, e.g. "url" or "headers.Authorization"
  local expected="$4"
  local got
  got="$("$PYTHON_BIN" -c "
import yaml
d = yaml.safe_load(open('$PROFILE_CONFIG')) or {}
cur = d.get('mcp_servers', {}).get('$key', {})
for p in '$jsonpath'.split('.'):
    cur = cur.get(p, '<MISSING>') if isinstance(cur, dict) else '<NOT-DICT>'
print(cur)
")"
  if [[ "$got" == "$expected" ]]; then
    return 0
  else
    echo "  FAIL ($label): key=$key path=$jsonpath expected='$expected' got='$got'" >&2
    return 1
  fi
}

run_case() {
  case_num=$((case_num + 1))
  local label="$1"
  shift
  echo "Case $case_num: $label"
  if "$@"; then
    echo "  PASS"
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
  fi
}

# ============================================================
# Case 1: No overlays/ dir present → behavior unchanged
# ============================================================
case_1() {
  setup_case
  # no overlays/ dir
  source_bootstrap_fn || return 1
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  assert_profile_has_key "case1" "paperclip" || { teardown_case; return 1; }
  assert_profile_lacks_key "case1" "genvest" || { teardown_case; return 1; }
  teardown_case
}
run_case "no overlays/ dir present" case_1

# ============================================================
# Case 2: overlays/ present but empty → behavior unchanged
# ============================================================
case_2() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  source_bootstrap_fn || return 1
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  assert_profile_has_key "case2" "paperclip" || { teardown_case; return 1; }
  assert_profile_lacks_key "case2" "genvest" || { teardown_case; return 1; }
  teardown_case
}
run_case "overlays/ present but empty" case_2

# ============================================================
# Case 3: Overlay with valid mcp_servers.foo → merged
# ============================================================
case_3() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  cat > "$TEMPLATE_DIR/overlays/foo.yaml" <<'YAML'
mcp_servers:
  foo:
    url: https://example.com/foo
    timeout: 99
YAML
  source_bootstrap_fn || return 1
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  assert_profile_has_key "case3" "paperclip" || { teardown_case; return 1; }
  assert_profile_has_key "case3" "foo" || { teardown_case; return 1; }
  assert_profile_key_value "case3" "foo" "url" "https://example.com/foo" || { teardown_case; return 1; }
  teardown_case
}
run_case "overlay with valid mcp_servers.foo merged" case_3

# ============================================================
# Case 4: Overlay key collision with canonical → canonical wins
# ============================================================
case_4() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  # overlay tries to redefine 'paperclip' — should be ignored
  cat > "$TEMPLATE_DIR/overlays/clash.yaml" <<'YAML'
mcp_servers:
  paperclip:
    command: SHOULD_NOT_WIN
YAML
  source_bootstrap_fn || return 1
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  assert_profile_key_value "case4" "paperclip" "command" "node" || { teardown_case; return 1; }
  teardown_case
}
run_case "overlay collision with canonical → canonical wins" case_4

# ============================================================
# Case 5: Two overlays declaring same key → alphabetic-first wins
# ============================================================
case_5() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  cat > "$TEMPLATE_DIR/overlays/a.yaml" <<'YAML'
mcp_servers:
  shared:
    url: WINNER
YAML
  cat > "$TEMPLATE_DIR/overlays/b.yaml" <<'YAML'
mcp_servers:
  shared:
    url: LOSER
YAML
  source_bootstrap_fn || return 1
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  assert_profile_has_key "case5" "shared" || { teardown_case; return 1; }
  assert_profile_key_value "case5" "shared" "url" "WINNER" || { teardown_case; return 1; }
  teardown_case
}
run_case "two overlays same key → alphabetic-first wins" case_5

# ============================================================
# Case 6: Overlay file with no mcp_servers key → skipped silently
# ============================================================
case_6() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  cat > "$TEMPLATE_DIR/overlays/noop.yaml" <<'YAML'
some_other_key:
  foo: bar
YAML
  source_bootstrap_fn || return 1
  # Should not crash; profile unchanged beyond the paperclip merge
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  assert_profile_has_key "case6" "paperclip" || { teardown_case; return 1; }
  teardown_case
}
run_case "overlay with no mcp_servers key → skipped silently" case_6

# ============================================================
# Case 7: Overlay with non-dict mcp_servers → skipped with warning
# ============================================================
case_7() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  cat > "$TEMPLATE_DIR/overlays/bad.yaml" <<'YAML'
mcp_servers: "not a dict"
YAML
  source_bootstrap_fn || return 1
  # Should not crash. Capture stderr to confirm warning was emitted.
  local stderr_out
  stderr_out="$(sync_mcp_servers_from_template "$PROFILE_CONFIG" 2>&1 >/dev/null)"
  assert_profile_has_key "case7" "paperclip" || { teardown_case; return 1; }
  if [[ "$stderr_out" != *"bad.yaml"* ]]; then
    echo "  FAIL (case7): expected stderr warning to mention 'bad.yaml', got: $stderr_out" >&2
    teardown_case
    return 1
  fi
  teardown_case
}
run_case "overlay with non-dict mcp_servers → skipped with warning" case_7

# ============================================================
# Case 8: Malformed YAML in overlay → skipped, others still merged
# ============================================================
case_8() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  # Unterminated flow sequence — definitively malformed YAML
  cat > "$TEMPLATE_DIR/overlays/broken.yaml" <<'YAML'
mcp_servers:
  bad: [unclosed
YAML
  cat > "$TEMPLATE_DIR/overlays/good.yaml" <<'YAML'
mcp_servers:
  good:
    url: https://example.com/good
YAML
  source_bootstrap_fn || return 1
  local stderr_out
  stderr_out="$(sync_mcp_servers_from_template "$PROFILE_CONFIG" 2>&1 >/dev/null)"
  assert_profile_has_key "case8" "good" || { teardown_case; return 1; }
  if [[ "$stderr_out" != *"broken.yaml"* ]]; then
    echo "  FAIL (case8): expected stderr warning to mention 'broken.yaml', got: $stderr_out" >&2
    teardown_case
    return 1
  fi
  teardown_case
}
run_case "malformed overlay skipped, others merged" case_8

# ============================================================
# Case 9: Re-running bootstrap is idempotent → no duplicates
# ============================================================
case_9() {
  setup_case
  mkdir -p "$TEMPLATE_DIR/overlays"
  cat > "$TEMPLATE_DIR/overlays/foo.yaml" <<'YAML'
mcp_servers:
  foo:
    url: https://example.com/foo
YAML
  source_bootstrap_fn || return 1
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  # Should still have exactly two entries: paperclip + foo
  local key_count
  key_count="$("$PYTHON_BIN" -c "
import yaml
d = yaml.safe_load(open('$PROFILE_CONFIG'))
print(len((d.get('mcp_servers') or {})))
")"
  if [[ "$key_count" != "2" ]]; then
    echo "  FAIL (case9): expected exactly 2 mcp_servers keys after 3 runs, got $key_count" >&2
    teardown_case
    return 1
  fi
  teardown_case
}
run_case "idempotent re-runs do not duplicate entries" case_9

# ============================================================
# Case 10: Profile already contains overlay's key → profile preserved
# ============================================================
case_10() {
  setup_case
  # Seed profile with its own version of 'foo'
  cat > "$PROFILE_CONFIG" <<'YAML'
mcp_servers:
  foo:
    url: PROFILE_VERSION
YAML
  mkdir -p "$TEMPLATE_DIR/overlays"
  cat > "$TEMPLATE_DIR/overlays/foo.yaml" <<'YAML'
mcp_servers:
  foo:
    url: OVERLAY_VERSION
YAML
  source_bootstrap_fn || return 1
  sync_mcp_servers_from_template "$PROFILE_CONFIG"
  assert_profile_key_value "case10" "foo" "url" "PROFILE_VERSION" || { teardown_case; return 1; }
  teardown_case
}
run_case "profile entry preserved over overlay entry" case_10

# ============================================================
echo ""
echo "Results: $passed passed, $failed failed (of $case_num total)"
exit $failed
