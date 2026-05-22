# MCP Overlay Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add brand overlay support for `mcp_servers` to `hermes-runtime/scripts/bootstrap-profiles.sh` so brand wrappers can contribute additional MCP servers via `$TEMPLATE_DIR/overlays/*.yaml` files without forking, snapshotting, or duplicating the existing merge logic.

**Architecture:** Single-function modification in the existing `sync_mcp_servers_from_template` bash function. The embedded Python heredoc gains a pre-pass that walks `$TEMPLATE_DIR/overlays/*.yaml` (sorted alphabetically), absorbs each file's `mcp_servers.*` into the effective template dict (strictly additive — canonical wins on collision), then runs the existing profile merge unchanged. Backward-compatible: if `overlays/` is absent or empty, behavior is identical to today.

**Tech Stack:** Bash, embedded Python 3 via PyYAML (bundled at `/usr/local/lib/hermes-agent/venv/bin/python` in the image; `python3` with PyYAML for local testing). New bash test harness `scripts/test-bootstrap-overlays.sh` mirrors the existing `scripts/test-*.sh` pattern.

**Spec:** `docs/superpowers/specs/2026-05-22-mcp-overlay-design.md` (already committed on this branch).

**Issue:** Fixes #84.

**Branch:** `story/84-mcp-overlay-support` (already created and checked out).

---

## File map

- **Create:** `hermes-runtime/templates/overlays/.gitkeep` — empty marker so the dir exists in git and gets COPYed into the image
- **Create:** `scripts/test-bootstrap-overlays.sh` — new bash test harness (10 cases per the spec)
- **Modify:** `hermes-runtime/scripts/bootstrap-profiles.sh` — make `TEMPLATE_DIR` and python bin env-overridable (for tests); extend `sync_mcp_servers_from_template` to read overlays
- **Modify:** `package.json` — add `./scripts/test-bootstrap-overlays.sh` to the `test` script chain
- **Modify:** `README.md` — extend the existing MCP merge documentation section to cover overlays

---

## Task 0: Preflight — confirm python3 + pyyaml available for local testing

**Files:** none

- [ ] **Step 1: Verify python3 + pyyaml are available**

Run:
```bash
python3 -c "import yaml; print(yaml.__version__)"
```

Expected: a version string (e.g. `6.0.2`). If it errors with `ModuleNotFoundError: No module named 'yaml'`, install: `python3 -m pip install --user pyyaml` or use a venv. The test harness needs PyYAML locally because the image's bundled python (`/usr/local/lib/hermes-agent/venv/bin/python`) isn't on dev machines.

- [ ] **Step 2: Confirm we're on the right branch**

Run:
```bash
cd /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent && git rev-parse --abbrev-ref HEAD
```

Expected: `story/84-mcp-overlay-support`

---

## Task 1: Create the overlays directory with a `.gitkeep`

**Files:**
- Create: `hermes-runtime/templates/overlays/.gitkeep`

- [ ] **Step 1: Create the overlay dir and gitkeep marker**

Run:
```bash
cd /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent
mkdir -p hermes-runtime/templates/overlays
touch hermes-runtime/templates/overlays/.gitkeep
```

- [ ] **Step 2: Add a short README inside the overlays dir documenting the contract**

Create file `hermes-runtime/templates/overlays/README.md` with this exact content:

```markdown
# Brand `mcp_servers` overlays

Drop YAML files in this directory to contribute additional `mcp_servers` entries to every Hermes profile. `bootstrap-profiles.sh` reads `*.yaml` in this directory (sorted alphabetically) on every container start and merges each file's `mcp_servers.*` into the effective template before merging that into each profile's `config.yaml`.

## Semantics

- **Strictly additive at both layers.** An overlay cannot redefine a key that's already present in the canonical `../config.yaml`, and the effective template cannot override a key that's already in a profile's `config.yaml`.
- **Order:** overlays are processed in alphabetical filename order; the first to declare a given key wins among overlays.
- **Scope:** only the `mcp_servers` top-level key. Other keys in overlay files are ignored.
- **Errors are soft.** Malformed YAML, missing `mcp_servers` key, or non-dict `mcp_servers` value cause a single stderr warning and the overlay is skipped. Bootstrap never crashes because of overlay errors.

## Example overlay file

```yaml
mcp_servers:
  example:
    url: https://example.com/mcp
    headers:
      Authorization: "Bearer ${EXAMPLE_API_KEY}"
    timeout: 120
```

Brand operators populate `${EXAMPLE_API_KEY}` per-profile via each profile's `.env` at `/data/hermes/profiles/<slug>/.env`. Hermes resolves `${VAR}` references at runtime per-profile.

## Brand wrapper integration

A brand wrapper provides one overlay file via Docker Compose `configs:`, mounted on **both** the `paperclip` and `hermes` services (bootstrap-profiles.sh runs in both, behind the shared `flock /data/.locks/bootstrap-profiles.lock`):

```yaml
configs:
  brand_mcp_overlay:
    content: |
      mcp_servers:
        example:
          url: https://example.com/mcp
          ...

services:
  paperclip:
    configs:
      - source: brand_mcp_overlay
        target: /opt/hermes-runtime/templates/overlays/brand.yaml
  hermes:
    configs:
      - source: brand_mcp_overlay
        target: /opt/hermes-runtime/templates/overlays/brand.yaml
```
```

- [ ] **Step 3: Verify the files exist**

Run:
```bash
ls -la hermes-runtime/templates/overlays/
```

Expected output includes `.gitkeep` and `README.md`.

- [ ] **Step 4: Commit**

```bash
git add hermes-runtime/templates/overlays/.gitkeep hermes-runtime/templates/overlays/README.md
git commit -m "$(cat <<'EOF'
feat(bootstrap): seed empty overlays/ directory in template tree

Adds hermes-runtime/templates/overlays/ with a .gitkeep marker and a
README documenting the brand-overlay contract. The directory is empty
by default; brand wrappers contribute YAML files via Docker Compose
configs: mounts. The COPY in paperclip/Dockerfile:74 already includes
hermes-runtime/templates/ so the new subdirectory ships in the image
without a Dockerfile change.

Refs #84
EOF
)"
```

---

## Task 2: Make `TEMPLATE_DIR` and python bin env-overridable in bootstrap-profiles.sh

**Files:**
- Modify: `hermes-runtime/scripts/bootstrap-profiles.sh:7` (TEMPLATE_DIR)
- Modify: `hermes-runtime/scripts/bootstrap-profiles.sh:106` (python_bin inside sync_mcp_servers_from_template)

This is a refactor-only step so the test harness in Task 3 can point at tmpdir fixtures and use a system python. No behavior change in production (defaults preserved exactly).

- [ ] **Step 1: Make TEMPLATE_DIR env-overridable**

Edit `hermes-runtime/scripts/bootstrap-profiles.sh` line 7 from:

```bash
TEMPLATE_DIR="/opt/hermes-runtime/templates"
```

to:

```bash
TEMPLATE_DIR="${TEMPLATE_DIR:-/opt/hermes-runtime/templates}"
```

- [ ] **Step 2: Make python_bin env-overridable**

Edit `hermes-runtime/scripts/bootstrap-profiles.sh::sync_mcp_servers_from_template` line 106 from:

```bash
  local python_bin="/usr/local/lib/hermes-agent/venv/bin/python"
```

to:

```bash
  local python_bin="${BOOTSTRAP_PYTHON_BIN:-/usr/local/lib/hermes-agent/venv/bin/python}"
```

- [ ] **Step 3: Verify the script still parses**

Run:
```bash
bash -n hermes-runtime/scripts/bootstrap-profiles.sh && echo "syntax ok"
```

Expected: `syntax ok`

- [ ] **Step 4: Commit**

```bash
git add hermes-runtime/scripts/bootstrap-profiles.sh
git commit -m "$(cat <<'EOF'
refactor(bootstrap): make TEMPLATE_DIR and python bin env-overridable

Allows tests to point TEMPLATE_DIR at tmpdir fixtures and substitute a
system python3 for the image-bundled Hermes venv. Production behavior
unchanged — defaults preserved exactly (TEMPLATE_DIR=/opt/hermes-runtime/templates,
python_bin=/usr/local/lib/hermes-agent/venv/bin/python).

Refs #84
EOF
)"
```

---

## Task 3: Write the failing test harness (TDD red)

**Files:**
- Create: `scripts/test-bootstrap-overlays.sh`

The test harness sources `bootstrap-profiles.sh` and invokes `sync_mcp_servers_from_template` against tmpdir fixtures with `TEMPLATE_DIR` and `BOOTSTRAP_PYTHON_BIN` overridden.

- [ ] **Step 1: Create the test harness**

Create `scripts/test-bootstrap-overlays.sh` with this exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Test harness for bootstrap-profiles.sh sync_mcp_servers_from_template
# overlay support (issue #84). Sources the script and invokes the
# function against tmpdir fixtures with TEMPLATE_DIR and BOOTSTRAP_PYTHON_BIN
# overridden.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Use system python3 instead of the image-bundled Hermes venv.
PYTHON_BIN="$(command -v python3)"
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
  case_num=$((case_num + 1))
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

# Sources bootstrap-profiles.sh in a way that does NOT execute its main loop.
# We do this by defining HERMES_PROFILES=__test_noop__ before sourcing — the
# script will try to process a nonexistent profile and the for-loop will
# silently skip it, leaving the function defined.
source_bootstrap_fn() {
  # Source in a subshell-safe way; the script must define the function and
  # exit cleanly without affecting our test env beyond function definitions.
  # We can't fully source it because of the unconditional mkdir; instead,
  # extract the function definition with awk.
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
  if "$PYTHON_BIN" -c "import yaml,sys; d=yaml.safe_load(open('$PROFILE_CONFIG')) or {}; sys.exit(0 if '$key' in (d.get('mcp_servers') or {}) else 1)"; then
    return 0
  else
    echo "  FAIL ($label): expected key '$key' in profile mcp_servers" >&2
    return 1
  fi
}

assert_profile_lacks_key() {
  local label="$1"
  local key="$2"
  if "$PYTHON_BIN" -c "import yaml,sys; d=yaml.safe_load(open('$PROFILE_CONFIG')) or {}; sys.exit(1 if '$key' in (d.get('mcp_servers') or {}) else 0)"; then
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
  got="$("$PYTHON_BIN" -c "import yaml; d=yaml.safe_load(open('$PROFILE_CONFIG')) or {}; cur=d.get('mcp_servers',{}).get('$key',{});
for p in '$jsonpath'.split('.'):
    cur = cur.get(p, '<MISSING>') if isinstance(cur, dict) else '<NOT-DICT>'
print(cur)")"
  if [[ "$got" == "$expected" ]]; then
    return 0
  else
    echo "  FAIL ($label): key=$key path=$jsonpath expected='$expected' got='$got'" >&2
    return 1
  fi
}

run_case() {
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
  cat > "$TEMPLATE_DIR/overlays/broken.yaml" <<'YAML'
this is: not: valid: yaml:
  : :
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
  key_count="$("$PYTHON_BIN" -c "import yaml; d=yaml.safe_load(open('$PROFILE_CONFIG')); print(len((d.get('mcp_servers') or {})))")"
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
```

- [ ] **Step 2: Make it executable**

Run:
```bash
chmod +x scripts/test-bootstrap-overlays.sh
```

- [ ] **Step 3: Run the test harness — expect failures for overlay cases**

Run:
```bash
./scripts/test-bootstrap-overlays.sh
```

Expected: Case 1, 2, 4 (canonical-only paths) PASS. Cases 3, 5, 6, 7, 8, 9, 10 FAIL because `sync_mcp_servers_from_template` doesn't yet read overlays. This is the TDD red baseline.

If cases that should currently pass are failing for unrelated reasons (e.g. python_bin not overridable from Task 2), fix Task 2 first.

- [ ] **Step 4: Commit the failing test harness**

```bash
git add scripts/test-bootstrap-overlays.sh
git commit -m "$(cat <<'EOF'
test(bootstrap): add failing test harness for overlay support (#84)

10-case bash test harness for sync_mcp_servers_from_template overlay
behavior per docs/superpowers/specs/2026-05-22-mcp-overlay-design.md.

Cases 1, 2, 4 (canonical-only paths) pass against current code.
Cases 3, 5, 6, 7, 8, 9, 10 fail — they exercise overlay merge behavior
not yet implemented. This is the TDD red baseline; Task 4 makes them
green.

Refs #84
EOF
)"
```

---

## Task 4: Implement overlay merge in sync_mcp_servers_from_template (TDD green)

**Files:**
- Modify: `hermes-runtime/scripts/bootstrap-profiles.sh:96-144` (`sync_mcp_servers_from_template` function)

- [ ] **Step 1: Replace the function body with the overlay-aware version**

Open `hermes-runtime/scripts/bootstrap-profiles.sh` and replace the function `sync_mcp_servers_from_template` (currently lines 96-144) with this exact content:

```bash
# Idempotently add any mcp_servers entries that exist in the canonical
# template config — or in any brand overlay file under
# $TEMPLATE_DIR/overlays/*.yaml — but are missing from this profile's
# config. Existing profile entries are NEVER overwritten, so user
# customisations (different command path, disabled flag, extra fields)
# are preserved.
#
# Merge semantics (strictly additive at both layers):
#   - Canonical template wins over any overlay on key collision.
#   - Among overlays, alphabetic-first filename wins on collision.
#   - Profile wins over the effective (canonical + overlays) template.
#
# Brand wrappers contribute overlays via Docker Compose `configs:` mounts
# at /opt/hermes-runtime/templates/overlays/<brand>.yaml on both the
# paperclip AND hermes services. See hermes-runtime/templates/overlays/README.md.
#
# Error handling: malformed YAML, missing `mcp_servers` key, or non-dict
# `mcp_servers` value emit a single stderr warning and the overlay is
# skipped. Bootstrap MUST NOT crash because of overlay errors — the
# canonical template path remains authoritative.
#
# Uses Hermes' bundled Python interpreter for PyYAML (overridable via
# BOOTSTRAP_PYTHON_BIN for tests).
sync_mcp_servers_from_template() {
  local profile_config="$1"
  local template_config="$TEMPLATE_DIR/config.yaml"
  local overlays_dir="$TEMPLATE_DIR/overlays"
  local python_bin="${BOOTSTRAP_PYTHON_BIN:-/usr/local/lib/hermes-agent/venv/bin/python}"

  if [[ ! -f "$profile_config" || ! -f "$template_config" || ! -x "$python_bin" ]]; then
    return 0
  fi

  "$python_bin" - "$template_config" "$profile_config" "$overlays_dir" <<'PYEOF'
import os
import sys
import glob
import yaml

template_path, profile_path, overlays_dir = sys.argv[1], sys.argv[2], sys.argv[3]

with open(template_path) as f:
    template = yaml.safe_load(f) or {}

effective_mcp = dict(template.get("mcp_servers") or {})

# Absorb overlay mcp_servers into the effective template, strictly additive.
# Canonical wins on collision (entries already in effective_mcp are skipped).
# Among overlays, alphabetic-first filename wins on collision (later files
# also see those keys as already-present).
if os.path.isdir(overlays_dir):
    for overlay_path in sorted(glob.glob(os.path.join(overlays_dir, "*.yaml"))):
        try:
            with open(overlay_path) as f:
                overlay = yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError) as exc:
            print(f"[bootstrap] overlay {overlay_path}: skipped ({exc.__class__.__name__})", file=sys.stderr)
            continue
        if not isinstance(overlay, dict):
            print(f"[bootstrap] overlay {overlay_path}: skipped (top-level is not a mapping)", file=sys.stderr)
            continue
        overlay_mcp = overlay.get("mcp_servers")
        if overlay_mcp is None:
            continue
        if not isinstance(overlay_mcp, dict):
            print(f"[bootstrap] overlay {overlay_path}: skipped (mcp_servers is not a mapping)", file=sys.stderr)
            continue
        for name, spec in overlay_mcp.items():
            if name not in effective_mcp:
                effective_mcp[name] = spec

if not effective_mcp:
    sys.exit(0)

with open(profile_path) as f:
    profile = yaml.safe_load(f) or {}

profile_mcp = profile.get("mcp_servers") or {}
added = []
for name, spec in effective_mcp.items():
    if name not in profile_mcp:
        profile_mcp[name] = spec
        added.append(name)

if not added:
    sys.exit(0)

profile["mcp_servers"] = profile_mcp
with open(profile_path, "w") as f:
    yaml.safe_dump(profile, f, sort_keys=False)

print(f"[bootstrap] merged mcp_servers into {profile_path}: {', '.join(added)}", file=sys.stderr)
PYEOF
}
```

- [ ] **Step 2: Verify the script still parses**

Run:
```bash
bash -n hermes-runtime/scripts/bootstrap-profiles.sh && echo "syntax ok"
```

Expected: `syntax ok`

- [ ] **Step 3: Run the test harness — all 10 cases should now pass**

Run:
```bash
./scripts/test-bootstrap-overlays.sh
```

Expected: `Results: 10 passed, 0 failed (of 10 total)`

If any case fails, fix the implementation (NOT the test) and re-run.

- [ ] **Step 4: Commit the implementation**

```bash
git add hermes-runtime/scripts/bootstrap-profiles.sh
git commit -m "$(cat <<'EOF'
feat(bootstrap): merge mcp_servers from $TEMPLATE_DIR/overlays/*.yaml

Extends sync_mcp_servers_from_template to read brand overlay files from
$TEMPLATE_DIR/overlays/*.yaml (sorted alphabetically) and merge their
mcp_servers.* entries into the effective template before merging that
into each profile config.yaml.

Strictly additive at both layers:
  - Canonical template wins over any overlay on key collision.
  - Among overlays, alphabetic-first filename wins on collision.
  - Profile wins over the effective (canonical + overlays) template.

Errors are soft — malformed YAML, missing mcp_servers, or non-dict
mcp_servers value emit a single stderr warning per file and skip that
overlay. Bootstrap never crashes because of overlay errors.

Backward-compatible: if overlays/ is absent or empty, behavior is
identical to the pre-change function. All 10 test cases in
scripts/test-bootstrap-overlays.sh pass.

Fixes #84
EOF
)"
```

---

## Task 5: Wire the test into `npm test`

**Files:**
- Modify: `package.json` (line 3, `scripts.test`)

- [ ] **Step 1: Add the test script to the test chain**

Open `package.json`. The current test line is:

```json
    "test": "node --test paperclip/*.test.mjs scripts/*.test.mjs && ./scripts/test-default-profile-only.sh && ./scripts/test-hermes-tui-prebuilt.sh && ./scripts/test-no-provider-placeholders.sh && ./scripts/test-blank-template.sh",
```

Append `&& ./scripts/test-bootstrap-overlays.sh` so it becomes:

```json
    "test": "node --test paperclip/*.test.mjs scripts/*.test.mjs && ./scripts/test-default-profile-only.sh && ./scripts/test-hermes-tui-prebuilt.sh && ./scripts/test-no-provider-placeholders.sh && ./scripts/test-blank-template.sh && ./scripts/test-bootstrap-overlays.sh",
```

- [ ] **Step 2: Run the full test suite**

Run:
```bash
npm test
```

Expected: all tests pass, including the new `test-bootstrap-overlays.sh` line at the end. If an unrelated test fails (network, env, etc.), note it but proceed — that's pre-existing and out of scope.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
test(ci): wire test-bootstrap-overlays.sh into npm test (#84)

Adds the new overlay test harness to the test script chain so it runs
in CI and any local `npm test` invocation.

Refs #84
EOF
)"
```

---

## Task 6: Update README.md to document overlays

**Files:**
- Modify: `README.md:346` (the existing MCP merge documentation section)

- [ ] **Step 1: Locate the section**

Run:
```bash
sed -n '340,355p' README.md
```

Expected output: the paragraph beginning with "When you (or an upstream update) add a new MCP server to `hermes-runtime/templates/config.yaml`..."

- [ ] **Step 2: Append the overlay documentation paragraph**

After the existing paragraph at line 346, add two new paragraphs documenting overlays. Use the Edit tool with old_string matching the existing sentence and new_string adding the overlay paragraphs immediately after.

Find this text in `README.md`:

```
When you (or an upstream update) add a new MCP server to `hermes-runtime/templates/config.yaml`, the `bootstrap-profiles.sh` entrypoint script idempotently merges any *missing* `mcp_servers.*` entries into every profile config on the next container start — both `HERMES_PROFILES`-listed profiles AND per-role profiles that `profile-sync.mjs` created at runtime under `/data/hermes/profiles/`. Existing entries are never overwritten, so per-profile customisations are preserved. New servers added to the template propagate to every Hermes profile automatically without a manual patch.
```

Replace it with this expanded text (adds two paragraphs covering overlays):

```
When you (or an upstream update) add a new MCP server to `hermes-runtime/templates/config.yaml`, the `bootstrap-profiles.sh` entrypoint script idempotently merges any *missing* `mcp_servers.*` entries into every profile config on the next container start — both `HERMES_PROFILES`-listed profiles AND per-role profiles that `profile-sync.mjs` created at runtime under `/data/hermes/profiles/`. Existing entries are never overwritten, so per-profile customisations are preserved. New servers added to the template propagate to every Hermes profile automatically without a manual patch.

**Brand overlays.** Brand wrappers (e.g. `agent-genvest`) can contribute additional `mcp_servers` entries without modifying or forking this image. Drop YAML files into `/opt/hermes-runtime/templates/overlays/*.yaml` — typically via Docker Compose `configs:` mounts on both the `paperclip` and `hermes` services — and `bootstrap-profiles.sh` merges each file's `mcp_servers.*` into the effective template before merging that into each profile. The merge is strictly additive at both layers: the canonical `config.yaml` wins over any overlay on key collision, and existing profile entries always win over the effective template. Among overlays, alphabetic-first filename wins on collision.

Overlay errors (malformed YAML, missing `mcp_servers` key, non-dict `mcp_servers` value) emit a single stderr warning and skip that overlay — bootstrap never crashes because of overlay errors. See `hermes-runtime/templates/overlays/README.md` (shipped in the image) for the contract a brand overlay file must follow.
```

- [ ] **Step 3: Verify the edit landed correctly**

Run:
```bash
grep -A 2 "Brand overlays" README.md | head -5
```

Expected: a line starting with `**Brand overlays.**` followed by the next paragraph's start.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): document brand overlay support for mcp_servers (#84)

Extends the existing MCP merge documentation to cover the new
$TEMPLATE_DIR/overlays/*.yaml mechanism. Points readers at the in-image
overlays/README.md for the brand-overlay contract.

Refs #84
EOF
)"
```

---

## Task 7: Sanity check — full repo state

- [ ] **Step 1: View the commits added on this branch**

Run:
```bash
git log --oneline main..HEAD
```

Expected: 6 commits (spec already committed, plus 5 from Tasks 1-6).

Each commit should be ~one task. Inspect to confirm scope is clean.

- [ ] **Step 2: Re-run the full test suite**

Run:
```bash
npm test
```

Expected: all green.

- [ ] **Step 3: Run shellcheck on changed scripts (if available)**

Run:
```bash
which shellcheck && shellcheck hermes-runtime/scripts/bootstrap-profiles.sh scripts/test-bootstrap-overlays.sh || echo "shellcheck not available, skipping"
```

Expected: no warnings, or shellcheck unavailable.

- [ ] **Step 4: Confirm the in-image overlay dir COPYs correctly**

Run:
```bash
grep "COPY hermes-runtime/templates" paperclip/Dockerfile
```

Expected: `COPY hermes-runtime/templates /opt/hermes-runtime/templates` — this single line already includes the new `overlays/` subdirectory since it's under `hermes-runtime/templates/`. No Dockerfile change needed.

---

## Task 8: Push branch and open PR

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin story/84-mcp-overlay-support
```

Expected: push succeeds; upstream tracking set.

- [ ] **Step 2: Open the PR with `Fixes #84`**

Run:
```bash
gh pr create \
  --repo leebaroneau/template-agent \
  --title "Feature request: Add brand overlay support for mcp_servers in bootstrap-profiles.sh" \
  --body "$(cat <<'EOF'
Fixes #84

## Summary

Adds a documented extension point in `hermes-runtime/scripts/bootstrap-profiles.sh` so brand wrappers can contribute brand-specific `mcp_servers` entries to the canonical Hermes profile template via `$TEMPLATE_DIR/overlays/*.yaml` files. Strictly additive at both layers (overlay → effective template, effective template → profile). Backward-compatible: behavior is identical to today when `overlays/` is absent or empty (which it is on every existing deployment).

Spec: [`docs/superpowers/specs/2026-05-22-mcp-overlay-design.md`](docs/superpowers/specs/2026-05-22-mcp-overlay-design.md)
Plan: [`docs/superpowers/plans/2026-05-22-mcp-overlay-support.md`](docs/superpowers/plans/2026-05-22-mcp-overlay-support.md)

## Changes

- `hermes-runtime/scripts/bootstrap-profiles.sh` — `sync_mcp_servers_from_template` now reads `$TEMPLATE_DIR/overlays/*.yaml` (sorted alphabetically) and merges each file's `mcp_servers.*` into the effective template before per-profile merge. `TEMPLATE_DIR` and the embedded python bin are now env-overridable for testability.
- `hermes-runtime/templates/overlays/` — new directory with `.gitkeep` and a `README.md` documenting the brand-overlay contract (ships in the image; brand wrappers read it via `docker exec`).
- `scripts/test-bootstrap-overlays.sh` — new bash test harness exercising 10 cases (no overlay dir, empty dir, valid merge, canonical-wins collision, overlay-vs-overlay collision, no-mcp-key, non-dict mcp_servers, malformed YAML, idempotent re-run, profile-wins).
- `package.json` — wires `test-bootstrap-overlays.sh` into the `npm test` chain.
- `README.md` — extends the MCP merge documentation section to cover overlays.

## Test plan

- [x] `npm test` passes locally — all existing tests plus the new 10-case overlay harness
- [x] `bash -n hermes-runtime/scripts/bootstrap-profiles.sh` parses
- [x] `./scripts/test-bootstrap-overlays.sh` standalone: 10 passed, 0 failed
- [x] Backward-compatible: cases 1 & 2 of the harness verify behavior is unchanged when `overlays/` is absent or empty (the state of every existing deployment)
- [ ] CI green on pipeline-* checks
- [ ] Reviewer manually verifies the in-image overlay path: build the image, exec into it, confirm `/opt/hermes-runtime/templates/overlays/.gitkeep` and `README.md` are present

## Companion follow-up

After this lands and a new template-agent image ships, a separate PR on `Genvest-Property/agent-genvest` will:
1. Add `runtime/genvest/hermes/overlays/genvest.yaml` (single overlay file) mounted via `configs:` on both `paperclip` and `hermes` services
2. Delete the destructive `sync_genvest_mcp_auth` / `add_genvest_mcp_server` / `genvest_token_variable_for_config` from `docker-compose.yaml`'s `runtime-seed`
3. Remove dead `notion:` MCP references (never wired to any profile in prod)
4. Remove unused per-profile `GENVEST_SERVICE_API_TOKEN_*` env-var indirection
5. Bump pinned `TEMPLATE_AGENT_IMAGE` SHA to this PR's resulting build
EOF
)"
```

- [ ] **Step 3: Capture the PR URL**

The previous command returns the PR URL. Save it for the next step.

- [ ] **Step 4: Verify pipeline-* commit statuses go green**

Wait ~2-3 minutes for CI to run, then:

```bash
gh pr checks <PR_NUMBER> --repo leebaroneau/template-agent
```

Expected: `pipeline/branch-name`, `pipeline/issue-link`, `pipeline/merge-gate` all ✓. The `build-image` workflow will also fire (builds + pushes the ghcr image). If any pipeline-* check is red, the branch name or issue link is wrong — diagnose and fix before requesting review.

---

## Self-review checklist (run after writing the plan, before execution)

- **Spec coverage:** Every spec section maps to at least one task:
  - Spec §Discovery → Task 4 (Python heredoc reads `$TEMPLATE_DIR/overlays/*.yaml` sorted)
  - Spec §Merge semantics (Layer 1 & 2) → Task 4 (Python heredoc has the "if name not in" guards at both layers)
  - Spec §File layout → Task 1 (creates `overlays/` with `.gitkeep` and `README.md`)
  - Spec §Brand wrapper integration → Task 1's README + Task 6's README.md update both document the dual paperclip+hermes mount
  - Spec §Error handling → Task 4 (try/except YAMLError + non-dict guards + stderr warnings) + Tasks 3 cases 7 & 8 (test verification)
  - Spec §Backward compatibility → Task 3 cases 1 & 2 + Task 4 (the `if os.path.isdir` guard)
  - Spec §Idempotency → Task 3 case 9
  - Spec §Implementation (env-overridable) → Task 2
  - Spec §Testing → Tasks 3 & 5
  - Spec §Documentation → Tasks 1 (overlays/README.md) & 6 (top-level README.md)
- **Placeholders:** No TBD, TODO, "add error handling later", or "similar to Task N" references. Every code block is complete.
- **Type/name consistency:** Function is `sync_mcp_servers_from_template` everywhere. Env var is `BOOTSTRAP_PYTHON_BIN` everywhere. Test file is `scripts/test-bootstrap-overlays.sh` everywhere. Branch is `story/84-mcp-overlay-support` everywhere.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-mcp-overlay-support.md`.

Tasks 1-6 each commit independently and produce a working state. Recommend **Inline Execution** (`superpowers:executing-plans`) for this plan since:
- It's a small, tightly-scoped change (~6 commits, all in one repo, no cross-cutting refactors)
- TDD red-green-refactor cycle is local and fast
- Reviewer benefits from seeing all commits together rather than across multiple subagent dispatches

If subagent-driven preferred: dispatch one subagent per task in order, reviewer (you) checks the diff between each.
