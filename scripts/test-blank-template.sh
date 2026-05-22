#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failed=0

check_absent() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if grep -nE "$pattern" "$file" >/tmp/template-agent-blank-matches.$$ 2>/dev/null; then
    echo "Unexpected template content in $file: $description" >&2
    cat /tmp/template-agent-blank-matches.$$ >&2
    failed=1
  fi
  rm -f /tmp/template-agent-blank-matches.$$
}

check_present() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if ! grep -nE "$pattern" "$file" >/tmp/template-agent-present-matches.$$ 2>/dev/null; then
    echo "Missing expected template content in $file: $description" >&2
    failed=1
  fi
  rm -f /tmp/template-agent-present-matches.$$
}

for file in \
  ".env.example" \
  ".env.coolify.example" \
  "compose.yaml" \
  "paperclip/Dockerfile" \
  "paperclip/entrypoint.sh" \
  "paperclip/hermes-entrypoint.sh" \
  ".github/workflows/build-image.yml" \
  "hermes-runtime/templates/SOUL.default.md" \
  "scripts/coolify-env.sh" \
  "scripts/local-up.sh" \
  "scripts/render-coolify-compose.sh" \
  "scripts/validate-env.sh"; do
  check_absent "$file" 'hermes-ui|HERMES_UI' "service should be named hermes"
  check_absent "$file" 'Lee'\''s|\bleebarone\b|haverford|alx-finance|paperclip\.leebarone\.dev|hermes\.leebarone\.dev|HERMES_BRIDGE_TOKEN|SERVICE_FQDN_|SERVICE_URL_|COOLIFY_FQDN' "template should not include live client or deployment values"
  check_absent "$file" 'AGENT_STACK_''IMAGE|paperclip-hermes-''gbrain' "template should not reference legacy registry image identity"
done

for expected in \
  "^data/$" \
  "^instances/$" \
  "^gbrain/$" \
  "^hermes/$"; do
  if ! grep -nE "$expected" .dockerignore >/dev/null 2>&1; then
    echo ".dockerignore should exclude runtime path matching $expected" >&2
    failed=1
  fi
done

# The blank Hermes config now ships with two intentional defaults documented
# in README ("The blank Hermes config is intentionally empty, with one
# exception: a Paperclip MCP server is wired in by default"):
#   - mcp_servers.paperclip  -> Hermes profiles can file Paperclip issues
#   - memory:*               -> shared memory/profile sizing defaults
# Guard against OTHER kinds of defaults sneaking in (terminal / dashboard /
# skills opinions, client-specific creds), and assert the documented MCP
# default stays declared.
check_absent "hermes-runtime/templates/config.yaml" 'terminal:|dashboard:|^skills:' "blank Hermes config should not ship runtime-opinion defaults"

if ! grep -nE '^mcp_servers:[[:space:]]*$' hermes-runtime/templates/config.yaml >/dev/null 2>&1; then
  echo "hermes-runtime/templates/config.yaml should declare the default Paperclip MCP server (see README)." >&2
  failed=1
fi

if ! grep -nE 'COPY paperclip/learning-protocol\.md /opt/paperclip/learning-protocol\.md' paperclip/Dockerfile >/dev/null 2>&1; then
  echo "Dockerfile should copy the learning protocol into the image." >&2
  failed=1
fi

if ! grep -nE 'COPY paperclip/important-information-index\.md /opt/paperclip/important-information-index\.md' paperclip/Dockerfile >/dev/null 2>&1; then
  echo "Dockerfile should copy the important information index seed into the image." >&2
  failed=1
fi

if ! grep -nE '/data/agent-stack/learning-protocol\.md' paperclip/entrypoint.sh >/dev/null 2>&1; then
  echo "Paperclip entrypoint should mirror the learning protocol into /data." >&2
  failed=1
fi

if ! grep -nE '/data/agent-stack/important-information-index\.md' paperclip/entrypoint.sh >/dev/null 2>&1; then
  echo "Paperclip entrypoint should seed the important information index into /data." >&2
  failed=1
fi

check_present "hermes-runtime/skills/use-100m-framework/SKILL.md" '^name: use-100m-framework$' "bundled 100m application skill should exist"
check_present "hermes-runtime/skills/use-100m-framework/SKILL.md" '100m-field-learning' "100m skill should define field-learning proposal capture"
check_present "hermes-runtime/skills/use-100m-framework/SKILL.md" 'Do not edit shared framework doctrine directly' "company profiles should not mutate shared doctrine"
check_present "paperclip/learning-protocol.md" 'type: 100m-field-learning' "canonical learning protocol should define 100m field-learning pages"
check_present "hermes-runtime/templates/LEARNING_PROTOCOL.md" 'type: 100m-field-learning' "profile fallback learning protocol should define 100m field-learning pages"
check_present "README.md" '100M Framework Learning Loop' "README should link the framework learning loop operations doc"
check_present "hermes-runtime/skills/use-eos-framework/SKILL.md" '^name: use-eos-framework$' "bundled EOS application skill should exist"
check_present "hermes-runtime/skills/use-eos-framework/SKILL.md" 'eos-field-learning' "EOS skill should define field-learning proposal capture"
check_present "hermes-runtime/skills/use-eos-framework/SKILL.md" 'paperclip_create_issue' "EOS skill should use Paperclip issue creation"
check_present "hermes-runtime/skills/use-eos-framework/SKILL.md" 'use-100m-framework' "EOS skill should compose with the 100m framework"
check_present "hermes-runtime/skills/use-eos-framework/SKILL.md" 'routine setup issue' "EOS skill should avoid claiming unavailable routine creation"
check_present "paperclip/learning-protocol.md" 'type: eos-field-learning' "canonical learning protocol should define EOS field-learning pages"
check_present "hermes-runtime/templates/LEARNING_PROTOCOL.md" 'type: eos-field-learning' "profile fallback learning protocol should define EOS field-learning pages"
check_present "README.md" 'EOS Framework Runtime Skill' "README should document the EOS runtime skill"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "Blank template checks passed."
