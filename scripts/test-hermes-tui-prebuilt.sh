#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

dockerfile="paperclip/Dockerfile"
failed=0

expect() {
  local pattern="$1"
  local description="$2"

  if ! grep -nE "$pattern" "$dockerfile" >/tmp/agent-stack-tui-prebuilt.$$ 2>/dev/null; then
    echo "Missing Hermes TUI image requirement: $description" >&2
    failed=1
  fi
  rm -f /tmp/agent-stack-tui-prebuilt.$$
}

expect 'ENV HERMES_TUI_DIR=/usr/local/lib/hermes-agent/ui-tui' "set HERMES_TUI_DIR so Hermes uses the prebuilt TUI bundle instead of rebuilding at runtime"
expect 'cd "\$HERMES_SRC/ui-tui"' "build the Hermes TUI during image build"
expect 'npm run build' "create ui-tui/dist/entry.js during image build"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "Hermes TUI is prebuilt for runtime."
