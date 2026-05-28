#!/usr/bin/env bash
set -euo pipefail

image="${1:-}"

if [[ -z "$image" ]]; then
  echo "Usage: $0 <image-ref>" >&2
  echo "Example: $0 template-agent:local" >&2
  exit 64
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to audit an image." >&2
  exit 69
fi

failed=0

forbidden_pattern='(leebarone|haverford|alx-finance|paperclip\.leebarone\.dev|hermes\.leebarone\.dev|HERMES_BRIDGE_TOKEN|OPENAI_API_KEY=sk-|ANTHROPIC_API_KEY=sk-ant-|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY)'

metadata="$(
  docker image inspect "$image"
  docker history --no-trunc "$image"
)"

metadata_hits="$(printf '%s\n' "$metadata" | grep -E "$forbidden_pattern" || true)"
if [[ -n "$metadata_hits" ]]; then
  echo "Forbidden image metadata found:" >&2
  printf '%s\n' "$metadata_hits" >&2
  failed=1
fi

runtime_state="$(
  docker run --rm --entrypoint sh "$image" -lc '
    set -eu
    if [ -d /data ]; then
      find /data -mindepth 1 -maxdepth 4 -print
    fi
  '
)"

if [[ -n "$runtime_state" ]]; then
  echo "Runtime data found in image /data:" >&2
  printf '%s\n' "$runtime_state" >&2
  failed=1
fi

content_hits="$(
  docker run --rm --entrypoint sh "$image" -lc '
    grep -RInE "leebarone|haverford|alx-finance|paperclip\\.leebarone\\.dev|hermes\\.leebarone\\.dev|HERMES_BRIDGE_TOKEN" /opt/hermes-runtime /opt/paperclip /data 2>/dev/null || true
  '
)"

if [[ -n "$content_hits" ]]; then
  echo "Forbidden image file content found:" >&2
  printf '%s\n' "$content_hits" >&2
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "Blank image audit passed: $image"
