# Deployment — template-agent

> template-agent is an IMAGE PUBLISHER, not a self-deployed service. It builds the brand-agnostic
> agent stack image and pushes it to GHCR; per-brand `agent-<brand>` Coolify compose repos consume
> the tag and trigger their OWN deploys. Keep this repo CLIENT-NEUTRAL: no brand names, domains,
> Coolify UUIDs, or per-deployment values belong here — those live in each consuming repo.

## Resource
- Coolify application UUID: n/a — this repo has no own Coolify app. Each consuming `agent-<brand>` repo defines its own.
- Primary FQDN: n/a — image publisher, no own FQDN.
- Build pack (in consuming repos): `dockercompose`
- Deploy branch: `main`
- Published image: `ghcr.io/leebaroneau/template-agent` — tags `:latest` (main) and `:sha-<commit>` (immutable).
- Source of truth: `compose.yaml` (+ `compose.build.yaml` for local image builds). Coolify in the
  consuming repos RE-FETCHES compose from git on every deploy; direct edits to `docker_compose_raw`
  in the UI are WIPED.

## Build & publish (this repo)
- Push to `main` → `.github/workflows/build-image.yml` builds `paperclip/Dockerfile` and pushes
  `:latest` + `:sha-<commit>` to GHCR. Do NOT add brand-specific deploy steps (Coolify API calls,
  brand webhooks, brand secrets) to CI here.

## How consuming repos pick up a new image
- Pin-by-tag brands set `TEMPLATE_AGENT_IMAGE` to a `:sha-<commit>` and bump it to roll forward
  (manual, deterministic rollback).
- Latest-tracking brands run `:latest` and auto-advance when the build pushes `:latest` and fires
  their deploy trigger.
- Either way the per-brand Coolify app pulls the image and self-deploys; this repo never deploys it.

## Environment variables (contract — values live per-brand, not here)
The runtime contract is documented in `.env.example`. Real values live in each brand's Coolify app
(or `.env` for local dev). Notable keys: `TEMPLATE_AGENT_IMAGE` (pinned image tag),
`PAPERCLIP_PROFILE_SYNC_API_KEY` (gates profile-sync), `HERMES_PROFILES`, `GH_TOKEN` (private repo
access), and `AGENT_STATE_REPO` / `AGENT_STATE_TOKEN` (GitHub Release backups). See `AGENTS.md` → Runtime Operations for the do-NOT-override keys
(`PAPERCLIP_ALLOWED_HOSTNAMES`, `PAPERCLIP_API_BASE`).

## Volumes (DATA — never reshape without a backup)
See `docs/volumes.md` for the full inventory. One shared named volume `paperclip-data` → `/data`
holds the Paperclip DB + Hermes profiles/state.

> WARNING: changing the `volumes:` block in `compose.yaml` can WIPE persistent data on redeploy in
> every consuming brand. Back up first (see below) before merging any such change.

## Pre-deploy backup (volume-wipe protection)
`paperclip/pre-deploy-backup.sh` runs as each brand's Coolify `pre_deployment_command`. It dumps the
Paperclip DB + tars Hermes state and uploads a snapshot to GitHub Releases on the brand state repo
BEFORE Coolify swaps the container. See `docs/pre-deploy-backup.md`.

- Wire in each consuming brand: Coolify → General → Pre-Deployment → command `bash /opt/paperclip/pre-deploy-backup.sh`, container `paperclip`.
- Snapshots live as Release assets on `AGENT_STATE_REPO`, tagged `predeploy-YYYYMMDDTHHMMSSZ`.
  They are outside git history; the old `agent-state` branch model is deprecated/deleted.
- Release assets are `paperclip-db.sql.gz`, `hermes-profiles.tar.gz`, and `manifest.json`
  uploaded last. Restore should only trust releases with a valid manifest and matching sha256s.
- `AGENT_STATE_TOKEN` is required when `AGENT_STATE_REPO` is set. SSH deploy keys cannot create
  releases, upload assets, verify asset digests, or prune release tags through the REST API.
- `AGENT_STATE_RETENTION_DAYS` defaults to 30. The hook prunes old `predeploy-*` releases and tags
  after a successful upload, bounding storage growth without rewriting git history.
- `db:backup` retries on embedded-postgres warmup (`AGENT_STATE_BACKUP_RETRIES`, default 6) and is
  fail-closed: a missing backup aborts the deploy rather than swapping without a recovery point.

## Compose / routing gotchas
- Use bare `${COOLIFY_FQDN}` / `${COOLIFY_CONTAINER_NAME}` in labels — NOT `${VAR:-default}` (breaks Traefik routing). Ordinary app env may use `${VAR:-}`.
- Multi-service: route secondary services via the app's `docker_compose_domains` map (`{name, domain}`), not `SERVICE_FQDN_*` env.
- Every traffic-receiving service needs a `healthcheck`.

## Coolify deploy gotcha (pre-deploy timing)
- `pre_deployment_command` runs in the CURRENTLY-RUNNING (old) container BEFORE the image swap, not
  in the new image. A fix to `pre-deploy-backup.sh` only governs the NEXT deploy; the deploy that
  ships the fix still runs the old script.

## Do NOT
- DELETE a consuming app with `docker_cleanup=true` (sweeps adjacent standalone containers sharing volume names — pass `docker_cleanup=false`).
- `docker exec` as root for ops touching `/data` — use `-u hermes` (root writes break later hermes-user writes).
- Trigger a manual deploy right after a push (auto-deploy already queued; duplicate).

## Status / rollback (in a consuming brand's Coolify)
- Deploy status: `GET /api/v1/deployments/<deployment-uuid>`.
- Trigger (only if auto-deploy is off): `GET /api/v1/deploy?uuid=<app-uuid>`.
- Rollback: set `TEMPLATE_AGENT_IMAGE` back to the previous `:sha-<commit>` and redeploy.
