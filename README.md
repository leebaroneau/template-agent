# Template Agent

Blank Coolify-ready template for running Paperclip with Hermes Agent and GBrain.

This repo is intentionally client-neutral. It should contain the deploy recipe only. Paperclip projects, Hermes profiles, GBrain stores, API keys, and client data are created at runtime inside the Coolify volume mounted at `/data`.

## ⚠️ For Agents (Claude, Codex, any LLM editing this repo) — Read First

This is a **template deployed to multiple companies simultaneously** from source.

| Deploy | Coolify host | Watches |
| --- | --- | --- |
| **ALX Finance** | `https://coolify.alxfinance.com.au` | `ALX-Finance/template-agent` @ `main` |
| **Leebarone** | `https://coolify.leebarone.dev` | `leebaroneau/template-agent` @ `main` |
| **Genvest** | `http://209.38.27.69:8000` | `leebaroneau/template-agent` @ `main` |

Production Coolify deploys should pull a prebuilt image from GitHub Container Registry. GitHub Actions builds and audits the image first, then publishes immutable tags such as `ghcr.io/leebaroneau/template-agent:sha-<commit>`. Local development still builds from source by adding `compose.build.yaml`.

**Rules for any change you propose:**

- A push to a watched branch can redeploy **every Coolify watching that branch — simultaneously**. Treat every commit as a multi-tenant change.
- Per-company customization lives in **Coolify env vars only** (`PAPERCLIP_HOSTNAME`, `PAPERCLIP_API_KEY`, `PAPERCLIP_DEFAULT_COMPANY_ID`, `HERMES_PROFILES`, `PROFILE_SYNC_ENABLED`, `HERMES_DASHBOARD_ENABLED`, …) — **never** introduce per-brand branches or hard-coded brand specifics in `compose.yaml`.
- Hermes dashboard is **off by default**. Do not expose a Hermes service domain unless `HERMES_DASHBOARD_ENABLED=1` is intentional for that deployment. Use Paperclip as the primary UI, and use Hermes CLI/MCP/gateways behind it.
- Data volumes are per-Coolify-app (`<app_uuid>_paperclip-data`). Rebuilds preserve data; only `docker volume rm` destroys it.
- When asked "add feature X for one company," gate it behind an env var; do **not** fork or branch the compose.

If you would be tempted to add a feature, env var, or compose section that only one brand needs — **stop and ask the user first.** The unified-branch architecture is deliberate.

## Shape

```text
paperclip.<client-domain> -> paperclip:3100
Hermes dashboard is unrouted by default.

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

One image runs two services. Paperclip orchestrates and is the only default public UI. The Hermes service stays headless by default so profile bootstrap and gateway autostart can run without exposing a second browser UI. Both services share `/data`, so memories, skills, and the org chart are visible from either side.

The Paperclip MCP server (see below) closes the loop: Hermes-side agents can file and update Paperclip issues without leaving the conversation.

## Services

- `paperclip` runs Paperclip on port `3100`.
- `hermes` bootstraps Hermes profiles and starts configured gateways. It only runs the dashboard on port `9119` when `HERMES_DASHBOARD_ENABLED=1`.
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
- Hermes dashboard: disabled unless `HERMES_DASHBOARD_ENABLED=1`

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

4. **Activate the key — write it to the shared volume** (preferred) or set it as a Coolify env var.

   **Preferred — write to the shared volume** so the key persists across image rebuilds and is picked up automatically by both services on every restart:

   ```bash
   # From inside the paperclip container:
   KEY="pcp_board_<your-token>"
   mkdir -p /data/agent-stack/profile-sync
   # Upsert both keys (remove stale blank lines first)
   sed -i '/^PAPERCLIP_API_KEY=/d; /^PAPERCLIP_PROFILE_SYNC_API_KEY=/d' \
     /data/agent-stack/profile-sync/profile-sync.env 2>/dev/null || true
   printf 'PAPERCLIP_API_KEY=%s\nPAPERCLIP_PROFILE_SYNC_API_KEY=%s\n' "$KEY" "$KEY" \
     >> /data/agent-stack/profile-sync/profile-sync.env
   ```

   The `paperclip` service sources `/data/agent-stack/profile-sync/profile-sync.env` at startup. The `hermes` service does too (as of this commit) — so both services pick up the key automatically on every container restart without any Coolify env var update.

   **Alternative — set in Coolify env vars** (also works but requires a redeploy each time the key rotates):

   ```
   PAPERCLIP_API_KEY=<pcp_board_...>
   PAPERCLIP_PROFILE_SYNC_API_KEY=<same-key>
   ```

5. **Enable profile sync** if you want each Paperclip agent to get its own isolated Hermes profile and GBrain home (see "Profile Sync & Org Chart"). The `PAPERCLIP_PROFILE_SYNC_API_KEY` written in step 4 already covers this — just flip `PROFILE_SYNC_ENABLED=1` in Coolify.

6. **Restart the `hermes` container** (not a full redeploy) to pick up the key from the volume:

   ```bash
   # Coolify UI: restart the hermes service only, or:
   docker compose --env-file .env restart hermes
   ```

   If you used the Coolify env var approach instead, trigger a full redeploy so the new env is injected.

7. **Use Paperclip as the main interface**, or talk to Hermes through any configured messaging gateway. If you intentionally enable the dashboard with `HERMES_DASHBOARD_ENABLED=1`, you can also use the Hermes dashboard route. Hermes can call Paperclip tools — say *"list paperclip companies"* and the MCP server replies with the live roster.

## Coolify Setup

1. **Create a new Docker Compose app** in Coolify pointing at this GitHub repo (`leebaroneau/template-agent`, branch `main`, base directory `/`).
2. **Wire up a GitHub source that can read this repo** (skip if the repo is public). Coolify's "Public GitHub" source can only clone public repos. For a private template, attach the app to a GitHub App installation that includes this repo:
   - In Coolify: app → *Source* → pick (or create) a GitHub App installation, and ensure the installation is granted access to this repo on GitHub.
   - Symptom of missing this step: deploy fails in ~0 seconds with `GitHub API call failed: Not Found` in the logs.
3. **Pick the public Paperclip domain** you'll use:
   - `paperclip.<client-domain>`
4. **Generate starter env values**:

   ```bash
   ./scripts/coolify-env.sh client.example.com
   ```

5. **Paste the generated values into Coolify**, replacing the example domain with the real client domain.
6. **Set the Paperclip service domain in the Coolify app UI.** Open the app → *Configuration* → set a domain for `paperclip` (`paperclip.<client-domain>`). Coolify uses this map to inject the working Traefik router — the compose's own `${PAPERCLIP_HOSTNAME}` placeholder is not substituted under Coolify (see "Coolify routing notes" below).

   Do **not** set a `hermes` service domain unless you also set `HERMES_DASHBOARD_ENABLED=1` and intentionally want the Hermes browser UI exposed for debugging/admin use.

7. **(Optional) Render brand-specific compose routes** if you'd rather hardcode the Traefik labels in a brand fork:

   ```bash
   ./scripts/render-coolify-compose.sh client.example.com client-agent-stack
   ```

8. **Deploy.** Coolify pulls the image referenced by `TEMPLATE_AGENT_IMAGE` and starts `paperclip` + `hermes` from that already-audited artifact. Then follow the First-Run Flow above to mint the API key and activate the MCP server.

### Auto-deploy from `main`

Use Coolify's Git integration or deploy webhook for deploys, but keep the deployment image-first:

```env
TEMPLATE_AGENT_IMAGE=ghcr.io/leebaroneau/template-agent:sha-$SOURCE_COMMIT
```

Leave Coolify's **Literal** toggle off for this variable so `$SOURCE_COMMIT` expands to the commit being deployed. GitHub Actions publishes `sha-<commit>` on every push to `main`. Coolify should not build the Paperclip/Hermes/GBrain image on the production host.

Do not let Coolify auto-deploy a pushed commit before the GitHub image workflow has finished. The safe sequence is:

1. Merge to `main`.
2. Wait for **Build & push agent stack image** to publish `ghcr.io/leebaroneau/template-agent:sha-<merge-commit>`.
3. Trigger the Coolify deploy for that commit.
4. Confirm `https://paperclip.<client-domain>/api/health` returns `{"status":"ok"}` before removing any recovery container or rollback tag.

If you want full automation later, wire Coolify's deploy webhook from the image workflow after the push step, not directly from GitHub's branch push event.

### Recovering from a stuck deploy

If Coolify skips a deploy or keeps running an older built image, trigger a force redeploy from Coolify for the affected app. Telltale signs:

- `docker inspect <container> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'` shows an old commit SHA.
- New env vars from a fresh PR are missing inside the container.
- A line you just added to a baked-in file (e.g. `paperclip/profile-sync.mjs`) is not present at `/opt/paperclip/profile-sync.mjs`.

Because production deploys pull prebuilt images, recovery should be a rollback to the previous known-good `ghcr.io/leebaroneau/template-agent:sha-<commit>` tag followed by a Coolify redeploy. Do not force a production-host image rebuild as the first recovery step.

### Coolify env variable checklist

**Required for any deployment:**

```env
PAPERCLIP_PUBLIC_URL=https://paperclip.<client-domain>
PAPERCLIP_ALLOWED_HOSTNAMES=paperclip.<client-domain>,localhost,127.0.0.1
PAPERCLIP_HOSTNAME=paperclip.<client-domain>
HERMES_DASHBOARD_ENABLED=0
```

Public routing is configured separately via the Coolify per-service domain map (step 6 of *Setting Up A New Coolify Stack*) — not via env vars. `PAPERCLIP_HOSTNAME` is only used by the compose's own Traefik labels for plain `docker compose` deployments, which Coolify doesn't substitute (see "Coolify routing notes"). Keeping it set on a Coolify deploy is harmless and documents intent.

**Required to activate the Paperclip MCP server** (set after First-Run step 3 mints a key):

```env
PAPERCLIP_API_KEY=<pcp_board_...>
PAPERCLIP_DEFAULT_COMPANY_ID=<uuid>   # optional, single-company convenience
```

**Required for per-role profile sync:**

```env
PROFILE_SYNC_ENABLED=1
PROFILE_SYNC_INTERVAL_SEC=60
PROFILE_SYNC_DELETE_MODE=archive
PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS=1
PROFILE_SYNC_HERMES_MODEL_MODE=inherit
PROFILE_SYNC_DEFAULT_COMPANY_SKILLS=gbrain,use-100m-framework
PAPERCLIP_PROFILE_SYNC_API_KEY=<pcp_board_...>   # same key as PAPERCLIP_API_KEY is fine
```

Profile sync also grants `canAssignTasks` to active agents that have direct reports, preserving their existing `canCreateAgents` setting. Disable with `PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS=0` if a deployment wants CEO-only task assignment.

By default, profile sync writes each managed `hermes_local` agent's `adapterConfig.model` / `provider` from that role's Hermes profile config (`PROFILE_SYNC_HERMES_MODEL_MODE=inherit`). Set `PROFILE_SYNC_HERMES_MODEL_MODE=paperclip-default` when you want the Paperclip UI to show `Model default` for all managed Hermes agents and let the Hermes profile choose the model at execution time. In that mode, profile sync explicitly clears stale `model` and `provider` values on every managed Hermes agent.

Profile sync also keeps baseline runtime skills in Paperclip's company skill
list. `PROFILE_SYNC_DEFAULT_COMPANY_SKILLS` defaults to
`gbrain,use-100m-framework`; for each listed slug, profile-sync reads
`/opt/hermes-runtime/skills/<slug>/SKILL.md`, creates the company skill if it is
missing, then uses the Paperclip company skill list as the desired skill set for
managed Hermes roles. Existing company skills are never patched or replaced, so
company-specific skill edits stay intact. Set
`PROFILE_SYNC_DEFAULT_COMPANY_SKILLS=none` to disable this seeding.

Grants are **tracked in `/data/agent-stack/profile-sync/manifest.json` under `permissionedAgents`** and **revoked on a future cycle if the agent loses qualification** (e.g. its last direct report leaves). CEOs (`agent.role === 'ceo'`) are skipped in both grant and revoke paths because Paperclip surfaces their `canAssignTasks` via the role-derived `taskAssignSource: ceo_role` permission — the explicit-grant lifecycle is for non-CEO managers. Agents granted before this manifest tracking shipped are *not* eligible for the steady-state revoke; see [Cleaning up historical canAssignTasks drift](#cleaning-up-historical-canassigntasks-drift) below for the one-shot cleanup tool.

**Gateway autostart for profiles with messaging credentials:**

```env
HERMES_GATEWAY_AUTOSTART=1
HERMES_GATEWAY_PROFILES=auto
```

`auto` starts any existing Hermes profile whose `.env` contains a messaging credential such as `TELEGRAM_BOT_TOKEN`. To pin an explicit set, use a comma-separated list like `sales,support`. To disable gateway autostart, set `HERMES_GATEWAY_AUTOSTART=0`.

**Do NOT add blank LLM provider keys** (`OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `OPENROUTER_API_KEY=`) to Coolify. Hermes boots without them. Configure providers through Hermes CLI/config or temporarily enable the dashboard for admin setup, then turn it back off.

For single-VM deployments, profile-sync env can live in `/data/agent-stack/profile-sync/profile-sync.env` (root-readable) instead of Coolify env. Override `ORG_MIRROR_ROOT` only if you need the org chart files somewhere other than `/data/agent-stack`.

### Do not override `PAPERCLIP_ALLOWED_HOSTNAMES` in Coolify

The compose builds this value automatically:

```
paperclip,localhost,127.0.0.1,<PAPERCLIP_HOSTNAME>
```

The first three entries are the Docker-internal names the `hermes` service uses to call Paperclip (via `http://paperclip:3100`). `PAPERCLIP_HOSTNAME` appends the public domain so browser-originated requests are also accepted.

**If you set `PAPERCLIP_ALLOWED_HOSTNAMES` as a Coolify env var it will override this value entirely**, stripping the internal names and causing every Hermes→Paperclip API call to return `403 Hostname '...' is not allowed`. Leave this variable unset in Coolify — the compose handles it correctly.

### Coolify routing notes

Coolify renders `docker-compose.yaml` with `$` escaped to `$$` inside the `labels:` block. That means `${PAPERCLIP_HOSTNAME}` in the Traefik labels stays *literal* instead of being substituted — and the same is true for Coolify's own magic vars like `${SERVICE_FQDN_*}` when written into compose labels. Setting `SERVICE_FQDN_HERMES_9119` or `SERVICE_FQDN_HERMES` as an env var does NOT generate routing labels on its own.

What Coolify *does* read is the per-service domain map on the application resource. Set it via the UI (recommended) or the API:

1. **Coolify UI:** App → *Configuration* → set domain per service (`paperclip` → `paperclip.<your-domain>`). Coolify auto-injects a working Traefik router (`http-0-<uuid>-paperclip.rule=Host(\`...\`)`) at next deploy. Add `hermes` only when the dashboard is intentionally enabled.
2. **Coolify API:** `PATCH /api/v1/applications/<uuid>` with body `{"docker_compose_domains":{"paperclip":{"name":"paperclip","domain":"http://paperclip.<your-domain>"}}}`. Trigger a redeploy after — the change takes effect when the next deploy renders Traefik labels.

Symptom of missing this step: `paperclip.<your-domain>` returns 404 or routes to the wrong service. `docker inspect <paperclip-container> | grep traefik` shows either no routers or routers with literal `${VAR}` text — both mean the per-service map was never set.

### Traefik labels must be UUID-agnostic

**Never write a Coolify resource UUID into a Traefik label in this compose.** Coolify auto-generates `routers.http-0-<this-app-uuid>-<service>` and `routers.https-0-<this-app-uuid>-<service>` per app at deploy time. The auto-gen path is the only correct one because each Coolify instance fills in its own UUID.

Embedding a literal UUID pins that router to one specific Coolify app. When the same compose is deployed to a second Coolify instance (different UUID), the second instance ends up with both its own correct auto-generated routers and the original instance's leaked router, all listening on the same `Host()`. Traefik then picks between them by priority/specificity, producing inconsistent behavior across requests.

Do not add a shared hard-coded Hermes basic-auth hash to this template. If a deployment exposes the Hermes dashboard, protect it with deployment-level access control such as the existing auth-gate or Cloudflare Access.

If you find a `routers.https-0-<some-uuid>-...` or `routers.http-0-<some-uuid>-...` line written into this compose (by hand-edit, a previous merge, or a paste from a Coolify-rendered compose), delete it before committing — Coolify will regenerate the right version per deploy.

## Paperclip MCP Server

The blank Hermes config is intentionally empty, with one exception: a Paperclip MCP server is wired in by default so Hermes agents in any new setup can file and track work in Paperclip through typed tool calls instead of constructing shell `curl` commands. Seeded agents and profile-sync-managed agents also get the Hermes `mcp` toolset in their Paperclip adapter config by default, so the profile config and the runtime tool access stay aligned.

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

If both are blank the server still starts but every tool call fails with an auth error. Mint a board key once Paperclip is reachable (see "Mint a board API key" in First-Run Flow, step 3), then write it to the shared volume as described in step 4 — the hermes container picks it up on the next restart without a Coolify env var update or full redeploy.

Optional convenience env: set `PAPERCLIP_DEFAULT_COMPANY_ID=<uuid>` so single-company setups don't need to pass `companyId` on every tool call.

Health check from inside the container:

```bash
docker compose --env-file .env exec paperclip node /opt/paperclip/mcp-paperclip/server.mjs \
  <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

A healthy server replies with `serverInfo: {"name":"paperclip","version":"0.1.0"}`.

### Propagation to existing profiles

When you (or an upstream update) add a new MCP server to `hermes-runtime/templates/config.yaml`, the `bootstrap-profiles.sh` entrypoint script idempotently merges any *missing* `mcp_servers.*` entries into every profile config on the next container start — both `HERMES_PROFILES`-listed profiles AND per-role profiles that `profile-sync.mjs` created at runtime under `/data/hermes/profiles/`. Existing entries are never overwritten, so per-profile customisations are preserved. New servers added to the template propagate to every Hermes profile automatically without a manual patch.

**Brand overlays.** Brand wrappers (e.g. `agent-genvest`) can contribute additional `mcp_servers` entries without modifying or forking this image. Drop YAML files into `/opt/hermes-runtime/templates/overlays/*.yaml` — typically via Docker Compose `configs:` mounts on both the `paperclip` and `hermes` services — and `bootstrap-profiles.sh` merges each file's `mcp_servers.*` into the effective template before merging that into each profile. The merge is strictly additive at both layers: the canonical `config.yaml` wins over any overlay on key collision, and existing profile entries always win over the effective template. Among overlays, alphabetic-first filename wins on collision.

Overlay errors (malformed YAML, missing `mcp_servers` key, non-dict `mcp_servers` value) emit a single stderr warning and skip that overlay — bootstrap never crashes because of overlay errors. See `hermes-runtime/templates/overlays/README.md` (shipped in the image) for the contract a brand overlay file must follow.

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

The template also ships a small `gbrain` runtime skill at
`hermes-runtime/skills/gbrain/SKILL.md`. Profile sync creates the matching
Paperclip company skill by default, then syncs the company skill list into each
managed role. That keeps Paperclip as the source of truth while Hermes still
loads the actual skill file from the profile.

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

## 100M Framework Learning Loop

The bundled `use-100m-framework` skill is installed into every Hermes profile
through the existing `hermes-runtime/skills` propagation path. Bootstrap and
profile-sync symlink the skill into each profile's `skills/agent-stack/`
directory, so new Paperclip-managed profiles pick it up without separate setup.
Profile sync also seeds it into Paperclip company skills by default, which makes
Paperclip the control-plane source of truth for whether managed roles should use
it.

Company agents use the skill to apply the shared `$100M` framework and write
sanitized `100m-field-learning` proposals into their role-specific GBrain homes.
Promotion is centralized: company profiles do not edit shared framework doctrine
directly. See [docs/100m-framework-learning-loop.md](docs/100m-framework-learning-loop.md)
for the pull model, promotion classes, and personal-Hermes curator cron.

## EOS Framework Runtime Skill

The bundled `use-eos-framework` skill is installed into every Hermes profile
through the same `hermes-runtime/skills` propagation path. Agents use it to turn
selected `$100M` opportunities into Rocks, owners, scorecards, Paperclip issue
trees, routine setup issues, and escalation paths.

The shared EOS doctrine stays outside this blank template at
`00_resources/frameworks/eos-framework/`. Company agents write sanitized
`eos-field-learning` proposals into their role-specific GBrain homes when work
produces reusable improvements. If the current Paperclip tool surface does not
include routine creation, agents file a routine setup issue instead of claiming
that the routine exists.

## Profile Sync & Org Chart

The `paperclip` container can run an embedded reconciliation loop that mirrors Paperclip's roster into per-role Hermes profiles, GBrain homes, and adapter skill-sync state. It is enabled in the generated Coolify env; set the API key after first-run auth:

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
Skill sync:     adapterConfig.paperclipSkillSync.desiredSkills
Toolsets:       adapterConfig.toolsets includes terminal,file,web,mcp
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
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.example build
./scripts/audit-blank-image.sh template-agent:local
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
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.example build
./scripts/audit-blank-image.sh template-agent:local
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
