# Paperclip Hermes GBrain

Blank Coolify-ready template for running Paperclip with Hermes Agent and GBrain.

This repo is intentionally client-neutral. It should contain the deploy recipe only. Paperclip projects, Hermes profiles, GBrain stores, API keys, and client data are created at runtime inside the Coolify volume mounted at `/data`.

## Shape

```text
paperclip.<client-domain> -> paperclip:3100
hermes.<client-domain>    -> hermes:9119

Paperclip company → CEO agent → delegates to subordinate agents
       │
       ▼ each Paperclip agent uses adapterType: hermes_local
       │
       ▼
hermes CLI runs locally inside the paperclip container
       │
       ▼
       HERMES_HOME=/data/hermes/profiles/<company-role>   (per-agent profile)
       │
       ▼
gbrain CLI for memory + knowledge
       │
       ▼
       GBRAIN_HOME=/data/gbrain/<company-role>            (per-agent brain)
```

One image runs two services. Paperclip orchestrates; the Hermes dashboard serves the agent UI and transcript view. Both share `/data`, so memories, skills, and the org chart are visible from either side.

The Paperclip MCP server (see below) closes the loop: Hermes-side agents can file and update Paperclip issues without leaving the conversation.

## Services

- `paperclip` runs Paperclip on port `3100`.
- `hermes` runs the Hermes dashboard on port `9119`.
- Both services share the `paperclip-data` volume at `/data`.

## /data Volume Layout

Everything persistent lives under `/data`, mounted from the `paperclip-data` Docker volume.

| Path | What lives there |
|---|---|
| `/data/paperclip.db` | Paperclip's SQLite database (companies, agents, issues, approvals, runs) |
| `/data/instances/<company-slug>/` | Per-company project files, plan documents, attachments |
| `/data/hermes/` | Default Hermes profile (config, skills, kanban, memory) |
| `/data/hermes/profiles/<company-role>/` | Per-agent isolated Hermes profile (auto-created by profile-sync) |
| `/data/hermes/archive/` | Archived profiles for terminated agents (`PROFILE_SYNC_DELETE_MODE=archive`) |
| `/data/gbrain/default/` | Default GBrain home (reusable skills source) |
| `/data/gbrain/<company-role>/` | Per-agent isolated GBrain (memory, knowledge pages) |
| `/data/gbrain/archive/` | Archived GBrain homes for terminated agents |
| `/data/agent-stack/important-information-index.md` | Shared human-maintained index (see below) |
| `/data/agent-stack/learning-protocol.md` | Shared learning protocol (see below) |
| `/data/agent-stack/delegation-protocol.md` | Shared delegation contract (see below) |
| `/data/agent-stack/org-chart.{md,json}` | Mirrored Paperclip org chart (when profile-sync enabled) |
| `/data/agent-stack/profile-sync/manifest.json` | Profile-sync state (which agents got which slugs) |
| `/data/.paperclip/` | Paperclip CLI auth state (board user credentials) |

The Dockerfile clears `/data` at build time. Anything you see there at runtime was created after the container started.

## Local Smoke Test

```bash
cp .env.example .env
./scripts/local-up.sh
```

Then open:

- Paperclip: `http://localhost:3100`
- Hermes: `http://localhost:9119`

Stop it with:

```bash
./scripts/local-down.sh
```

## First-Run Flow

After the stack is deployed (locally or via Coolify) and the containers are running:

1. **Open Paperclip and claim the first admin user.** Paperclip runs in `PAPERCLIP_DEPLOYMENT_MODE=authenticated`. The first visitor to `https://paperclip.<your-domain>/` (or `http://localhost:3100/` locally) is prompted to claim the instance. If no claim flow appears, run `paperclipai auth bootstrap-ceo` inside the container to mint a one-time invite URL.

2. **Create or claim a company.** Each company is its own Paperclip workspace. Set a goal, name a CEO. The default Hermes agent is seeded automatically when profile-sync is enabled — otherwise see "Seed Default Hermes Agent" below.

3. **Mint a board API key.** From inside the container:

   ```bash
   docker compose --env-file .env exec paperclip paperclipai auth login --api-base http://127.0.0.1:3100
   ```

   The CLI prints an approval URL. Open it in a browser, sign in, click approve. The CLI then has a `pcp_board_*` token in hand.

4. **Set `PAPERCLIP_API_KEY` in env** (Coolify or local `.env`). This activates the Paperclip MCP server inside Hermes — without a key, every MCP tool call from Hermes will return 401.

5. **Optionally set `PROFILE_SYNC_ENABLED=1`** and `PAPERCLIP_PROFILE_SYNC_API_KEY=<same-key>` to give each Paperclip agent its own isolated Hermes profile and GBrain home (see "Profile Sync & Org Chart").

6. **Redeploy / restart** so the env changes land in the container.

7. **Talk to Hermes** via the dashboard (`https://hermes.<your-domain>/chat`) or any configured messaging gateway. Hermes can now call Paperclip tools — say *"list paperclip companies"* and the MCP server replies with the live roster.

## Coolify Setup

1. **Create a new Docker Compose app** in Coolify pointing at this GitHub repo (`leebaroneau/paperclip-hermes-gbrain`, branch `main`, base directory `/`).
2. **Wire up a GitHub source that can read this repo** (skip if the repo is public). Coolify's "Public GitHub" source can only clone public repos. For a private template, attach the app to a GitHub App installation that includes this repo:
   - In Coolify: app → *Source* → pick (or create) a GitHub App installation, and ensure the installation is granted access to this repo on GitHub.
   - Symptom of missing this step: deploy fails in ~0 seconds with `GitHub API call failed: Not Found` in the logs.
3. **Pick the public domains** you'll use:
   - `paperclip.<client-domain>`
   - `hermes.<client-domain>`
4. **Generate starter env values**:

   ```bash
   ./scripts/coolify-env.sh client.example.com
   ```

5. **Paste the generated values into Coolify**, replacing the example domain with the real client domain.
6. **Set per-service domains in the Coolify app UI.** Open the app → *Configuration* → set a domain for `paperclip` (`paperclip.<client-domain>`) and another for `hermes` (`hermes.<client-domain>`). Coolify uses this map to inject the working Traefik routers — the compose's own `${PAPERCLIP_HOSTNAME}` / `${HERMES_HOSTNAME}` placeholders are NOT substituted under Coolify (see "Coolify routing notes" below).

   If you only ever expose paperclip via the app's primary FQDN field, Coolify will auto-route paperclip but leave hermes at a 404 — the per-service domain map is the one easy step to miss.

7. **(Optional) Render brand-specific compose routes** if you'd rather hardcode the Traefik labels in a brand fork:

   ```bash
   ./scripts/render-coolify-compose.sh client.example.com client-agent-stack
   ```

8. **Deploy.** Then follow the First-Run Flow above to mint the API key and activate the MCP server.

### Coolify env variable checklist

**Required for any deployment:**

```env
PAPERCLIP_PUBLIC_URL=https://paperclip.<client-domain>
PAPERCLIP_ALLOWED_HOSTNAMES=paperclip.<client-domain>,localhost,127.0.0.1
PAPERCLIP_HOSTNAME=paperclip.<client-domain>
HERMES_HOSTNAME=hermes.<client-domain>
```

Public routing is configured separately via the Coolify per-service domain map (step 6 of *Setting Up A New Coolify Stack*) — not via env vars. The `PAPERCLIP_HOSTNAME` / `HERMES_HOSTNAME` pair is only used by the compose's own Traefik labels for plain `docker compose` deployments, which Coolify doesn't substitute (see "Coolify routing notes"). Keeping them set on a Coolify deploy is harmless and documents intent.

**Required to activate the Paperclip MCP server** (set after First-Run step 3 mints a key):

```env
PAPERCLIP_API_KEY=<pcp_board_...>
PAPERCLIP_DEFAULT_COMPANY_ID=<uuid>   # optional, single-company convenience
```

**Required to enable per-role profile sync:**

```env
PROFILE_SYNC_ENABLED=1
PROFILE_SYNC_INTERVAL_SEC=60
PROFILE_SYNC_DELETE_MODE=archive
PAPERCLIP_PROFILE_SYNC_API_KEY=<pcp_board_...>   # same key as PAPERCLIP_API_KEY is fine
```

**Do NOT add blank LLM provider keys** (`OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `OPENROUTER_API_KEY=`) to Coolify. Hermes boots without them; the first-run flow configures a provider via the dashboard at `hermes.<client-domain>/env`.

For single-VM deployments, profile-sync env can live in `/data/agent-stack/profile-sync/profile-sync.env` (root-readable) instead of Coolify env. Override `ORG_MIRROR_ROOT` only if you need the org chart files somewhere other than `/data/agent-stack`.

### Coolify routing notes

Coolify renders `docker-compose.yaml` with `$` escaped to `$$` inside the `labels:` block. That means `${PAPERCLIP_HOSTNAME}` / `${HERMES_HOSTNAME}` in the Traefik labels stay *literal* instead of being substituted — and the same is true for Coolify's own magic vars like `${SERVICE_FQDN_*}` when written into compose labels. Setting `SERVICE_FQDN_HERMES_9119` or `SERVICE_FQDN_HERMES` as an env var does NOT generate routing labels on its own.

What Coolify *does* read is the per-service domain map on the application resource. Set it via the UI (recommended) or the API:

1. **Coolify UI:** App → *Configuration* → set domain per service (`paperclip` → `paperclip.<your-domain>`, `hermes` → `hermes.<your-domain>`). Coolify auto-injects working Traefik routers (`http-0-<uuid>-<service>.rule=Host(\`...\`)`) at next deploy. The compose's own labels become no-ops but cost nothing.
2. **Coolify API:** `PATCH /api/v1/applications/<uuid>` with body `{"docker_compose_domains":{"paperclip":{"name":"paperclip","domain":"http://paperclip.<your-domain>"},"hermes":{"name":"hermes","domain":"http://hermes.<your-domain>"}}}`. Trigger a redeploy after — the change takes effect when the next deploy renders Traefik labels.

Symptom of missing this step: `paperclip.<your-domain>` works (Coolify routes the app's primary FQDN to the first compose service for free) but `hermes.<your-domain>` returns 404. `docker inspect <hermes-container> | grep traefik` shows either no routers or routers with literal `${VAR}` text — both mean the per-service map was never set.

## Paperclip MCP Server

The blank Hermes config is intentionally empty, with one exception: a Paperclip MCP server is wired in by default so Hermes agents in any new setup can file and track work in Paperclip through typed tool calls instead of constructing shell `curl` commands.

The server lives at `paperclip/mcp-paperclip/` and is baked into the image at `/opt/paperclip/mcp-paperclip/`. It is registered in `hermes-runtime/templates/config.yaml` under `mcp_servers.paperclip`, exposing eight tools to every Hermes profile:

```text
paperclip_list_companies
paperclip_create_issue
paperclip_list_issues
paperclip_get_issue
paperclip_update_issue
paperclip_comment_on_issue
paperclip_list_agents
paperclip_list_projects
```

Issues created this way show up in Paperclip's task board exactly like any other.

The server reads its credentials from container env in this order:

```text
PAPERCLIP_API_KEY              (preferred)
PAPERCLIP_PROFILE_SYNC_API_KEY (fallback)
```

If both are blank the server still starts but every tool call fails with an auth error. Mint a board key once Paperclip is reachable:

```bash
docker compose --env-file .env exec paperclip paperclipai auth login --api-base http://127.0.0.1:3100
```

That command prints an approval URL — open it in a browser, sign in, click approve. The CLI then stores a `pcp_board_*` token; copy it into Coolify env as `PAPERCLIP_API_KEY` and redeploy.

Optional convenience env: set `PAPERCLIP_DEFAULT_COMPANY_ID=<uuid>` so single-company setups don't need to pass `companyId` on every tool call.

Health check from inside the container:

```bash
docker compose --env-file .env exec paperclip node /opt/paperclip/mcp-paperclip/server.mjs \
  <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

A healthy server replies with `serverInfo: {"name":"paperclip","version":"0.1.0"}`.

### Propagation to existing profiles

When you (or an upstream update) add a new MCP server to `hermes-runtime/templates/config.yaml`, the `bootstrap-profiles.sh` entrypoint script idempotently merges any *missing* `mcp_servers.*` entries into every profile config on the next container start — both `HERMES_PROFILES`-listed profiles AND per-role profiles that `profile-sync.mjs` created at runtime under `/data/hermes/profiles/`. Existing entries are never overwritten, so per-profile customisations are preserved. New servers added to the template propagate to every Hermes profile automatically without a manual patch.

### Bundled skill: `using-paperclip`

The MCP server provides typed tools. The bundled `using-paperclip` Hermes skill provides *behaviour* — when and how agents should reach for those tools. It lives at `hermes-runtime/skills/using-paperclip/SKILL.md` and is symlinked into every Hermes profile's `skills/agent-stack/` directory by `bootstrap-profiles.sh` (same pattern as the upstream GBrain skills).

The skill teaches agents to:

- Check their assigned issues at task start via `paperclip_list_issues`
- Post status comments at meaningful milestones via `paperclip_comment_on_issue`
- File subtasks as child issues rather than burying them in a comment
- Use `@AgentName` mentions in comments to wake the right peer on blockers
- Mark issues `done` with a summary + GBrain page slug at finish

Without this skill, the MCP tools still work — but agents only call them when a user explicitly asks. With the skill, agents treat Paperclip issue tracking as a first-class part of their loop.

To add your own agent-stack-wide skills, drop a `SKILL.md` (with optional `references/`, `scripts/`, `assets/`) under `hermes-runtime/skills/<your-skill-name>/` and rebuild. The bootstrap sweep picks them up across every profile.

## Runtime Patches

The `paperclip` container's entrypoint runs three small Node patches against Paperclip's bundled npm package before starting the server. These rewrite a few lines in place each boot so the agent stack behaves correctly:

| Patch | What it changes |
|---|---|
| `patch-paperclip-hermes-defaults.mjs` | When Paperclip creates a `hermes_local` agent, inject `HERMES_MODEL` / `HERMES_PROVIDER` defaults from the Hermes profile config so newly-hired agents don't fall back to the bundled adapter's hardcoded Anthropic model. |
| `patch-hermes-adapter-env.mjs` | Unwrap Paperclip's env-binding objects when passing to the Hermes child process. Without this, `HERMES_HOME`, `GBRAIN_HOME`, and `PAPERCLIP_API_URL` reach Hermes as objects instead of strings. |
| `patch-paperclip-company-prefix.mjs` | Relax Paperclip's company URL-key prefix constraints to allow the slugs the agent stack uses. |

All three are idempotent and re-applied on every container start. If you upgrade Paperclip (`PAPERCLIP_VERSION` build arg), re-run the patch tests:

```bash
node paperclip/patch-paperclip-hermes-defaults.test.mjs
node paperclip/patch-hermes-adapter-env.test.mjs
node paperclip/patch-paperclip-company-prefix.test.mjs
```

## Seed Default Hermes Agent

`paperclip/seed-agents.mjs` ensures every Paperclip company has a default `Hermes` agent ready to receive work, using `adapterType: hermes_local`. Profile-sync invokes it automatically; you can also run it by hand:

```bash
PAPERCLIP_API_BASE=http://localhost:3100 \
PAPERCLIP_API_KEY=<pcp_board_...> \
PAPERCLIP_COMPANY_ID=<company-uuid> \
node paperclip/seed-agents.mjs
```

The script POSTs or PATCHes a single `Hermes` agent per company with:
- `runtimeConfig.heartbeat.enabled: false` (wake on demand, not on a timer)
- `adapterConfig.env` pointing to the company-specific `HERMES_HOME` and `GBRAIN_HOME` paths
- `capabilities` pointing the agent at the shared delegation protocol and org chart

Re-running is safe: existing agents are patched, not duplicated.

## GBrain Skills

GBrain skills are installed into Hermes profiles and GBrain homes through two separate paths — both fire automatically, you don't need to wire anything up.

**Bootstrap-time (every container start, every Hermes profile including `default`).**
The `paperclip` entrypoint runs `bootstrap-profiles.sh`, which for each profile in `HERMES_PROFILES` (just `default` out of the box) symlinks every skill from `/opt/gbrain/skills/` (baked into the image from the upstream GBrain repo) into:

```text
/data/hermes/skills/gbrain/<skill-name>            # default profile
/data/hermes/profiles/<company-role>/skills/gbrain/<skill-name>  # per-role
```

Because they're symlinks, upgrading GBrain (rebuilding the image with a newer `GBRAIN_REF`) makes every profile pick up the new skills with no manual intervention. Override the source path with `GBRAIN_SKILLS_SOURCE=/some/other/dir` if needed.

**Profile-sync-time (per-role GBrain home creation).**
When profile-sync provisions a new per-role GBrain home, it copies (NOT symlinks) these paths from `/data/gbrain/default/` into the new home so each role starts with the same skill set:

```text
skills/                   # user-installed GBrain skills
.gbrain/skills/           # internal GBrain skills
.gbrain/prompts/
.gbrain/conventions/
AGENTS.md, RESOLVER.md, gbrain.yml
```

User-added skills you drop into `/data/gbrain/default/skills/` after the stack is up are picked up by the next profile-sync iteration. The default GBrain database and knowledge pages are NOT copied — memory stays isolated per role.

## Profile Sync & Org Chart

The `paperclip` container can run an embedded reconciliation loop that mirrors Paperclip's roster into per-role Hermes profiles and GBrain homes. Enable it in env:

```env
PROFILE_SYNC_ENABLED=1
PROFILE_SYNC_INTERVAL_SEC=60
PROFILE_SYNC_DELETE_MODE=archive
PAPERCLIP_PROFILE_SYNC_API_KEY=<pcp_board_...>
```

Every `hermes_local` Paperclip agent gets:

```text
Hermes profile: /data/hermes/profiles/<company-role>
GBrain home:    /data/gbrain/<company-role>
```

The profile slug is stored on the Paperclip agent's metadata, so company or role renames don't move existing memories.

New profile homes inherit the default profile's reusable setup:
- `/data/hermes/*` is copied except runtime profile/archive/cache/log folders
- `/data/gbrain/default/skills` and `/data/gbrain/default/.gbrain/skills` are copied when present

The default GBrain database, config, and knowledge pages are **not** copied — reusable skills are shared, but memory stays isolated per role.

When an agent disappears from a successfully-scanned company:
- `archive` mode (default): folders move under `/data/hermes/archive/` and `/data/gbrain/archive/`
- `purge` mode: permanent deletion

**Org chart mirroring.** Each sync iteration also writes the current Paperclip org chart to:

```text
/data/agent-stack/org-chart.md     (human-readable, with reportsTo lines)
/data/agent-stack/org-chart.json   (machine-readable, consumed by agents)
```

The Delegation Protocol (below) tells agents to consult these before accepting, rerouting, or completing issues.

**Optional company scoping** (default: every company the key has access to):

```env
PAPERCLIP_COMPANY_IDS=co_123,co_456
PAPERCLIP_COMPANIES=co_123:Acme,co_456:Koenig
```

Run one sync manually from the running container:

```bash
docker compose --env-file .env exec paperclip node /opt/paperclip/profile-sync.mjs once
```

## Blank Image Audit

After a local build, audit the image before publishing or reusing it:

```bash
docker compose --env-file .env.example build
./scripts/audit-blank-image.sh paperclip-hermes-gbrain:blank
```

The audit fails if the image contains runtime state under `/data`, Lee/client deployment markers, Coolify build metadata, or token-looking secrets in image metadata.

## Runtime Data

The Dockerfile deliberately cleans `/data` during build. Runtime data appears only after a container starts with the `paperclip-data` volume mounted.

The default Hermes config is intentionally minimal — only the Paperclip MCP server is wired in (see the "Paperclip MCP Server" section above). The template bootstraps neutral profile files, installs GBrain skills into Hermes profiles, and creates a separate GBrain home for each synced role (see "Profile Sync & Org Chart" above).

## Scripts

Everything in `scripts/`:

| Script | What it does |
|---|---|
| `local-up.sh` / `local-down.sh` / `local-logs.sh` | Bring up, tear down, or stream logs from the local docker-compose stack. |
| `validate-env.sh` | Sanity-check `.env` for required keys and shape. Pass `--coolify` to enforce stricter rules for Coolify deployments. |
| `coolify-env.sh <domain>` | Generate a starter `.env` block for a brand domain. |
| `render-coolify-compose.sh <domain> <project-name>` | Render `compose.yaml` with brand-specific Traefik labels and routes. |
| `audit-blank-image.sh <image-tag>` | Inspect a built image for tokens, client data, runtime state under `/data`, or Coolify metadata leaks. |
| `test-blank-template.sh` | Verify the repo state is genuinely client-neutral (no committed `data/`, `instances/`, `.env`, etc.). |
| `test-default-profile-only.sh` | Assert no extra Hermes profiles bleed into the built image. |
| `test-hermes-tui-prebuilt.sh` | Confirm the Hermes TUI is prebuilt in the image (faster cold-start). |
| `test-no-provider-placeholders.sh` | Catch `OPENAI_API_KEY=` / `ANTHROPIC_API_KEY=` / `OPENROUTER_API_KEY=` empty rows that would break the Hermes `/env` first-run flow. |

Run the audit + tests after building a new image:

```bash
docker compose --env-file .env.example build
./scripts/audit-blank-image.sh paperclip-hermes-gbrain:blank
./scripts/test-blank-template.sh
./scripts/test-default-profile-only.sh
./scripts/test-hermes-tui-prebuilt.sh
./scripts/test-no-provider-placeholders.sh
```

## Important Information Index

Use this shared runtime file as the human-maintained index for important client information:

```text
/data/agent-stack/important-information-index.md
```

The `paperclip` service seeds the file if it does not already exist. It will not
overwrite an existing index.

Keep high-value pointers here: key Paperclip projects, source paths under `/data/instances`, role-specific GBrain pages, credentials locations, decisions, client conventions, and anything agents should check before starting broad work. The index should point to durable sources rather than duplicating large content.

## Learning Protocol

The stack includes a task-scoped learning protocol. It is not a background crawler
and it does not wire GBrain MCP into the blank Hermes config. Agents use the
existing `gbrain` CLI with their role-specific `GBRAIN_HOME`.

At container startup, the `paperclip` service installs the shared protocol into:

```text
/data/agent-stack/learning-protocol.md
```

It also mirrors the same protocol into the default Hermes profile at:

```text
/data/hermes/LEARNING_PROTOCOL.md
```

Synced role profile homes receive:

```text
/data/hermes/profiles/<company-role>/LEARNING_PROTOCOL.md
```

The learning loop is:

1. At task start, search/query the role's own GBrain.
2. Inspect only relevant Paperclip files under `/data/instances`.
3. Use `/data/agent-stack/important-information-index.md` for high-value pointers.
4. At task end, write concise durable learning into the role's own GBrain.
5. Leave the GBrain page slug in the Paperclip issue or final answer.

## Delegation Protocol

The stack includes a shared Paperclip/Hermes delegation protocol for multi-role teams.
At container startup, the `paperclip` service installs the protocol into the shared VM
volume at:

```text
/data/agent-stack/delegation-protocol.md
```

It also mirrors the same contract into the default Hermes profile at:

```text
/data/hermes/DELEGATION_PROTOCOL.md
```

When `seed-agents.mjs` creates the default Hermes agent, and when `profile-sync.mjs`
patches Paperclip `hermes_local` agents, each agent's `capabilities` field receives
a short pointer telling it to read the shared protocol and Paperclip org chart
before accepting, rerouting, creating, commenting on, or completing issues. New
Hermes profile homes also receive `DELEGATION_PROTOCOL.md` as a fallback copy.

To reset a local test install:

```bash
docker compose --env-file .env.example down -v
```

Do not commit generated runtime folders such as `data/`, `instances/`, `hermes/`, or `gbrain/`.
