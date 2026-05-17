# Paperclip Hermes GBrain

Blank Coolify-ready template for running Paperclip with Hermes Agent and GBrain.

This repo is intentionally client-neutral. It should contain the deploy recipe only. Paperclip projects, Hermes profiles, GBrain stores, API keys, and client data are created at runtime inside the Coolify volume mounted at `/data`.

## ⚠️ For Agents (Claude, Codex, any LLM editing this repo) — Read First

This is a **template deployed to multiple companies simultaneously** from a single image.

| Deploy | Coolify host | Watches |
| --- | --- | --- |
| **ALX Finance** | `https://coolify.alxfinance.com.au` | `ALX-Finance/paperclip-hermes-gbrain` @ `main` |
| **Leebarone** | `https://coolify.leebarone.dev` | `leebaroneau/paperclip-hermes-gbrain` @ `deploy/leebarone.dev` |
| **Genvest** | `http://209.38.27.69:8000` | `leebaroneau/paperclip-hermes-gbrain` @ `main` |

All three pull the **same image**: `ghcr.io/leebaroneau/paperclip-hermes-gbrain:latest` (rebuilt by `.github/workflows/build-image.yml` on every push to `main`).

**Rules for any change you propose:**

- A push to a watched branch redeploys **every Coolify watching that branch — simultaneously**. Treat every commit as a multi-tenant change.
- Per-company customization lives in **Coolify env vars only** (`PAPERCLIP_HOSTNAME`, `HERMES_HOSTNAME`, `PAPERCLIP_API_KEY`, `PAPERCLIP_DEFAULT_COMPANY_ID`, `HERMES_PROFILES`, `PROFILE_SYNC_ENABLED`, …) — **never** introduce per-brand branches or hard-coded brand specifics in `compose.yaml`.
- Hermes basic-auth hash in `compose.yaml` is shared across all deploys (same plaintext password, hash is irreversible). Rotating it is a single commit on `main` → all three Coolifies pick it up on next deploy.
- Data volumes are per-Coolify-app (`<app_uuid>_paperclip-data`). Image swaps preserve data; only `docker volume rm` destroys it.
- When asked "add feature X for one company," gate it behind an env var; do **not** fork or branch the compose.

If you would be tempted to add a feature, env var, or compose section that only one brand needs — **stop and ask the user first.** The unified-branch architecture is deliberate.

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

1. **Open Paperclip and claim the first admin user.** Paperclip runs in `PAPERCLIP_DEPLOYMENT_MODE=authenticated`. The first visitor to `https://paperclip.<your-domain>/` (or `http://localhost:3100/` locally) is prompted to claim the instance.

   > ⚠️ **Save the email + password you set on this screen into a password manager *before* you click submit.** There is no email-based password reset in this stack (no SMTP is configured by default). If you lose those credentials, see "Lost admin access?" below.

   If no claim flow appears at all (e.g. an admin was already created but the invite link expired before being used), open a shell in the container and mint a fresh one-time invite URL:

   ```bash
   # From the Coolify host, or via `coolify exec`:
   docker exec -u node -it <paperclip-container> \
     paperclipai auth bootstrap-ceo \
     --data-dir /data \
     --base-url https://paperclip.<your-domain> \
     --force
   ```

   The CLI prints `Invite URL: https://paperclip.<your-domain>/invite/<token>` (expires in 72 hours). Open it in a browser to create the admin.

   **Lost admin access?** Same command. `--force` revokes any previous bootstrap invite and issues a new one even if an `instance_admin` already exists. The original admin row stays in the DB but you can sign in via the new invite and demote/remove it.

2. **Create or claim a company.** Each company is its own Paperclip workspace. Set a goal, name a CEO. The default Hermes agent is seeded automatically when profile-sync is enabled — otherwise see "Seed Default Hermes Agent" below.

3. **Mint a board API key.**

   > ⚠️ **There is no "API Keys" page in the Paperclip dashboard.** The only way to create a `pcp_board_*` token is via the CLI flow below. You'll need this token for `PAPERCLIP_API_KEY` (and `PAPERCLIP_PROFILE_SYNC_API_KEY` if you enable profile sync).

   **Option A — From inside the running container** (Coolify Terminal, `docker exec`, or your local compose):

   ```bash
   docker compose --env-file .env exec paperclip paperclipai auth login --api-base http://127.0.0.1:3100
   ```

   **Option B — Drive the API directly from anywhere** (no container shell needed). The CLI just wraps two HTTP calls:

   ```bash
   # 1. Create a challenge — note the boardApiToken and approvalUrl in the response.
   curl -s -X POST https://paperclip.<your-domain>/api/cli-auth/challenges \
     -H "Content-Type: application/json" \
     -d '{"command":"manual","clientName":"manual","requestedAccess":"board","requestedCompanyId":null}'

   # 2. Open `approvalUrl` in your browser, sign in as the admin from step 1, click Approve.

   # 3. Poll until the challenge flips to status="approved":
   curl -s "https://paperclip.<your-domain>/api/cli-auth/challenges/<id>?token=<challenge-token>"
   ```

   Once approved, the `boardApiToken` from step 1 is your live `pcp_board_*` key. **Copy it now into a password manager — the API does not let you retrieve it again later.** Mint additional keys anytime by repeating either flow.

4. **Set `PAPERCLIP_API_KEY=<pcp_board_…>` in env** (Coolify → app → Environment Variables, or local `.env`). This activates the Paperclip MCP server inside Hermes — without a key, every MCP tool call from Hermes will return 401.

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

### Auto-deploy from `main`

[`.github/workflows/build-image.yml`](.github/workflows/build-image.yml) rebuilds and pushes `ghcr.io/leebaroneau/paperclip-hermes-gbrain:latest` on every push to `main` that touches `paperclip/**`, `hermes-runtime/**`, or the workflow file itself. After the image push the workflow makes three HTTP calls to `/api/v1/deploy?uuid=<app-uuid>` on each Coolify (ALX, Leebarone, Genvest) so they pull the new image and recreate containers.

Per-deployment credentials live in this repo's GitHub Actions config (Settings → Secrets and variables → Actions):

| Deployment | `vars.COOLIFY_*_BASE_URL` | `vars.COOLIFY_*_APP_UUID` | `secrets.COOLIFY_*_TOKEN` |
| --- | --- | --- | --- |
| ALX | `https://coolify.alxfinance.com.au` | ALX app uuid | ALX Coolify API token |
| Leebarone | `https://coolify.leebarone.dev` | Leebarone app uuid | Leebarone token |
| Genvest | `http://209.38.27.69:8000` | Genvest app uuid | Genvest token |

Each trigger is conditional on the corresponding vars+secret being non-empty, so a deployment that hasn't been registered is silently skipped (not failed).

### Recovering from a stuck deploy

The default `force=false` lets Coolify skip a deploy if it thinks the app is already up-to-date. That skip check can race the GHCR manifest push, leaving live containers on the previous `:latest` even after the workflow runs green. Telltale signs:

- `docker inspect <container> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'` shows an old commit SHA.
- New env vars from a fresh PR are missing inside the container.
- A line you just added to a baked-in file (e.g. `paperclip/profile-sync.mjs`) is not present at `/opt/paperclip/profile-sync.mjs`.

To force every Coolify to recreate regardless of its skip check, run:

```bash
gh workflow run build-image.yml -f force=true
```

This is a `workflow_dispatch` trigger that passes `force=true` through to all three Coolify deploy URLs. The image rebuild is cache-hot (~1–2 min); the Coolify recreates fire on completion.

**Pull-race caveat:** Coolify's deploy recreates containers but does not always `docker pull` first — it can reuse the locally-cached `:latest`, which on a stuck deployment is the old image. If `force=true` recreates the container but the revision label still points at the old SHA, prime the local cache before retrying:

```bash
ssh <host> docker pull ghcr.io/leebaroneau/paperclip-hermes-gbrain:latest
gh workflow run build-image.yml -f force=true
```

The durable fix is configuring each Coolify app's image-pull-policy to "Always" (UI: app → Configuration → Image Pull Policy). Then `force=true` alone is sufficient.

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
PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS=1
PAPERCLIP_PROFILE_SYNC_API_KEY=<pcp_board_...>   # same key as PAPERCLIP_API_KEY is fine
```

Profile sync also grants `canAssignTasks` to active agents that have direct reports, preserving their existing `canCreateAgents` setting. Disable with `PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS=0` if a deployment wants CEO-only task assignment.

Grants are **tracked in `/data/agent-stack/profile-sync/manifest.json` under `permissionedAgents`** and **revoked on a future cycle if the agent loses qualification** (e.g. its last direct report leaves). CEOs (`agent.role === 'ceo'`) are skipped in both grant and revoke paths because Paperclip surfaces their `canAssignTasks` via the role-derived `taskAssignSource: ceo_role` permission — the explicit-grant lifecycle is for non-CEO managers. Agents granted before this manifest tracking shipped are *not* eligible for the steady-state revoke; see [Cleaning up historical canAssignTasks drift](#cleaning-up-historical-canassigntasks-drift) below for the one-shot cleanup tool.

**Gateway autostart for profiles with messaging credentials:**

```env
HERMES_GATEWAY_AUTOSTART=1
HERMES_GATEWAY_PROFILES=auto
```

`auto` starts any existing Hermes profile whose `.env` contains a messaging credential such as `TELEGRAM_BOT_TOKEN`. To pin an explicit set, use a comma-separated list like `sales,support`. To disable gateway autostart, set `HERMES_GATEWAY_AUTOSTART=0`.

**Do NOT add blank LLM provider keys** (`OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `OPENROUTER_API_KEY=`) to Coolify. Hermes boots without them; the first-run flow configures a provider via the dashboard at `hermes.<client-domain>/env`.

For single-VM deployments, profile-sync env can live in `/data/agent-stack/profile-sync/profile-sync.env` (root-readable) instead of Coolify env. Override `ORG_MIRROR_ROOT` only if you need the org chart files somewhere other than `/data/agent-stack`.

### Coolify routing notes

Coolify renders `docker-compose.yaml` with `$` escaped to `$$` inside the `labels:` block. That means `${PAPERCLIP_HOSTNAME}` / `${HERMES_HOSTNAME}` in the Traefik labels stay *literal* instead of being substituted — and the same is true for Coolify's own magic vars like `${SERVICE_FQDN_*}` when written into compose labels. Setting `SERVICE_FQDN_HERMES_9119` or `SERVICE_FQDN_HERMES` as an env var does NOT generate routing labels on its own.

What Coolify *does* read is the per-service domain map on the application resource. Set it via the UI (recommended) or the API:

1. **Coolify UI:** App → *Configuration* → set domain per service (`paperclip` → `paperclip.<your-domain>`, `hermes` → `hermes.<your-domain>`). Coolify auto-injects working Traefik routers (`http-0-<uuid>-<service>.rule=Host(\`...\`)`) at next deploy. The compose's own labels become no-ops but cost nothing.
2. **Coolify API:** `PATCH /api/v1/applications/<uuid>` with body `{"docker_compose_domains":{"paperclip":{"name":"paperclip","domain":"http://paperclip.<your-domain>"},"hermes":{"name":"hermes","domain":"http://hermes.<your-domain>"}}}`. Trigger a redeploy after — the change takes effect when the next deploy renders Traefik labels.

Symptom of missing this step: `paperclip.<your-domain>` works (Coolify routes the app's primary FQDN to the first compose service for free) but `hermes.<your-domain>` returns 404. `docker inspect <hermes-container> | grep traefik` shows either no routers or routers with literal `${VAR}` text — both mean the per-service map was never set.

### Traefik labels must be UUID-agnostic

**Never write a Coolify resource UUID into a Traefik label in this compose.** Coolify auto-generates `routers.http-0-<this-app-uuid>-<service>` and `routers.https-0-<this-app-uuid>-<service>` per app at deploy time, and it mirrors any middleware chain you put on the user-defined router (`routers.hermes.middlewares=...`) onto the auto-generated ones. The auto-gen path is the only correct one because each Coolify instance fills in its own UUID.

Embedding a literal UUID — for example `traefik.http.routers.https-0-z141d7h67lhshygmp2ad35xg-hermes.middlewares=gzip,hermes-auth` — pins that router to one specific Coolify app. When the same compose is deployed to a second Coolify instance (different UUID), the second instance ends up with both its own correct auto-generated routers AND the original instance's leaked router, all listening on the same `Host()`. Traefik then picks between them by priority/specificity, producing inconsistent behavior across requests (some authed, some not).

To attach a middleware like basicAuth, attach it to the **user-named router only**:

```yaml
- traefik.http.middlewares.hermes-auth.basicauth.users=admin:<bcrypt>
- traefik.http.routers.hermes.entryPoints=http
- traefik.http.routers.hermes.middlewares=gzip,hermes-auth          # ← middleware chain here, Coolify mirrors to https-0-<uuid>-hermes
- traefik.http.routers.hermes.rule=Host(`${HERMES_HOSTNAME:-hermes.example.com}`)
- traefik.http.routers.hermes.service=hermes
- traefik.http.services.hermes.loadbalancer.server.port=9119
```

If you find a `routers.https-0-<some-uuid>-...` or `routers.http-0-<some-uuid>-...` line written into this compose (by hand-edit, a previous merge, or a paste from a Coolify-rendered compose), delete it before committing — Coolify will regenerate the right version per deploy.

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

The `paperclip` container's entrypoint runs four small Node patches against Paperclip's bundled npm package before starting the server. These rewrite a few lines in place each boot so the agent stack behaves correctly:

| Patch | What it changes |
|---|---|
| `patch-paperclip-hermes-defaults.mjs` | When Paperclip creates a `hermes_local` agent, inject `HERMES_MODEL` / `HERMES_PROVIDER` defaults from the Hermes profile config so newly-hired agents don't fall back to the bundled adapter's hardcoded Anthropic model. |
| `patch-hermes-adapter-env.mjs` | Unwrap Paperclip's env-binding objects when passing to the Hermes child process. Without this, `HERMES_HOME`, `GBRAIN_HOME`, and `PAPERCLIP_API_URL` reach Hermes as objects instead of strings. |
| `patch-hermes-adapter-skills-home.mjs` | Rewrite `hermes-paperclip-adapter`'s `listSkills` so it scans `<HERMES_HOME>/skills/` (instead of always `$HOME/.hermes/skills/`) and follows symlinks at both the category and item levels. Without this, every per-role profile that profile-sync creates reports 0 skills in Paperclip's UI/API even though Hermes itself loads them fine. |
| `patch-paperclip-company-prefix.mjs` | Relax Paperclip's company URL-key prefix constraints to allow the slugs the agent stack uses. |

All four are idempotent and re-applied on every container start. If you upgrade Paperclip (`PAPERCLIP_VERSION` build arg), re-run the patch tests:

```bash
node paperclip/patch-paperclip-hermes-defaults.test.mjs
node paperclip/patch-hermes-adapter-env.test.mjs
node paperclip/patch-hermes-adapter-skills-home.test.mjs
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

### Cleaning up historical `canAssignTasks` drift

The steady-state revoke (see [Profile Sync & Org Chart](#profile-sync--org-chart)) only touches agents profile-sync recorded in its own manifest. Agents granted `canAssignTasks` by an earlier, more permissive code path — or by a manual click in the Paperclip UI — are not in the manifest and so are out of scope for the steady-state cleanup. For that one-time backfill, ship the deployment a one-shot script at `/opt/paperclip/narrow-grants.mjs`:

```bash
# Dry-run (default — lists candidates, makes no changes):
docker exec <paperclip-container> sh -c '
  PAPERCLIP_API_BASE=http://127.0.0.1:3100 \
  PAPERCLIP_API_KEY=$PAPERCLIP_API_KEY \
  node /opt/paperclip/narrow-grants.mjs'

# Apply (only after eyeballing the dry-run output):
docker exec <paperclip-container> sh -c '
  PAPERCLIP_API_BASE=http://127.0.0.1:3100 \
  PAPERCLIP_API_KEY=$PAPERCLIP_API_KEY \
  node /opt/paperclip/narrow-grants.mjs --apply'
```

Why the explicit `PAPERCLIP_API_BASE=http://127.0.0.1:3100` override: the container's default `PAPERCLIP_API_BASE` points at the docker-compose service hostname (`http://paperclip:3100`), which doesn't resolve back to self from within the same container the way the entrypoint-spawned profile-sync subprocess sees it. Setting `127.0.0.1` for ad-hoc invocations sidesteps that.

The script flags every agent that has `access.canAssignTasks=true && access.taskAssignSource='explicit_grant'` AND zero direct reports. CEOs (`source: ceo_role`) are skipped automatically because they don't match the `explicit_grant` filter. Revoke payload preserves the agent's existing `canCreateAgents` bit. If a candidate looks wrong (e.g. an "Engineering Manager" that *should* have reports but doesn't in the data), fix the `reportsTo` field in the Paperclip UI first — the steady-state reconcile will then re-grant on its next cycle.

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

## Backups

All runtime state lives under `/data` inside the `paperclip-data` Docker volume. Back up that single volume and you can rebuild the stack on a fresh host.

What's worth backing up:

- `/data/instances/` — Paperclip companies, agents, kanban, sessions.
- `/data/hermes/` — Hermes profiles, config, kanban DB.
- `/data/gbrain/` — GBrain pages per role (the actual knowledge base).
- `/data/agent-stack/` — protocols, org-chart, profile-sync state.

### Recommended: nightly `restic` to Backblaze B2

Add a Coolify "Scheduled Task" on the Docker Compose app:

- **Container:** `paperclip`
- **Frequency:** `0 3 * * *` (daily at 03:00)
- **Command:**

```bash
RESTIC_PASSWORD_FILE=/data/.restic-password \
RESTIC_REPOSITORY=b2:<your-bucket-name>:<deploy-name>/paperclip-data \
B2_ACCOUNT_ID=<keyID> \
B2_ACCOUNT_KEY=<applicationKey> \
restic --no-cache backup /data \
  --exclude /data/.locks \
  --exclude /data/.cache \
  --exclude '/data/**/node_modules' \
&& restic --no-cache forget --prune \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 12
```

Bootstrap once before the first scheduled run:

```bash
# Inside the paperclip container:
echo '<long random string>' > /data/.restic-password
chmod 600 /data/.restic-password
restic init  # creates the encrypted repo in B2
```

### Restoring on a fresh deploy

```bash
RESTIC_PASSWORD_FILE=/data/.restic-password \
RESTIC_REPOSITORY=b2:<your-bucket-name>:<deploy-name>/paperclip-data \
B2_ACCOUNT_ID=<keyID> \
B2_ACCOUNT_KEY=<applicationKey> \
restic restore latest --target /
```

Restic is not yet bundled in the image. Either:

1. Bake it into the Dockerfile (`apt-get install restic`).
2. Or run it via a sidecar container in compose that mounts the same `paperclip-data` volume.

### Alternative: bind-mount + host backup

If your Coolify host already has a backup tool (rclone, tarsnap, Time Machine, etc.) covering a host directory, you can convert `paperclip-data` from a named Docker volume to a bind mount of a directory on the host. Any backup of that host directory now captures the agent stack state without a per-container step. This is how `leebarone.dev` is configured — the volume is bind-backed to `~/Documents/GitHub/lee-dashboard/leebarone/hermes/` and rides on the user's Mac-level backup.

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

During profile sync, all active Paperclip agents also receive a concise
`Capability Discovery` clause if they do not already have one. That clause makes
role ownership and peer-manager routing explicit for cross-team delegation.

To reset a local test install:

```bash
docker compose --env-file .env.example down -v
```

Do not commit generated runtime folders such as `data/`, `instances/`, `hermes/`, or `gbrain/`.
