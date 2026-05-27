# AGENTS.md

This repo is a blank Coolify deploy template for Paperclip and Hermes Agent.

Keep it client-neutral. Do not commit Paperclip instances, Hermes runtime profiles, API keys, client names, client domains, or Coolify deployment-specific values.

Do not add CI workflow steps that target a specific brand's deployment (Coolify API calls, brand webhooks, brand-specific secrets). Brands consume the published `:latest` tag and trigger their own deploys.

When changing the template, run:

```bash
npm test
docker compose --env-file .env.example config --services
```

When changing the image build, also run:

```bash
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.example build
./scripts/audit-blank-image.sh template-agent:local
```

## Runtime Operations (for agents debugging or configuring a live deployment)

### Connecting Hermes to Paperclip

Hermes communicates with Paperclip via the Paperclip MCP server. The connection requires a `pcp_board_*` API key. There is no API Keys page in the Paperclip UI — the only way to mint a key is via the CLI auth challenge flow (see README "Mint a board API key").

**Preferred way to activate the key** — write it to the shared volume so both services pick it up on every restart without a Coolify env var update:

```bash
# Run inside the paperclip container
KEY="pcp_board_<token>"
mkdir -p /data/agent-stack/profile-sync
sed -i '/^PAPERCLIP_API_KEY=/d; /^PAPERCLIP_PROFILE_SYNC_API_KEY=/d' \
  /data/agent-stack/profile-sync/profile-sync.env 2>/dev/null || true
printf 'PAPERCLIP_API_KEY=%s\nPAPERCLIP_PROFILE_SYNC_API_KEY=%s\n' "$KEY" "$KEY" \
  >> /data/agent-stack/profile-sync/profile-sync.env
```

Then restart the `hermes` container — it sources `profile-sync.env` at startup and picks up the key automatically.

### Profile-sync and the Org Chart

Profile-sync is **key-gated**: it starts automatically when `PAPERCLIP_PROFILE_SYNC_API_KEY` is present, skips silently when it is not. There is no separate enable flag to set.

Once running, profile-sync:
- Writes `/data/agent-stack/org-chart.md` and `org-chart.json` (updated every 60 s)
- Injects an org chart pointer into each agent's Paperclip capabilities field
- Creates per-agent isolated Hermes profiles

Agents read `/data/agent-stack/org-chart.md` to resolve delegation targets. The `delegation-protocol.md` is seeded to every Hermes profile by `bootstrap-profiles.sh` and references this path.

Set `PROFILE_SYNC_ENABLED=0` only to explicitly disable profile-sync (e.g. local dev without a running Paperclip).

### Do NOT override `PAPERCLIP_ALLOWED_HOSTNAMES` in Coolify

The compose builds this value automatically as `paperclip,localhost,127.0.0.1,<PAPERCLIP_HOSTNAME>`. Overriding it via a Coolify env var strips the internal Docker service names and causes every Hermes→Paperclip API call to return `403 Hostname '...' is not allowed`. Leave it unset in Coolify.

### Do NOT override `PAPERCLIP_API_BASE` for the hermes service in Coolify

The default (`http://paperclip:3100`) is the correct Docker Compose internal address. Overriding it to the public URL adds an unnecessary TLS hop and is only needed if Paperclip and Hermes are on separate hosts.

<!-- pipeline-core-agent-instructions:start -->
## Pipeline Core Repo Ownership

This repo owns the code in this checkout. All GitHub issues, branches, commits, and PRs for work in this repo must be created in this repository.

Do not create tracking issues or implementation PRs in `lee-dashboard` unless the change is dashboard-owned. If an agent starts from `lee-dashboard` context, it must first resolve the owner repo, then run GitHub commands with `--repo <owner>/<repo>` or work from this checkout.

Pipeline Core workflow:
1. Create the GitHub issue first with a `type:` label and a human-readable title prefix such as `Task:`, `Bug:`, or `Feature request:`.
2. Branch as `<type>/<issue-number>-<slug>`, for example `task/123-update-agent-routing`.
3. Open the PR with `Fixes #<issue-number>` in the body.
<!-- pipeline-core-agent-instructions:end -->
