#!/usr/bin/env bash
set -euo pipefail

HERMES_DATA_ROOT="${HERMES_DATA_ROOT:-/opt/data/hermes}"
HERMES_PROFILES="${HERMES_PROFILES:-default}"
TEMPLATE_DIR="${TEMPLATE_DIR:-/opt/hermes-runtime/templates}"

mkdir -p "$HERMES_DATA_ROOT/profiles"

# Ensure the profile .env file exists. Provider keys (ANTHROPIC_API_KEY,
# OPENAI_API_KEY, OPENROUTER_API_KEY) are intentionally NOT written here —
# they are inherited from the container env at runtime so that rotating a key
# in Coolify takes effect on the next redeploy without touching volume files.
ensure_env_file() {
  local env_file="$1"
  umask 077
  touch "$env_file"
}

# Remove hardcoded provider keys from a profile .env so they fall through to
# the container env. Called on every boot — idempotent.
strip_provider_keys() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  sed -i '/^ANTHROPIC_API_KEY=/d;/^OPENAI_API_KEY=/d;/^OPENROUTER_API_KEY=/d' "$env_file"
}


install_hermes_bundled_skills() {
  local profile_home="$1"
  local src="${HERMES_BUNDLED_SKILLS_SOURCE:-/usr/local/lib/hermes-agent/skills}"

  if [[ ! -d "$src" ]]; then
    return 0
  fi

  mkdir -p "$profile_home/skills"
  for skill_dir in "$src"/*; do
    [[ -d "$skill_dir" ]] || continue
    local name
    name="$(basename "$skill_dir")"
    # Skip if a non-symlink already exists (Hermes lazy-installed or user-modified)
    if [[ -e "$profile_home/skills/$name" && ! -L "$profile_home/skills/$name" ]]; then
      continue
    fi
    ln -sfn "$skill_dir" "$profile_home/skills/$name"
  done
}

# Symlink agent-stack-shipped skills (e.g. using-paperclip) into every
# Hermes profile's skills/agent-stack/ directory.
# pattern. Source dir is baked into the image at /opt/hermes-runtime/skills/.
install_agent_stack_skills() {
  local profile_home="$1"
  local source="${AGENT_STACK_SKILLS_SOURCE:-/opt/hermes-runtime/skills}"
  local dest="$profile_home/skills/agent-stack"

  if [[ ! -d "$source" ]]; then
    return 0
  fi

  mkdir -p "$dest"
  for skill_dir in "$source"/*; do
    [[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || continue
    local name
    name="$(basename "$skill_dir")"
    if [[ -e "$dest/$name" && ! -L "$dest/$name" ]]; then
      continue
    fi
    ln -sfn "$skill_dir" "$dest/$name"
  done
}

# Idempotently reconcile mcp_servers between the effective template
# (canonical + brand overlays) and a profile's config. Conservative —
# manual customisations are preserved.
#
# Two operations:
#   1. ADD-NEW: entries present in the effective template but missing from
#      the profile are copied verbatim. New MCP servers added to the
#      canonical template OR a brand overlay reach existing profiles on
#      next boot.
#   2. MERGE-ENV: for entries that exist in BOTH the effective template
#      and the profile, any env keys defined in the template's env: block
#      but MISSING from the profile's env: block are added. Existing env
#      values are never overwritten. This closes the gap where a template
#      fix (e.g. adding PAPERCLIP_API_KEY to the paperclip MCP env block)
#      would otherwise never reach existing profiles.
#
# Non-env fields (command, args, timeout, custom keys) on existing entries
# are still NEVER touched — manually edited entries keep their changes.
#
# Merge semantics (strictly additive at both layers):
#   - Canonical template wins over any overlay on key collision.
#   - Among overlays, alphabetic-first filename wins on collision.
#   - Profile wins over the effective (canonical + overlays) template,
#     except for missing env keys on entries that exist in both.
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
added_entries = []
merged_env = {}  # name -> list of env keys added

for name, spec in effective_mcp.items():
    if name not in profile_mcp:
        profile_mcp[name] = spec
        added_entries.append(name)
        continue

    # Merge missing env keys onto existing entry. Never overwrite.
    template_env = (spec or {}).get("env") or {}
    if not isinstance(template_env, dict) or not template_env:
        continue

    existing_entry = profile_mcp[name]
    if not isinstance(existing_entry, dict):
        continue

    existing_env = existing_entry.get("env") or {}
    if not isinstance(existing_env, dict):
        existing_env = {}

    added_keys = []
    for env_key, env_val in template_env.items():
        if env_key not in existing_env:
            existing_env[env_key] = env_val
            added_keys.append(env_key)

    if added_keys:
        existing_entry["env"] = existing_env
        merged_env[name] = added_keys

if not added_entries and not merged_env:
    pass  # continue to check other blocks below
else:
    profile["mcp_servers"] = profile_mcp

# ── Sync additional template blocks (additive only, profile wins on collision) ──

changed = bool(added_entries or merged_env)

def set_if_absent(d, key, value):
    """Set key in dict d only if absent or empty/null. Returns True if changed."""
    if key not in d or d[key] is None or d[key] == '' or d[key] == {}:
        d[key] = value
        return True
    return False

def deep_merge_missing(base, additions):
    """Recursively add keys from additions into base where absent. Returns True if changed."""
    c = False
    for k, v in additions.items():
        if k not in base or base[k] is None or base[k] == '':
            base[k] = v
            c = True
        elif isinstance(v, dict) and isinstance(base.get(k), dict):
            c = deep_merge_missing(base[k], v) or c
    return c

# memory.provider — set if absent/empty
tmpl_mem = template.get("memory") or {}
if tmpl_mem.get("provider"):
    profile_mem = profile.setdefault("memory", {})
    if not isinstance(profile_mem, dict):
        profile_mem = {}
        profile["memory"] = profile_mem
    if set_if_absent(profile_mem, "provider", tmpl_mem["provider"]):
        changed = True

# plugins — deep merge missing keys
tmpl_plugins = template.get("plugins")
if tmpl_plugins and isinstance(tmpl_plugins, dict):
    profile_plugins = profile.setdefault("plugins", {})
    if not isinstance(profile_plugins, dict):
        profile_plugins = {}
        profile["plugins"] = profile_plugins
    if deep_merge_missing(profile_plugins, tmpl_plugins):
        changed = True

# context — set if absent
tmpl_ctx = template.get("context")
if tmpl_ctx and isinstance(tmpl_ctx, dict):
    if "context" not in profile or not isinstance(profile.get("context"), dict):
        profile["context"] = tmpl_ctx
        changed = True

# compression — set if absent
tmpl_comp = template.get("compression")
if tmpl_comp and isinstance(tmpl_comp, dict):
    if "compression" not in profile:
        profile["compression"] = tmpl_comp
        changed = True

# prompt_caching — set if absent
tmpl_pc = template.get("prompt_caching")
if tmpl_pc and isinstance(tmpl_pc, dict):
    if "prompt_caching" not in profile:
        profile["prompt_caching"] = tmpl_pc
        changed = True

# security — deep merge scalar keys; denylist is additive (union)
tmpl_sec = template.get("security")
if tmpl_sec and isinstance(tmpl_sec, dict):
    profile_sec = profile.setdefault("security", {})
    if not isinstance(profile_sec, dict):
        profile_sec = {}
        profile["security"] = profile_sec
    # Scalar security keys
    for sec_key in ("allow_private_urls", "redact_secrets", "tirith_enabled"):
        if sec_key in tmpl_sec and sec_key not in profile_sec:
            profile_sec[sec_key] = tmpl_sec[sec_key]
            changed = True
    # approval.denylist — additive union
    tmpl_approval = tmpl_sec.get("approval") or {}
    tmpl_denylist = tmpl_approval.get("denylist") or []
    if tmpl_denylist:
        profile_approval = profile_sec.setdefault("approval", {})
        if not isinstance(profile_approval, dict):
            profile_approval = {}
            profile_sec["approval"] = profile_approval
        existing_dl = profile_approval.get("denylist") or []
        if not isinstance(existing_dl, list):
            existing_dl = []
        added_dl = [e for e in tmpl_denylist if e not in existing_dl]
        if added_dl:
            profile_approval["denylist"] = existing_dl + added_dl
            changed = True

if not changed:
    sys.exit(0)

with open(profile_path, "w") as f:
    yaml.safe_dump(profile, f, sort_keys=False)

if added_entries:
    print(f"[bootstrap] added mcp_servers to {profile_path}: {', '.join(added_entries)}", file=sys.stderr)
for name, keys in merged_env.items():
    print(f"[bootstrap] merged env keys onto {name} in {profile_path}: {', '.join(keys)}", file=sys.stderr)
PYEOF
}

IFS=',' read -ra profiles <<< "$HERMES_PROFILES"
for raw_profile in "${profiles[@]}"; do
  profile="$(echo "$raw_profile" | tr '[:upper:]' '[:lower:]' | xargs)"
  if [[ -z "$profile" ]]; then
    continue
  fi
  if [[ ! "$profile" =~ ^[a-z0-9_-]+$ ]]; then
    echo "Invalid profile: $profile" >&2
    exit 1
  fi

  if [[ "$profile" == "default" ]]; then
    profile_home="$HERMES_DATA_ROOT"
  else
    profile_home="$HERMES_DATA_ROOT/profiles/$profile"
  fi

  mkdir -p "$profile_home"

  if [[ ! -f "$profile_home/config.yaml" ]]; then
    cp "$TEMPLATE_DIR/config.yaml" "$profile_home/config.yaml"
  else
    sync_mcp_servers_from_template "$profile_home/config.yaml"
  fi

  if [[ ! -f "$profile_home/SOUL.md" ]]; then
    if [[ -f "$TEMPLATE_DIR/SOUL.$profile.md" ]]; then
      cp "$TEMPLATE_DIR/SOUL.$profile.md" "$profile_home/SOUL.md"
    else
      cp "$TEMPLATE_DIR/SOUL.default.md" "$profile_home/SOUL.md"
    fi
  fi

  if [[ ! -f "$profile_home/DELEGATION_PROTOCOL.md" && -f "$TEMPLATE_DIR/DELEGATION_PROTOCOL.md" ]]; then
    cp "$TEMPLATE_DIR/DELEGATION_PROTOCOL.md" "$profile_home/DELEGATION_PROTOCOL.md"
  fi

  if [[ ! -f "$profile_home/LEARNING_PROTOCOL.md" && -f "$TEMPLATE_DIR/LEARNING_PROTOCOL.md" ]]; then
    cp "$TEMPLATE_DIR/LEARNING_PROTOCOL.md" "$profile_home/LEARNING_PROTOCOL.md"
  fi

  ensure_env_file "$profile_home/.env"
  strip_provider_keys "$profile_home/.env"
  # Inject PROFILE_NAME so the profile can self-reference without hardcoding its name.
  # Idempotent — only appends if the key is absent.
  if ! grep -q "^PROFILE_NAME=" "$profile_home/.env" 2>/dev/null; then
    echo "PROFILE_NAME=$profile" >> "$profile_home/.env"
  fi
  install_hermes_bundled_skills "$profile_home"
  install_agent_stack_skills "$profile_home"
done

# Sweep any profile homes profile-sync may have created at runtime (per-role
# Hermes profiles for Paperclip agents). Each gets the same MCP-server merge
# pass and the agent-stack skill symlinks so new template entries and new
# bundled skills propagate without manual patching.
if [[ -d "$HERMES_DATA_ROOT/profiles" ]]; then
  for runtime_profile_home in "$HERMES_DATA_ROOT"/profiles/*/; do
    [[ -d "$runtime_profile_home" ]] || continue
    [[ -f "$runtime_profile_home/config.yaml" ]] || continue
    sync_mcp_servers_from_template "$runtime_profile_home/config.yaml"
    install_agent_stack_skills "$runtime_profile_home"
    strip_provider_keys "$runtime_profile_home/.env"
  done
fi
