# Paperclip Hermes GBrain

Blank Coolify-ready template for running Paperclip with Hermes Agent and GBrain.

This repo is intentionally client-neutral. It should contain the deploy recipe only. Paperclip projects, Hermes profiles, GBrain stores, API keys, and client data are created at runtime inside the Coolify volume mounted at `/data`.

## Services

- `paperclip` runs Paperclip on port `3100`.
- `hermes` runs the Hermes dashboard on port `9119`.
- Both services share the `paperclip-data` volume at `/data`.

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

## Coolify Setup

1. Create a new Docker Compose app in Coolify from this GitHub repo.
2. Set the public domains you want to use, usually:
   - `paperclip.<client-domain>`
   - `hermes.<client-domain>`
3. Generate starter environment values:

```bash
./scripts/coolify-env.sh client.example.com
```

4. Paste the generated values into Coolify and replace the example domain with the real client domain.
5. Enable role profile sync so Paperclip roles get their own Hermes profile and GBrain home:

```env
PROFILE_SYNC_ENABLED=1
PROFILE_SYNC_INTERVAL_SEC=60
PROFILE_SYNC_DELETE_MODE=archive
PAPERCLIP_PROFILE_SYNC_API_KEY=<paperclip-api-key>
```

For single-VM deployments, the same values can live in this root-readable file
instead of Coolify env:

```text
/data/agent-stack/profile-sync/profile-sync.env
```

Leave these blank unless you want to sync only specific companies:

```env
PAPERCLIP_COMPANY_IDS=
PAPERCLIP_COMPANIES=
```

6. Deploy.

For Coolify, make sure these values are not left as examples:

- `PAPERCLIP_PUBLIC_URL`
- `PAPERCLIP_ALLOWED_HOSTNAMES`
- `PAPERCLIP_HOSTNAME`
- `HERMES_HOSTNAME`
- `PAPERCLIP_PROFILE_SYNC_API_KEY`

If `PROFILE_SYNC_ENABLED` is not `1`, roles will not be automatically patched. When sync is enabled, each role is patched to:

```text
/data/hermes/profiles/<company-role>
/data/gbrain/<company-role>
```

Profile sync also mirrors the current Paperclip companies and agents into:

```text
/data/agent-stack/org-chart.md
/data/agent-stack/org-chart.json
```

Use `ORG_MIRROR_ROOT` only if you need to place those files somewhere other than
`/data/agent-stack`.

## Blank Image Audit

After a local build, audit the image before publishing or reusing it:

```bash
docker compose --env-file .env.example build
./scripts/audit-blank-image.sh paperclip-hermes-gbrain:blank
```

The audit fails if the image contains runtime state under `/data`, Lee/client deployment markers, Coolify build metadata, or token-looking secrets in image metadata.

## Runtime Data

The Dockerfile deliberately cleans `/data` during build. Runtime data appears only after a container starts with the `paperclip-data` volume mounted.

The default Hermes config is intentionally empty. The template only bootstraps neutral profile files, installs GBrain skills into Hermes profiles, and creates a separate GBrain home for each synced role.

Profile sync is available in the `paperclip` container. Enable it with `PROFILE_SYNC_ENABLED=1` and a `PAPERCLIP_PROFILE_SYNC_API_KEY` when you want Paperclip roles to be patched to their own Hermes profile and GBrain home.

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
