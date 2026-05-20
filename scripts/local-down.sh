#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
docker compose -f compose.yaml -f compose.build.yaml --env-file .env down
