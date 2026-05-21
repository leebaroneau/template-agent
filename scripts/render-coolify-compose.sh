#!/usr/bin/env bash
set -euo pipefail

domain="${1:-}"
route_id="${2:-template-agent}"

if [[ -z "$domain" ]]; then
  echo "Usage: $0 <root-domain> [route-id]" >&2
  echo "Example: $0 brand.example.com brand-agent-stack" >&2
  exit 1
fi

paperclip_fqdn="paperclip.${domain}"

if [[ ! "$route_id" =~ ^[a-zA-Z0-9-]+$ ]]; then
  echo "route-id may only contain letters, numbers, and hyphens." >&2
  exit 1
fi

PAPERCLIP_FQDN="$paperclip_fqdn" \
ROUTE_ID="$route_id" \
perl -0pi -e '
  my $paperclip = $ENV{PAPERCLIP_FQDN};
  my $route = $ENV{ROUTE_ID};

  s/http-[a-zA-Z0-9-]+-paperclip/http-$route-paperclip/g;
  s/(traefik\.http\.routers\.http-$route-paperclip\.rule=)Host\(`[^`]+`\)/$1Host(`$paperclip`)/g;
' compose.yaml

echo "Rendered compose routes:"
echo "  ${paperclip_fqdn} -> paperclip:3100"
echo "  Hermes dashboard is disabled by default; add a hermes service domain only when HERMES_DASHBOARD_ENABLED=1."
