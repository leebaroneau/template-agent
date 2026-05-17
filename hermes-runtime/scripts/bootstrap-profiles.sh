#!/usr/bin/env bash
set -euo pipefail

HERMES_DATA_ROOT="${HERMES_DATA_ROOT:-/opt/data/hermes}"
GBRAIN_DATA_ROOT="${GBRAIN_DATA_ROOT:-/opt/data/gbrain}"
HERMES_PROFILES="${HERMES_PROFILES:-default}"
TEMPLATE_DIR="/opt/hermes-runtime/templates"

mkdir -p "$HERMES_DATA_ROOT/profiles" "$GBRAIN_DATA_ROOT"

write_env_file() {
  local env_file="$1"

  if [[ -f "$env_file" ]]; then
    return 0
  fi

  if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${OPENROUTER_API_KEY:-}" ]]; then
    return 0
  fi

  umask 077
  {
    [[ -n "${OPENAI_API_KEY:-}" ]] && printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY"
    [[ -n "${ANTHROPIC_API_KEY:-}" ]] && printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY"
    [[ -n "${OPENROUTER_API_KEY:-}" ]] && printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY"
  } > "$env_file"
}

install_gbrain_skills() {
  local profile_home="$1"
  local gbrain_source="${GBRAIN_SKILLS_SOURCE:-/opt/gbrain/skills}"
  local gbrain_dest="$profile_home/skills/gbrain"

  if [[ ! -d "$gbrain_source" ]]; then
    return 0
  fi

  mkdir -p "$gbrain_dest"
  for skill_dir in "$gbrain_source"/*; do
    [[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || continue
    local name
    name="$(basename "$skill_dir")"
    if [[ -e "$gbrain_dest/$name" && ! -L "$gbrain_dest/$name" ]]; then
      continue
    fi
    ln -sfn "$skill_dir" "$gbrain_dest/$name"
  done
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
# Hermes profile's skills/agent-stack/ directory. Mirrors install_gbrain_skills
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

# Idempotently add any mcp_servers entries that exist in the template config
# but are missing from this profile's config. Existing entries are NEVER
# overwritten, so user customisations (different command path, disabled flag,
# extra fields) are preserved. New top-level keys added to the template
# (e.g. paperclip MCP server) are inherited by existing profiles on next boot.
#
# Uses Hermes' bundled Python interpreter for PyYAML.
sync_mcp_servers_from_template() {
  local profile_config="$1"
  local template_config="$TEMPLATE_DIR/config.yaml"
  local python_bin="/usr/local/lib/hermes-agent/venv/bin/python"

  if [[ ! -f "$profile_config" || ! -f "$template_config" || ! -x "$python_bin" ]]; then
    return 0
  fi

  "$python_bin" - "$template_config" "$profile_config" <<'PYEOF'
import sys
import yaml

template_path, profile_path = sys.argv[1], sys.argv[2]

with open(template_path) as f:
    template = yaml.safe_load(f) or {}

with open(profile_path) as f:
    profile = yaml.safe_load(f) or {}

template_mcp = template.get("mcp_servers") or {}
if not template_mcp:
    sys.exit(0)

profile_mcp = profile.get("mcp_servers") or {}
added = []
for name, spec in template_mcp.items():
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
  gbrain_home="$GBRAIN_DATA_ROOT/$profile"

  mkdir -p "$profile_home" "$gbrain_home"

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

  write_env_file "$profile_home/.env"
  install_gbrain_skills "$profile_home"
  install_hermes_bundled_skills "$profile_home"
  install_agent_stack_skills "$profile_home"

  if [[ ! -f "$gbrain_home/.gbrain/config.json" ]]; then
    GBRAIN_HOME="$gbrain_home" gbrain init --pglite
    GBRAIN_HOME="$gbrain_home" gbrain config set search.mode conservative >/dev/null 2>&1 || true
  fi
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
  done
fi
