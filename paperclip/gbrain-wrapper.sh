#!/usr/bin/env bash
set -euo pipefail

cd /opt/gbrain
exec /usr/local/bin/bun run src/cli.ts "$@"
