#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

provider_keys='(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY)'
failed=0

check_absent() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if grep -nE "$pattern" "$file" >/tmp/agent-stack-placeholder-matches.$$ 2>/dev/null; then
    echo "Unexpected provider placeholder in $file: $description" >&2
    cat /tmp/agent-stack-placeholder-matches.$$ >&2
    failed=1
  fi
  rm -f /tmp/agent-stack-placeholder-matches.$$
}

check_absent ".env.example" "^${provider_keys}=" "fresh local env should not seed LLM keys"
check_absent ".env.coolify.example" "^${provider_keys}=" "fresh Coolify env should not seed LLM keys"
check_absent "scripts/coolify-env.sh" "^${provider_keys}=" "generated Coolify env should not seed LLM keys"
check_absent "compose.yaml" "${provider_keys}:[[:space:]]*\\$\\{${provider_keys}:-\\}" "compose should not inject blank provider env"
check_absent "hermes-runtime/scripts/bootstrap-profiles.sh" "printf '${provider_keys}=%s\\\\n' \"\\$\\{${provider_keys}:-\\}\"" "bootstrap should not write empty provider keys"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "No default provider placeholders found."
