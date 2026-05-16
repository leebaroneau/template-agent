#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failed=0

check_absent() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if grep -nE "$pattern" "$file" >/tmp/paperclip-hermes-gbrain-blank-matches.$$ 2>/dev/null; then
    echo "Unexpected template content in $file: $description" >&2
    cat /tmp/paperclip-hermes-gbrain-blank-matches.$$ >&2
    failed=1
  fi
  rm -f /tmp/paperclip-hermes-gbrain-blank-matches.$$
}

for file in \
  ".env.example" \
  ".env.coolify.example" \
  "compose.yaml" \
  "paperclip/Dockerfile" \
  "paperclip/entrypoint.sh" \
  "paperclip/hermes-entrypoint.sh" \
  "hermes-runtime/templates/SOUL.default.md" \
  "scripts/coolify-env.sh" \
  "scripts/local-up.sh" \
  "scripts/render-coolify-compose.sh" \
  "scripts/validate-env.sh"; do
  check_absent "$file" 'hermes-ui|HERMES_UI' "service should be named hermes"
  check_absent "$file" 'Lee'\''s|leebarone|haverford|alx-finance|paperclip\.leebarone\.dev|hermes\.leebarone\.dev|HERMES_BRIDGE_TOKEN|SERVICE_FQDN_|SERVICE_URL_|COOLIFY_FQDN' "template should not include live client or deployment values"
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

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "Blank template checks passed."
