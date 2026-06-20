# template-agent — Agent Harness (Coolify backend service)

Brand-agnostic agent stack image (Paperclip + Hermes) consumed by per-brand agent-<brand> Coolify compose repos

## Project overview

Steer-before-you-act layer. The repo is the source of truth; the Coolify UI is NOT visible to an
agent. If config only exists in Coolify, mirror it into `DEPLOYMENT.md`.

This is a multi-brand deploy template / IMAGE PUBLISHER. Keep it CLIENT-NEUTRAL. Never commit API
keys, client names, client domains, runtime profiles, Coolify UUIDs, or any per-deployment value.
Brands consume the published image tag (`:latest` or a pinned `:sha-<commit>`) and trigger their
OWN deploys. Do NOT add CI steps that target a specific brand (Coolify API calls, brand webhooks,
brand secrets).

## Build and test commands

```bash
npm test                                             # template test suite (node --test + shell checks; no image build)
docker compose --env-file .env.example config -q     # compose valid against the documented contract
./scripts/doctor                                     # full local gate (run before pushing) — wraps the above
./scripts/ci-local                                 # same local gate, intended for pre-push hooks
./scripts/install-hooks                            # install local pre-push gate

# When changing the image build:
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.example build
./scripts/audit-blank-image.sh template-agent:local  # assert the image is client-neutral

./scripts/ralph                                      # autonomous loop runner (reads docs/exec-plans/active/)
```

## Code style guidelines

- `compose.yaml` is the source of truth. Coolify (in consuming repos) RE-FETCHES it from git on every deploy; direct UI edits to `docker_compose_raw` are WIPED.
- For Coolify-injected label vars use bare `${COOLIFY_FQDN}` / `${COOLIFY_CONTAINER_NAME}` — NOT `${VAR:-default}` (leaks literal into Traefik labels, breaks routing). Ordinary app env may use `${VAR:-}`.
- Multi-service: route secondary services via the app's `docker_compose_domains` map, not `SERVICE_FQDN_*` env.
- Never DEFINE Traefik router labels yourself — let Coolify generate production routing.
- `repo.harness.json` is the machine-readable repo contract. Update it when branch, runtime, or check assumptions change.

## Testing instructions

- `./scripts/doctor` is the local hard gate. Wraps the template test suite, compose-contract validation,
  Coolify routing/healthcheck guardrails, `repo.harness.json` schema validation, and cross-link
  validation across `docs/`. It does NOT build the full agent-stack image — that is owned by
  `.github/workflows/build-image.yml` on merge to `main`.
- This repo has no Coolify preview deploy of its own (it publishes an image). Validate changes via
  `./scripts/doctor` + the local stack (`scripts/local-up.sh`).

## Security considerations

- `.env` is never committed; `.env.example` documents the runtime contract. Real values live per-brand in Coolify.
- NEVER reshape the `volumes:` block without a backup first — that has wiped prod data before. The pre-deploy backup (`docs/pre-deploy-backup.md`) is the safety net.
- Never DELETE a consuming app with `docker_cleanup=true` (sweeps adjacent containers sharing volume names).
- `docker exec` against the running stack that touches `/data` must use `-u hermes` (root writes break later hermes-user writes).

## Commit and PR format

- Issue → branch → PR (Pipeline Core). Branch prefix matches issue type (`bug|story|task|spike|experiment|epic`). PR body includes `Fixes #<issue>`.
- Run `./scripts/doctor` locally before push/PR. GitHub Actions are reserved for Pipeline Core workflow management and real deploy automation, not harness check duplication.
- Push to `main` builds + publishes the image (`:latest` + `:sha-<commit>`). Consuming brands self-deploy; do NOT add brand deploy triggers here.

## Development environment

- FQDN: n/a — image publisher, no own FQDN
- Coolify resource UUID: n/a — no own Coolify app; each consuming `agent-<brand>` repo defines its own
- Deploy branch: `main`
- Org: leebaroneau
- Build pack (consuming repos): Docker Compose

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

## Knowledge map (where to look)

- `DEPLOYMENT.md` — image-publish model, env contract, volumes, pre-deploy backup, gotchas, rollback.
- `docs/volumes.md` — data inventory + backup/restore for the shared `/data` volume.
- `docs/pre-deploy-backup.md` — protect `/data` from deploy-time volume wipes.
- `docs/exec-plans/active/` — in-flight plans driving current work.
- `docs/exec-plans/tech-debt-tracker.md` — accumulated debt with severity.
- `skills/` — repo-local skills (review, verify, deploy) invokable by any agent.

See also: `MEMORY.md` (gotchas), `CLAUDE.md` (→ this file).

<!-- pipeline-core-agent-instructions:start -->
## Pipeline Core Repo Ownership

This repo owns the code in this checkout. All GitHub issues, branches, commits, and PRs for work in this repo must be created in this repository.

Do not create tracking issues or implementation PRs in `lee-dashboard` unless the change is dashboard-owned. If an agent starts from `lee-dashboard` context, it must first resolve the owner repo, then run GitHub commands with `--repo <owner>/<repo>` or work from this checkout.

Pipeline Core workflow:
1. Create the GitHub issue first with a `type:` label and a human-readable title prefix such as `Task:`, `Bug:`, or `Feature request:`.
2. Branch as `<type>/<issue-number>-<slug>`, for example `task/123-update-agent-routing`.
3. Open the PR with `Fixes #<issue-number>` in the body.
<!-- pipeline-core-agent-instructions:end -->
