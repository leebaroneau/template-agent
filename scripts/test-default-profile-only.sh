#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failed=0

expect_contains() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if ! grep -nE "$pattern" "$file" >/tmp/agent-stack-default-profile-matches.$$ 2>/dev/null; then
    echo "Missing expected default-only profile setting in $file: $description" >&2
    failed=1
  fi
  rm -f /tmp/agent-stack-default-profile-matches.$$
}

expect_absent() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if grep -nE "$pattern" "$file" >/tmp/agent-stack-default-profile-matches.$$ 2>/dev/null; then
    echo "Unexpected role profile reference in $file: $description" >&2
    cat /tmp/agent-stack-default-profile-matches.$$ >&2
    failed=1
  fi
  rm -f /tmp/agent-stack-default-profile-matches.$$
}

role_profiles='(planner|coder|reviewer|operator)'

expect_contains "compose.yaml" 'HERMES_PROFILES: \$\{HERMES_PROFILES:-default\}' "compose should default to only the Hermes default profile"
expect_contains "scripts/coolify-env.sh" '^HERMES_PROFILES=default$' "generated Coolify env should seed only default"
expect_contains "hermes-runtime/scripts/bootstrap-profiles.sh" 'HERMES_PROFILES="\$\{HERMES_PROFILES:-default\}"' "bootstrap should create only default unless explicitly overridden"
expect_contains "paperclip/entrypoint.sh" 'HERMES_PROFILES="\$\{HERMES_PROFILES:-default\}"' "Paperclip runtime should default to only default"
expect_contains "paperclip/hermes-entrypoint.sh" 'HERMES_PROFILES="\$\{HERMES_PROFILES:-default\}"' "Hermes runtime should default to only default"
expect_contains "paperclip/seed-agents.mjs" "profile: 'default'" "seed script should create only the default-profile agent"
expect_contains "compose.yaml" 'HERMES_HOME: /data/hermes$' "compose should point default Hermes home at the Hermes root"
expect_contains "paperclip/Dockerfile" '^ENV HERMES_HOME=/data/hermes$' "image default Hermes home should be the Hermes root"
expect_contains "paperclip/entrypoint.sh" 'HERMES_HOME="\$\{HERMES_HOME:-\$HERMES_DATA_ROOT\}"' "Paperclip runtime should point default Hermes home at the Hermes root"
expect_contains "paperclip/hermes-entrypoint.sh" 'HERMES_HOME="\$\{HERMES_HOME:-\$HERMES_DATA_ROOT\}"' "Hermes runtime should point default Hermes home at the Hermes root"
expect_contains "paperclip/seed-agents.mjs" "profile === 'default'" "seeded default agent should special-case the default profile"
expect_contains "paperclip/seed-agents.mjs" "/data/hermes" "seeded default agent should point at the Hermes root"

for file in \
  ".env.example" \
  ".env.coolify.example" \
  "compose.yaml" \
  "scripts/coolify-env.sh" \
  "scripts/validate-env.sh" \
  "paperclip/entrypoint.sh" \
  "paperclip/hermes-entrypoint.sh" \
  "paperclip/seed-agents.mjs" \
  "hermes-runtime/scripts/bootstrap-profiles.sh"; do
  expect_absent "$file" "$role_profiles" "default stack should not mention role profile names"
done

for file in \
  "compose.yaml" \
  "paperclip/Dockerfile" \
  "paperclip/entrypoint.sh" \
  "paperclip/hermes-entrypoint.sh" \
  "paperclip/seed-agents.mjs"; do
  expect_absent "$file" 'profiles/default' "Hermes built-in default profile must be the root, not profiles/default"
done

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "Default profile only."
