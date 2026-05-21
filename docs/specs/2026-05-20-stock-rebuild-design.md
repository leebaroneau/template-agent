# Stock rebuild of the Paperclip / Hermes / GBrain stack

**Date:** 2026-05-20
**Status:** Draft (awaiting sign-off)
**Owner:** Lee Barone
**Implementation target repo:** `leebaroneau/template-agent`
**Implementation target image:** `ghcr.io/leebaroneau/template-agent:sha-<commit>`

## Current state snapshot (2026-05-20 evening)

- **Mac personal stack:** **RETIRED** as of 2026-05-20. Colima uninstalled, local Coolify destroyed with it, the legacy Paperclip/Hermes/GBrain data folder was deleted, and `paperclip.leebarone.dev` / `hermes.leebarone.dev` are offline. Out of scope for this spec. Historical `.sql.gz` dumps remain at `leebaroneau/paperclip-backups/` until cleared.
- **Haverford Coolify (validation tier — NEW):** No existing Paperclip/Hermes/GBrain Coolify app. Coolify host is `coolify.haverford.au`, which runs on the **same machine** as the existing standalone Hermes (`haverford-droplet`, root@170.64.147.137). This rebuild creates a brand-new Coolify app on that host — fresh DB, fresh volume, fresh hostnames. The existing standalone Hermes (via `start-hermes-droplet.sh`, state in `tate66...-hermes-data`) is **untouched and continues running** in parallel.
- **Genvest droplet stack (promotion tier):** Coolify app `otm4lzviqdp29yuhkafcghsb`. Still running the customised image (`ghcr.io/leebaroneau/template-agent:sha-793d56387e43ce2e3ab9ac239cbe48dfeb242d60`). Kanban dispatch is broken. Auto-deploy currently wired to `leebaroneau/template-agent` main.
- **ALX stack:** agent-stack Coolify app on `coolify.alxfinance.com.au`. Empty, never seeded. **Deferred to v2** — not in this rebuild's scope. Auto-deploy is wired to `leebaroneau/template-agent` main, so the rebuilt main would deploy there too if its auto-deploy isn't paused (see Step 1).
- **Workstation folder rename:** `lee-dashboard/leebarone/` was renamed to `lee-dashboard/leebaroneau/` on 2026-05-20. All host paths in this spec use the new `leebaroneau/` form.

## Why

The current `template-agent` image carries six monkey-patch scripts (`patch-paperclip-hermes-defaults.mjs`, `patch-hermes-adapter-env.mjs`, `patch-hermes-adapter-skills-home.mjs`, `patch-hermes-profile-skill-count.mjs`, `patch-invite-auth-flow.mjs`, `patch-paperclip-company-prefix.mjs`) plus a custom `hermes-entrypoint.sh` runner. The patches mutate upstream Paperclip and Hermes behavior at runtime. They were authored against the `openai-codex` provider and shipped without provider-agnostic testing.

On 2026-05-20 a switch from `openai-codex` to `anthropic` on the Genvest droplet exposed a chain of failures: lazy-deps install loops, post-env-load subprocess deaths, and silent dispatch hangs. Debugging the patch chain in place is open-ended; rebuilding from upstream is bounded.

The goal is one stock image, two Coolify stacks (Haverford new, Genvest existing), zero monkey-patches. A secondary motivation is **upgradability**: by following the three upstream repos' published patterns directly (Hermes, hermes-paperclip-adapter, GBrain), future version bumps are documented by upstream changelogs and don't require us to re-port custom patches against new releases. The smaller our local surface area, the easier each upgrade.

## Goals

- Both Coolify stacks run the same image built from pinned upstream sources: `NousResearch/hermes-agent` + `NousResearch/hermes-paperclip-adapter` + `garrytan/gbrain` + Paperclip CLI (closed-source npm).
- Zero patches to upstream source. All integration is via environment variables and public APIs.
- One feature preserved from the existing customization layer: **agent-create-in-Paperclip → dispatch-ready Hermes adapter config**, implemented as an `agent-sync` sidecar that talks to Paperclip's public REST API only. If this requires patching Paperclip, Hermes, or the adapter, the feature becomes read-only in v1 and the gap goes upstream.
- Haverford is a fresh deployment (no existing data, no migration). Its volume names, container names, ports, and domains are isolated from the standalone Hermes that already runs on `haverford-droplet`.
- Genvest keeps its existing Coolify UUID and named volume. NEVER DELETE per hard rule. Only the image content and `.env` change.
- Fresh database on Genvest before restore. Pre-cutover backup on Genvest lands on the host outside any Docker volume. Restored Paperclip agents run through the stock default Hermes profile; old Hermes profile dirs are backed up for rollback only, not restored into the rebuilt stack.

### Canonical template rule

`leebaroneau/template-agent` is the canonical golden template. New orgs deploy from it directly when access permits. Org-level duplicates are allowed only for access-control, billing, compliance, or ownership requirements; they must stay mechanically equivalent to the golden template and must not contain org-specific code changes unless an intentional divergence is documented and approved.

Operationally, customisation belongs in deployment configuration, environment variables, secrets, state volumes, and Paperclip/Hermes runtime data — not in copied template source. If an org copy diverges, record the reason, owner, and upgrade burden in that repo before merging the divergence.

## Non-goals

- No work on the broken kanban-dispatch symptom directly. The rebuild is the fix.
- Not migrating Hermes-side state (sessions, kanban DB, profile metadata). Paperclip remains the source of truth for companies, agents, issues, and skills.
- No multi-profile Hermes in v1. `HERMES_PROFILES=default`, `HERMES_HOME=/data/hermes`, and `GBRAIN_HOME=/data/gbrain/default` on both stacks. Multi-profile is reintroduced later only if a real isolation problem appears.
- No customization to upstream Paperclip. No `patch-invite-auth-flow.mjs`, no `patch-paperclip-company-prefix.mjs`, etc. Accept upstream defaults.
- No rewrite of the GBrain ingestion flow. GBrain runs stock; whatever wire-up the upstream supports is what we use.
- **No changes to the existing standalone Hermes on haverford-droplet.** It keeps running unchanged; the new Coolify app coexists alongside it.
- Mac personal stack is **out of scope** — retired 2026-05-20.
- ALX is **deferred to v2**.

## Architecture

### One image, two app services, one agent-sync sidecar

```
ghcr.io/leebaroneau/template-agent:sha-<commit>
├── /opt/hermes/      ← upstream NousResearch/hermes-agent @ pinned tag
├── /opt/paperclip/   ← Paperclip CLI (npm @ pinned version)
│   └── mcp-paperclip/← Hermes ↔ Paperclip MCP server (stock)
├── /opt/adapter/     ← hermes-paperclip-adapter @ pinned commit
├── /opt/gbrain/      ← garrytan/gbrain @ pinned commit
└── /opt/sidecar/     ← agent-sync.mjs (our integration code)
```

The compose file declares **three services**, each running the same image with a different command:

| Service | Command | Port | Purpose |
| :---- | :---- | :----: | :---- |
| `paperclip` | `paperclipai serve` | 3100 | Paperclip web UI + REST API |
| `hermes` | profile bootstrap + `hermes -p default gateway run` for configured gateway profiles; dashboard only when `HERMES_DASHBOARD_ENABLED=1` | 9119 when enabled | Hermes gateway/headless runtime by default; optional UI/debug surface |
| `agent-sync` | `node /opt/sidecar/agent-sync.mjs` | — | Polls Paperclip API for agents; ensures each active agent has stock `hermes_local` adapter config pointing at the default Hermes profile |

Splitting `agent-sync` out makes failures isolable and logs separable. If it crashes or its dependencies regress, the other two services keep running.

### Shared state

- One named volume per Coolify app, mounted at `/data` in all three services.
  - Haverford: `<new-haverford-app-uuid>_paperclip-data` (Coolify-managed local volume).
  - Genvest droplet: `otm4lzviqdp29yuhkafcghsb_paperclip-data` (existing Coolify-managed local volume — keep as-is).
- `/data/hermes` = `HERMES_HOME`.
- `/data/gbrain/default` = `GBRAIN_HOME`.
- `/data/instances` = Paperclip's data root.
- No `/data/hermes/profiles/<agent>` or `/data/gbrain/<agent>` dirs in v1. Per-agent runtime isolation is explicitly out of scope until Haverford validation proves the default-profile model is insufficient.

### Networking

- All three services on the Coolify-created docker network per stack. Internal addresses: `paperclip:3100`; `hermes:9119` only listens when the dashboard is explicitly enabled. `agent-sync` hits `http://paperclip:3100` only.
- Traefik routes Paperclip publicly per stack:
  - Haverford: `paperclip.haverford.au` → service `paperclip`.
  - Genvest: existing Paperclip hostname preserved.
- Hermes is not publicly routed by default. If a deployment intentionally enables `HERMES_DASHBOARD_ENABLED=1`, route the `hermes` service through deployment-level access control rather than a shared hard-coded basic-auth password.

### Haverford coexistence rules (shared machine with standalone Hermes)

The new Haverford Coolify app shares a host with the existing standalone Hermes (`start-hermes-droplet.sh`, volume `tate66...-hermes-data`). Hard rules:

- **Container names:** the new stack's containers are named `paperclip-<new-haverford-uuid>-*`, `hermes-<new-haverford-uuid>-*`, `agent-sync-<new-haverford-uuid>-*`. No name overlap with the standalone Hermes container.
- **Volume names:** Coolify generates volume names from the app UUID (e.g., `<new-haverford-uuid>_paperclip-data`). These never collide with `tate66...-hermes-data`. **Cross-check before first deploy** that the rendered compose's `volumes:` block doesn't reuse `tate66...-hermes-data` anywhere.
- **Ports:** Paperclip's `3100` and Hermes's `9119` are container-internal only. Traefik routes traffic on host ports `80/443`. No fixed host-port exposure on the new stack. Confirm the standalone Hermes doesn't bind 9119 on the host either; if it does, the standalone keeps the port (no change) and the new Hermes stays container-internal.
- **Domains:** the new stack uses `paperclip.haverford.au` for the Paperclip UI. The stack Hermes dashboard is headless/unrouted by default. The standalone Hermes keeps whatever subdomain it has today. No DNS or Cloudflare tunnel changes that touch the standalone's routing.
- **Coolify destructive operations on the Haverford app:** NEVER call DELETE on the new Haverford app without confirming `docker_cleanup=false` (memory: `feedback_coolify_docker_cleanup_destroys_adjacent` — cleanup matches by name pattern + label and removes adjacent standalone containers).

### Integration boundaries (where "no customisation" gets tested)

- **Paperclip → Hermes dispatch:** uses Paperclip's stock `hermes_local` adapter type as-shipped. If the stock adapter requires `HERMES_MODEL` / `HERMES_PROVIDER` on the adapter row, `agent-sync` sets those fields through Paperclip's public API, not via a monkey-patch. If this proves too painful operationally, we file an upstream PR to Paperclip, not a local patch.
- **Hermes → GBrain:** GBrain provides an MCP server. Hermes `config.yaml` references it under `mcp_servers.gbrain`. Stock wiring.
- **Paperclip → agent adapter config:** `agent-sync` sidecar only. It uses public Paperclip REST endpoints (list companies, list agents, update agents, list skills if available). It does not call `hermes -p <agent> ...`, create Hermes profiles, create GBrain homes, or copy runtime templates. If a required Paperclip endpoint isn't publicly exposed, `agent-sync` v1 ships read-only (logs what it would have synced) and the gap goes upstream as a PR.

### V1 profile model

V1 deliberately runs a single Hermes profile per stack:

- Paperclip remains the role and org-chart source of truth. Agent identity comes from the Paperclip agent record, task assignment, capabilities, and issue context passed to the stock adapter.
- Hermes remains the execution runtime. It uses `/data/hermes` as the one profile and `/data/gbrain/default` as the one GBrain home.
- `agent-sync` only reconciles Paperclip agent records so they are dispatch-ready. It must not create per-agent `HERMES_HOME` or `GBRAIN_HOME` values.
- If validation shows unacceptable cross-agent memory, session, or skill leakage, stop and write a v2 design for profile-per-agent isolation. Do not resurrect the old `paperclip/profile-sync.mjs` behavior inside this rebuild.

### Runtime env contract

The rebuild keeps env vars boring and runtime-only:

- `TEMPLATE_AGENT_IMAGE=ghcr.io/leebaroneau/template-agent:sha-$SOURCE_COMMIT` in Coolify. Leave Coolify's Literal toggle off so `$SOURCE_COMMIT` expands.
- `PAPERCLIP_PUBLIC_URL`, `PAPERCLIP_ALLOWED_HOSTNAMES`, and `PAPERCLIP_HOSTNAME` are set per stack.
- `HERMES_DASHBOARD_ENABLED=0` is the default. Set it to `1` only when the Hermes dashboard is intentionally exposed for debugging/admin use.
- `HERMES_PROVIDER` and `HERMES_MODEL` define the default model in Hermes config. Adapter rows may repeat them only if stock Paperclip requires row-level fields.
- `PAPERCLIP_API_KEY` is the board key used by Hermes MCP calls back into Paperclip.
- `AGENT_SYNC_ENABLED=1`, `AGENT_SYNC_INTERVAL_SEC=60`, and `PAPERCLIP_AGENT_SYNC_API_KEY=<board-key>` enable the sidecar. If `PAPERCLIP_AGENT_SYNC_API_KEY` is blank, `agent-sync` falls back to `PAPERCLIP_API_KEY`.
- No `PROFILE_SYNC_*` env vars survive the rebuild. Those names belong to the old per-profile implementation.

## Source repo structure

The `leebaroneau/template-agent` main branch is rewritten with this layout:

```
template-agent/
├── README.md                          ← what it is, how to deploy on Coolify
├── AGENTS.md                          ← agent-facing instructions
├── .dockerignore
├── .env.example                       ← all knobs documented, sane defaults
├── .env.coolify.example               ← Coolify-flavoured subset
├── .github/
│   ├── pipeline-config.yml            ← kept (pipeline-core managed repo)
│   └── workflows/
│       ├── build-image.yml            ← build + push ghcr.io/leebaroneau/template-agent:sha-<commit>
│       └── pipeline-*.yml             ← caller workflows (pipeline-core)
├── compose.yaml                       ← 3-service Coolify compose
├── Dockerfile                         ← single image, multi-stage build
├── sidecar/
│   ├── agent-sync.mjs                 ← public-API-only Paperclip agent reconciliation
│   └── agent-sync.test.mjs            ← unit + integration tests
├── config/
│   ├── hermes-config.template.yaml    ← stock-derived Hermes config with placeholders
│   └── paperclip-config.template.json ← stock Paperclip config (if any tweaks via env are needed)
└── scripts/
    ├── render-coolify-compose.sh      ← idempotent compose renderer
    ├── validate-env.sh                ← guard CI/build against missing required env
    ├── coolify-env-diff.sh            ← print expected-vs-actual env per stack
    ├── audit-deploy-state.sh          ← confirm both Coolify apps remain paused during rebuild (Haverford+Genvest+ALX)
    └── pin-upstream.sh                ← update upstream pins (records commit SHAs + review date in .env.example)
```

### Blank-slate rule

The rebuild branch starts with an **empty working tree** so implementation work is not influenced by the old local patch tree:

```
git checkout -b epic/<#>-stock-rebuild
git rm -rf .
git commit -m "chore: blank slate for stock rebuild"
```

`.git/` history is preserved (so PR/issue references, branch protection, and pipeline-core wiring survive), but every file in the working tree is removed in commit #1. Files are added back in subsequent commits **only from upstream-aligned patterns** — i.e., what NousResearch's Hermes Dockerfile + docker-compose do, what hermes-paperclip-adapter's package.json + src/ look like, what GBrain's bunfig + setup expects. The pipeline-core caller workflows, `.github/pipeline-config.yml`, `labels.yml`, etc. are recreated from the canonical pipeline-core template.

This is **not** a greenfield rewrite. It is a clean-room local branch that rebuilds the template from existing, maintained upstream implementations wherever they exist. Default to upstream docs, upstream Dockerfiles, upstream config shape, and public APIs. Write new local code only for the narrow `agent-sync` bridge where no upstream component already owns the behavior.

It is OK to **read** the old `paperclip/`, `hermes-runtime/`, and `scripts/` directories for context — understanding what the old integration was trying to achieve helps avoid re-discovering the same problems. What is NOT OK is **carrying patterns forward**: if the old code monkey-patched something, the new code must instead achieve the same outcome via env vars, public APIs, or an upstream PR. If the old code can't be replaced cleanly, the feature is dropped from v1 rather than re-customised.

Two reasons the rule is this strict:

1. The old setup encoded `openai-codex`-specific assumptions across multiple files (patches, entrypoints, env defaults). Reusing patterns from it risks dragging those assumptions forward by accident.
2. The whole point is **upgradability**. Every customisation we keep is a future re-port cost. The cleanest test of "have we customised?" is "does upstream's changelog tell us everything we need to know for the next version bump?" If yes, we're aligned. If no, we still have local code that needs review on each upgrade.

### Files that get recreated (deliberate inclusions)

Everything listed in the repo structure above. Notably:

- `.github/pipeline-config.yml`, `.github/labeler.yml`, `.github/labels.yml`, `.github/ISSUE_TEMPLATE/` — recreated from the pipeline-core template, not from old repo.
- `.github/workflows/pipeline-*.yml` — recreated from pipeline-core caller-workflow template.
- `.github/workflows/build-image.yml` — written fresh per spec.
- `compose.yaml`, `Dockerfile`, `.env.example`, `.env.coolify.example`, `.dockerignore`, `.gitignore`, `README.md`, `AGENTS.md`, `package.json` — all written fresh per spec.
- `sidecar/`, `config/`, `scripts/` — all new contents per spec.
- `docs/specs/2026-05-20-stock-rebuild-design.md` — this spec itself, carried forward as the authoritative reference.

### Files that do NOT come back

These were in the old repo and are not re-added:

- `paperclip/patch-*.mjs` (all six)
- `paperclip/hermes-entrypoint.sh`
- `paperclip/profile-sync.mjs`, `paperclip/profile-sync.test.mjs`
- `paperclip/seed-agents.mjs`, `narrow-grants.mjs`, `repair-paperclip-config.mjs`, `repair-paperclip-config.test.mjs`, `gbrain-wrapper.sh`
- `compose.build.yaml`
- `hermes-runtime/` (entire directory including templates)
- Any `*.test.mjs` belonging to a patch script that's now gone

### Pinning strategy

Pins live in `.env.example` and are baked into the image at build time:

```
HERMES_AGENT_REF=v0.14.0           # NousResearch/hermes-agent tag (deliberate choice; latest stable as of pin date)
PAPERCLIP_ADAPTER_REF=<commit-sha> # hermes-paperclip-adapter pinned commit
GBRAIN_REF=<commit-sha>            # garrytan/gbrain pinned commit
PAPERCLIP_VERSION=2026.513.0       # Paperclip CLI version (npm)
```

Updates are deliberate: bump a pin → PR → CI builds + smokes → merge. No floating `:latest`, no `main` chasing. `scripts/pin-upstream.sh` records each pin with the date the upstream was reviewed, so we can spot stale pins later.

### CI tests

- Image builds clean from a cold cache (catches dependency drift).
- `compose config` parses on the rendered `compose.yaml`.
- `sidecar/agent-sync.test.mjs` runs against a mocked Paperclip API.
- Smoke test: spin up the 3 services, confirm `/health` on Paperclip returns 200 and the headless Hermes service reaches its readiness marker within 60s. Run a separate dashboard smoke only when `HERMES_DASHBOARD_ENABLED=1`.

## Safe rollout sequence

### Step 1 — Pause auto-deploy on Genvest + ALX

- Genvest droplet (`otm4lzviqdp29yuhkafcghsb`), ALX (`<ALX app UUID>`).
- For each: `PATCH /api/v1/applications/<uuid>` with `auto_deploy=false`.
- Containers keep running on their current image, current data, current routing. No restart, no rebuild, no risk.
- ALX is paused (even though deferred to v2) because its auto-deploy points at `leebaroneau/template-agent` main — without pausing, the rewrite of main would deploy there too.
- Confirm with `docker ps` on each host that containers stay `Up (healthy)`.
- Haverford has no existing app yet, so nothing to pause.

### Step 2 — Rewrite `leebaroneau/template-agent` main

- Work on a feature branch first (e.g., `epic/<#>-stock-rebuild`), opened as a PR for review per pipeline-core workflow.
- Pipeline-core preview-deploys remain inert because Genvest + ALX are paused and Haverford doesn't exist yet.
- Merging to main triggers nothing on the Coolify side.
- CI builds + smokes the image without touching production.

### Step 3 — Create the Haverford Coolify app (validation tier)

- On `coolify.haverford.au`, create a NEW Docker Compose application from git source `leebaroneau/template-agent` main.
- Use the Haverford-specific compose env values:
  - `PAPERCLIP_HOSTNAME=paperclip.haverford.au`
  - `HERMES_DASHBOARD_ENABLED=0`
  - `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` per chosen provider
  - `PAPERCLIP_API_KEY` — generated after first admin signup; placeholder initially
  - `PAPERCLIP_AGENT_SYNC_API_KEY` — optional separate board key; use the same key as `PAPERCLIP_API_KEY` if Paperclip cannot scope tokens yet
- Cross-check the rendered compose's `volumes:` block does NOT reuse `tate66...-hermes-data` or any other volume name already in use on the host.
- Cross-check no host-port exposure (only internal `3100`/`9119`).
- Auto-deploy can be on (no other stack listens to this new app's webhook).
- Deploy.

### Step 4 — Validate Haverford end-to-end

1. Sign up first admin via Paperclip UI. **Save credentials immediately** — no email reset exists; only recovery is `paperclipai auth bootstrap-ceo --force` inside the container.
2. Generate Paperclip API key. Set `PAPERCLIP_API_KEY` and `PAPERCLIP_AGENT_SYNC_API_KEY` in Coolify env. Redeploy.
3. Create two test agents in the UI with clearly different roles and capabilities, e.g. "Researcher" and "Operator". Expect `agent-sync` to reconcile both agents' `hermes_local` adapter config within `AGENT_SYNC_INTERVAL_SEC` (default 60s).
4. Create one test issue assigned to each agent. Expect stock Hermes dispatch through the default profile and progress both issues through `dispatched → in_progress → done`. Logs should show role-specific Paperclip task context for each run, with no other agent's role or issue context leaking into the transcript.
5. From inside Hermes, call `mcp__gbrain__whoami`. Expect a valid response.
6. **Verify standalone Hermes (haverford-droplet) is still running healthy.** `docker ps` shows the standalone container `Up` with no recent restarts. No new errors in `start-hermes-droplet.sh` logs.

**Pass criteria:** all six steps succeed without errors in `docker logs`. `agent-sync` logs show the agent being detected and reconciled without writing per-agent Hermes/GBrain homes. Standalone Hermes is unaffected.

### Step 5 — Promote to Genvest

After Haverford passes, promote to Genvest (the broken stack — highest value to restore).

## Migration per stack

### Haverford (validation tier — fresh deployment)

No data backup needed; the app doesn't exist yet. Bootstrap test agents as described in Step 4.

If the rebuild fails on Haverford:
- Pause auto-deploy on the new Haverford app.
- Investigate via `docker logs` and `coolify-env-diff.sh`.
- Standalone Hermes on `haverford-droplet` is unaffected. Worst case: the new Haverford app gets DELETED (with `docker_cleanup=false` — never true) and we redo it.

### Genvest droplet (promotion tier)

Pre-cutover backup is mandatory.

1. `docker exec -u node <paperclip-container> paperclipai db:backup --data-dir /data` → produces a `.sql.gz` backup in Paperclip's stock backup directory.
2. `docker cp` that file out to a host folder OUTSIDE any Docker volume: `~/genvest-paperclip-backups/<YYYY-MM-DD>.sql.gz` on the droplet.
3. `docker cp <paperclip-container>:/data/hermes` to a host folder for Hermes profile state (auth.json, config.yaml, profile dirs).
4. Verify both host copies exist before doing anything else. If either copy is missing, abort.

Cutover:

5. Coolify keeps the named volume (we never call DELETE on the app).
6. Update Coolify env to the new compose's contract.
7. Discover the current stock Paperclip DB path from the running container before touching it. Expected candidates are `/data/paperclip.db` or a DB under `/data/instances/default/data/`, but the command output and stock docs are the source of truth.
8. Move the DB files aside inside the volume, e.g. `/data/pre-rebuild-db/<YYYY-MM-DD>/`, only after the host backup from steps 1-4 exists. Do not delete the volume and do not remove the host backup.
9. Flip `auto_deploy=true` for Genvest only.
10. Trigger a deploy.

Restore:

11. Import the `.sql.gz` into the new stock Paperclip's DB with Paperclip's documented restore command. Restore **only Paperclip companies + agents**. Hermes-side state is not restored; `agent-sync` reconciles the restored Paperclip agents to the stock default adapter config.
12. Run the Genvest validation subset from Step 4: confirm admin/API-key access, test two distinct agents, verify issue dispatch, and call GBrain from Hermes. Haverford's standalone-Hermes health check is not applicable on Genvest.

## Rollback strategy

### Level 1 — Auto-deploy hiccup (new image fails health check)

- Coolify retains the last N deployment images. Click "Redeploy this version" on the prior successful deployment.
- For Haverford: there is no "previous" image (it's a new app). Rollback = stop the app or revert to a known-good image SHA from a different repo. Or just leave the failing app paused while we fix forward.
- Volume state is untouched. Backups are still on disk.
- Recovery time: ~1 minute.

### Level 2 — Stock build runs but misbehaves (e.g., agent-sync regresses)

- Pause auto-deploy on the affected stack.
- For Genvest: roll back the image via Coolify deployment history. Restore the pre-cutover DB backup with Paperclip's documented restore command. Do not assume Postgres; Paperclip's stock DB path and restore mechanism must be verified before running the command.
- For Haverford: there's no production data to restore. Pause, fix forward, redeploy.
- Open a GitHub issue on `leebaroneau/template-agent` describing the failure → fix on a branch → re-test on Haverford before re-promoting.
- Recovery time: ~10 minutes per stack.

### Level 3 — Catastrophic (volume corruption, DB lost)

- Pause auto-deploy.
- For Genvest: the host-folder backup from Migration (`~/genvest-paperclip-backups/<date>.sql.gz`) is the authoritative copy. It's OUTSIDE any Docker volume so a Coolify accident can't have touched it.
- For Haverford: no production data; recreate the app fresh.
- Spin up a fresh Coolify app pointing at a known-good image SHA (the previous template-agent), restore the backup into its new volume.
- Recovery time: ~30 minutes per stack.

### Backups retention

- Pre-cutover backups stay on the host for at least 90 days. Add a cron note: `find ~/*-paperclip-backups -mtime +90 -delete` after 90 days.
- Historical Mac backups at `leebaroneau/paperclip-backups/` are kept until manually cleared.

### Hard rules baked into the spec

- NEVER call Coolify's DELETE on either active app (Haverford new + Genvest) without explicit `docker_cleanup=false`. On the Haverford host this matters extra because cleanup sweeps could touch the standalone Hermes container.
- NEVER call `/api/v1/deploy` on a paused stack unless deliberately reconnecting.
- NEVER change the `volumes:` block of any compose without confirming a backup exists OUTSIDE any Docker volume.
- NEVER reuse a volume name that already exists on the Haverford host (i.e., never let the new app's compose declare `tate66...-hermes-data` or anything similar).

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
| :---- | :----: | :----: | :---- |
| Stock Paperclip `hermes_local` adapter rejects agents without HERMES_MODEL/HERMES_PROVIDER on the row | Med | Med | Document the per-agent fields in `README.md`. If too painful, file an upstream PR to Paperclip making model fields optional and read defaults from env. No local patch. |
| `agent-sync` needs a Paperclip API it doesn't expose publicly | Med | High | Verify against Paperclip's stock REST docs during implementation. If no public list/update agent endpoint exists, ship `agent-sync` v1 read-only (logs what would sync), then file upstream PR. Don't force a private-API integration. |
| Coolify env var contract drift — new compose adds/renames vars, Coolify's stored env doesn't match | Med | Med | Section "Safe rollout sequence" requires updating Coolify env before flipping auto-deploy on. `scripts/coolify-env-diff.sh` prints expected-vs-actual env per stack. |
| Volume layout drift — stock Hermes expects `~/.hermes` (`/opt/data` in container); we point `HERMES_HOME=/data/hermes` | Low | Med | Verify upstream Hermes honors `HERMES_HOME` env override. If it doesn't, symlink `/data/hermes → /opt/data` in the Dockerfile (filesystem link, not a code patch). |
| GBrain in-process inside Hermes container | Med | Med | Test in Haverford. If bun + PGLite conflict with hermes-agent's Python runtime, promote GBrain to its own 4th compose service in v2. Still stock; just one more service. |
| Paperclip CLI (closed source) version 2026.513.0 depends on patches in ways we don't know | Low | High | If stock Paperclip fails at startup, freeze on `PAPERCLIP_VERSION=2026.513.0` and try previous versions until one boots cleanly. Open a support ticket with Paperclip if no version works. |
| Single default Hermes profile leaks session or memory context across Paperclip agents | Med | Med | Haverford validation explicitly tests two agents with different roles. If the stock adapter cannot keep role context clean through Paperclip prompts and task context, stop and design v2 profile isolation. Do not patch v1. |
| `agent-sync` sidecar grows into a maintenance burden | Med | Low | Cap `agent-sync` at one file, one config (env), unit tests. If it needs >300 lines or extra deps, escalate the design rather than expand it. |
| CI build slow / GH Actions runs out of free minutes | Low | Low | Multi-stage image build with layer caching. Only rebuild on Dockerfile / `pyproject.toml` / `package-lock.json` changes; skip on doc-only commits. |
| Working past 4pm Sydney introduces tired-error risk | High | Med | Brainstorm + commit the spec tonight (low-risk). Implementation starts tomorrow in a fresh session. No infra changes tonight beyond the spec commit. |
| Coolify auto-deploy accidentally re-enabled on a paused stack | Low | High | `scripts/audit-deploy-state.sh` runs before each push to confirm all paused apps remain paused. |
| One pinned upstream version has a known security CVE | Low | High | `pin-upstream.sh` records the pin date. Quarterly review or whenever GitHub Dependabot flags. Don't auto-bump — deliberate PR. |
| Volume-shape change wipes Genvest data during cutover | Med | High | Pre-cutover backup outside any Docker volume is mandatory. Step is explicit in Migration. Compose `volumes:` block must match the existing named-volume name; cross-reference before merging. |
| **Haverford coexistence — new Coolify app collides with standalone Hermes on the shared host** | Med | High | Coexistence rules section enumerates volume / container / port / domain isolation. `scripts/audit-deploy-state.sh` adds a coexistence check: lists existing volumes on the Haverford host and aborts if the new compose's volumes overlap. NEVER DELETE Haverford app without `docker_cleanup=false` (per `feedback_coolify_docker_cleanup_destroys_adjacent`). |
| **Standalone Hermes nightly backup target collides with new Haverford app data** | Low | Med | Standalone backs up to `Haverford-Brands/agent-haverford-data` per `reference_hermes_droplet_setup`. New Haverford app should NOT write into the same backup target; verify backup paths are distinct before first deploy. |

## Out of scope for v1

- Mac personal stack (retired 2026-05-20).
- ALX (deferred to v2; pause its auto-deploy during v1).
- Multi-profile Hermes, per-agent Hermes homes, and per-agent GBrain homes (single profile only; revisit if Paperclip needs isolation per agent).
- Skill auto-provisioning beyond stock Paperclip skill assignment APIs (templates removed; manage skills via Paperclip's UI unless a public API exists).
- Cross-stack agent migration (each stack is independent).

## Implementation order summary

1. Open a GitHub issue on `leebaroneau/template-agent` per pipeline-core workflow (`type:epic` "Stock rebuild of Paperclip/Hermes/GBrain stack").
2. Pause auto-deploy on Genvest + ALX Coolify apps.
3. Rewrite `leebaroneau/template-agent` main on `epic/<#>-stock-rebuild` branch (blank-slate); open PR; CI smokes.
4. Merge to main (no Coolify side effects because both auto-deploys are paused and Haverford doesn't exist yet).
5. Create the Haverford Coolify app pointed at `leebaroneau/template-agent` main → validate 6-step flow (incl. standalone Hermes still healthy).
6. Pre-cutover backup on Genvest (`paperclipai db:backup` + copy outside Docker volume).
7. Reconnect Genvest → cutover → restore Paperclip companies + agents → validate.
8. Resume normal operation; close the epic; re-enable any deferred scheduled tasks.
9. (v2 follow-up: bring ALX on later.)
