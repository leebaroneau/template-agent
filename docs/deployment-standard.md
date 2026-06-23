# Brand deployment standard

This is the canonical runbook for deploying a brand's dual Paperclip+Hermes stack from `template-agent`. Every brand deployment must match this shape — same backup chain, same env vars, same restore procedure — so we never lose state to a volume wipe.

If you're spinning up a new brand, follow [Setup](#setup-a-new-brand). If you're auditing an existing one, follow [Compliance audit](#compliance-audit). If you've lost data, follow [Restore](#restore).

## Why this exists

The dual container stores all live state (Paperclip DB, Hermes profiles) on a single `/data` volume. Volume-shape changes during deploy have wiped this volume in the past (3× in one week on the Haverford instance, per the [`feedback_paperclip_volume_shape_change_wipes_data`](https://github.com/leebaroneau/lee-dashboard/blob/main/.claude/projects/-Users-leebaroneau-Documents-GitHub-lee-dashboard/memory/feedback_paperclip_volume_shape_change_wipes_data.md) memory). Two backup mechanisms layer to keep data loss windows tight:

| When | Mechanism | Ships from | Writes to |
| :---- | :---- | :---- | :---- |
| Nightly @ 17:00 UTC | Host-side cron runs [`scripts/host/nightly-backup.sh`](../scripts/host/nightly-backup.sh) | template-agent (template; operator copies once) | GitHub Release assets on the brand state repo |
| Before every deploy | Coolify `pre_deployment_command` runs [`paperclip/pre-deploy-backup.sh`](../paperclip/pre-deploy-backup.sh) inside the OLD container | template-agent (baked into image) | GitHub Release assets on the brand state repo |

Both write to the same `<Org>/agent-<brand>` GitHub repo, using Release tags named
`nightly-YYYYMMDDTHHMMSSZ` and `predeploy-YYYYMMDDTHHMMSSZ`. The assets live outside git history:
`paperclip-db.sql.gz`, `hermes-profiles.tar.gz`, and `manifest.json`.

Hermes profile archives intentionally exclude reconstructible dependency/cache folders and nested
historical profile backups (`profile-backups`, `python-packages`, `bin`, `lsp`, `cache`,
`audio_cache`, `__pycache__`). The state repo should preserve current operational state, not
duplicate package installs. Release assets are uploaded whole; the old split-file git commit model is
deprecated.

## Uniform repo shape

Every brand deployment uses the same repo boundary:

- `leebaroneau/template-agent` is the only deployable code base for the stock Paperclip+Hermes stack.
- `<Org>/agent-<brand>` is a private state-only repo. It holds nightly and pre-deploy Release
  snapshots only, not Dockerfiles, compose files, runtime seed scripts, or brand wrapper code.
- Coolify deploys the brand stack from `template-agent` and injects brand-specific settings through environment variables, persistent storage, and the `/data` volume.
- Both backup paths upload to the brand's `agent-<brand>` repo so restore history lives with the brand while deployable code stays centralized.

If an older brand repo still contains a deployment wrapper, forked agent code, or the deprecated
`agent-state` snapshot branch, archive or delete that history before relying on Release assets as the
canonical state store.

## Mandatory requirements per brand

A brand deployment is "compliant" iff all of the following are true:

- [ ] A private GitHub repo exists at `<Org>/agent-<brand>` (state-only; no code)
- [ ] A GitHub token with `contents:write` on that repo is available to both backup paths
- [ ] The droplet host has a root-owned token file at `/root/agent-state-backup/github-token` (mode 600)
- [ ] A `backup.env` file on the droplet sets `AGENT_STATE_REPO`, `AGENT_STATE_BRAND`, `AGENT_STATE_COMPOSE_FILTER`, `AGENT_STATE_TOKEN_FILE`, and `AGENT_STATE_RETENTION_DAYS`
- [ ] A cron entry at `0 17 * * *` UTC (or equivalent) runs `nightly-backup.sh` and appends to `/var/log/agent-state-backup.log`
- [ ] Coolify env vars on the application include `AGENT_STATE_REPO`, `AGENT_STATE_BRAND`, `AGENT_STATE_TOKEN`, and optionally `AGENT_STATE_RETENTION_DAYS`
- [ ] Coolify `pre_deployment_command` is set to `bash /opt/paperclip/pre-deploy-backup.sh`
- [ ] Coolify `pre_deployment_command_container` is set to `paperclip` (the dual-container's paperclip service)
- [ ] At least one valid `nightly-*` release AND one valid `predeploy-*` release exist on the state repo

The [Compliance audit](#compliance-audit) section is a checklist that maps each of these to a one-line shell check.

## Setup a new brand

You will need:
- A GitHub organization to hold the state repo (`alx-finance`, `haverford-brands`, etc.)
- A GitHub token with `contents:write` on the target state repo
- SSH access to the brand's droplet (`ssh <brand>-droplet`)
- Coolify API access for the brand (token + base URL)

### 1. Create the state repo

```bash
gh repo create <Org>/agent-<brand> --private \
  --description "Nightly + pre-deploy state backups for the <brand> Paperclip+Hermes Coolify deployment. Code lives in leebaroneau/template-agent."
```

Seed a `README.md` describing the snapshot layout (see [`Haverford-Brands/agent-haverford/README.md`](https://github.com/Haverford-Brands/agent-haverford) for a canonical example).

### 2. Store the backup token

```bash
# On the droplet, store a GitHub token with contents:write on the state repo.
ssh <brand>-droplet
mkdir -p /root/agent-state-backup
printf '%s\n' '<github-token>' > /root/agent-state-backup/github-token
chmod 600 /root/agent-state-backup/github-token
```

SSH deploy keys are not sufficient for this backup path. GitHub Release asset upload, digest
verification, release pruning, and tag deletion all require the REST API with a bearer token.

### 3. Install the nightly script + helper + env file + cron

```bash
# Copy the template script and shared Release helper onto the droplet:
scp scripts/host/nightly-backup.sh <brand>-droplet:/root/agent-state-backup/nightly-backup.sh
scp paperclip/lib/release-backup.sh <brand>-droplet:/root/agent-state-backup/release-backup.sh
ssh <brand>-droplet "chmod +x /root/agent-state-backup/nightly-backup.sh"

# Create /root/agent-state-backup/backup.env with the brand's values:
ssh <brand>-droplet "cat > /root/agent-state-backup/backup.env <<EOF
AGENT_STATE_REPO=<Org>/agent-<brand>
AGENT_STATE_BRAND=<brand>
AGENT_STATE_TOKEN_FILE=/root/agent-state-backup/github-token
AGENT_STATE_COMPOSE_FILTER=<coolify-app-uuid>
AGENT_STATE_RETENTION_DAYS=30
EOF
chmod 600 /root/agent-state-backup/backup.env"

# Install the cron at 17:00 UTC daily:
ssh <brand>-droplet "(crontab -l 2>/dev/null | grep -v 'agent-state-backup'; \
  echo '0 17 * * * /root/agent-state-backup/nightly-backup.sh >> /var/log/agent-state-backup.log 2>&1') | crontab -"

# Smoke-test by running it manually once:
ssh <brand>-droplet "/root/agent-state-backup/nightly-backup.sh"
```

A new `nightly-*` Release should land on `<Org>/agent-<brand>`. If not, check
`/var/log/agent-state-backup.log` on the droplet.

### 4. Wire the Coolify pre-deploy hook

```bash
TOKEN="<coolify-api-token-for-this-brand>"
BASE="<coolify-base-url>"
APP_UUID="<coolify-app-uuid>"

# Set the env vars on the Coolify application:
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/v1/applications/$APP_UUID/envs" \
  -d "{\"key\":\"AGENT_STATE_REPO\",\"value\":\"<Org>/agent-<brand>\",\"is_preview\":false,\"is_buildtime\":false}"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/v1/applications/$APP_UUID/envs" \
  -d "{\"key\":\"AGENT_STATE_BRAND\",\"value\":\"<brand>\",\"is_preview\":false,\"is_buildtime\":false}"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/v1/applications/$APP_UUID/envs" \
  -d "{\"key\":\"AGENT_STATE_TOKEN\",\"value\":\"<github-token>\",\"is_preview\":false,\"is_buildtime\":false}"

# Set pre_deployment_command + container:
curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/v1/applications/$APP_UUID" \
  -d '{"pre_deployment_command":"bash /opt/paperclip/pre-deploy-backup.sh","pre_deployment_command_container":"paperclip"}'
```

> ⚠️ Coolify's API field name is `pre_deployment_command_container` (with `_command`). The GET response uses `pre_deployment_container_name` (without `_command`). Use `_command_container` for PATCH, despite the inconsistency.

### 5. Two-deploy bootstrap

The pre-deploy hook reads the env vars on the OLD container, but the OLD container predates step 4 so it doesn't have them yet. You need two deploys to fully bootstrap:

```bash
# Deploy 1: container restarts with the new env vars (including token);
# pre-deploy on the OLD container safely no-ops if AGENT_STATE_REPO is not present.
curl -sS -X GET -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/deploy?uuid=$APP_UUID&force=true"

# Wait for deploy 1 to finish (status=finished), then deploy 2:
# This one's OLD container HAS the token, so pre-deploy fires correctly.
curl -sS -X GET -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/deploy?uuid=$APP_UUID&force=true"
```

After deploy 2, a `predeploy-*` Release should appear on `<Org>/agent-<brand>`.

## Compliance audit

For an existing brand, run these one-liners. Each `✓` means that requirement is met.

```bash
# 1. State repo exists + has releases
gh api repos/<Org>/agent-<brand>/releases --jq 'length' && echo "✓ state repo has releases"

# 2. Last nightly release is < 36h old
last_nightly=$(gh api repos/<Org>/agent-<brand>/releases \
  --jq '[.[] | select(.tag_name | startswith("nightly-"))][0].published_at')
echo "Last nightly: $last_nightly"

# 3. Pre-deploy releases exist
gh api repos/<Org>/agent-<brand>/releases \
  --jq '[.[] | select(.tag_name | startswith("predeploy-"))] | length' \
  | xargs -I{} echo "Pre-deploy releases found: {}"

# 4. Cron is installed on the droplet
ssh <brand>-droplet "crontab -l | grep -E 'agent-state-backup' && echo '✓ cron installed'"

# 5. The host script + env file exist
ssh <brand>-droplet "test -x /root/agent-state-backup/nightly-backup.sh && echo '✓ host script present'"
ssh <brand>-droplet "test -f /root/agent-state-backup/backup.env && echo '✓ backup.env present'"

# 6. Coolify env vars are set
TOKEN="<coolify-api-token>"; BASE="<coolify-base-url>"; APP_UUID="<coolify-app-uuid>"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/applications/$APP_UUID/envs" \
  | jq -r '.[].key' | grep -E '^AGENT_STATE_(REPO|BRAND|TOKEN|RETENTION_DAYS)$' | sort -u

# 7. Coolify pre_deployment_command is set
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/applications/$APP_UUID" \
  | jq -r '"pre_deployment_command: \(.pre_deployment_command)"'
```

If any line is missing or returns an empty result, that requirement is NOT met. Open an issue, fix it, re-audit.

## Restore

The state repo's own README documents the restore procedure for that specific brand. The general pattern is to run the image-baked restore helper inside the paperclip container:

```bash
docker exec <paperclip-container> bash /opt/paperclip/restore-backup.sh --force latest
docker exec <paperclip-container> bash /opt/paperclip/restore-backup.sh --force --tag predeploy-YYYYMMDDTHHMMSSZ
```

The helper downloads `manifest.json`, refuses missing or mismatched checksums, restores the DB via
`paperclipai db:restore`, extracts Hermes state into `/data`, and fixes ownership.

## Related docs

- [`docs/pre-deploy-backup.md`](pre-deploy-backup.md) — deeper dive on the Coolify pre-deploy hook, Release assets, env vars, and restore
- [`scripts/host/nightly-backup.sh`](../scripts/host/nightly-backup.sh) — the host-side nightly script (brand-agnostic via env)
- [`paperclip/pre-deploy-backup.sh`](../paperclip/pre-deploy-backup.sh) — the in-container pre-deploy script (baked into the image)

## Known reference deployment

The Haverford brand was the first deployment fully wired to this standard. Audit it any time to see what a compliant brand looks like end-to-end:

- Coolify app: `g1177fqvz8uyq3irqj3hl5b8` on `coolify.haverford.au`
- State repo: [`Haverford-Brands/agent-haverford`](https://github.com/Haverford-Brands/agent-haverford)
- Droplet: `haverford-droplet` (root SSH access via `~/.ssh/haverford-droplet`)
- Cron: `0 17 * * *` UTC at `/root/agent-haverford-backup/nightly-backup.sh` (legacy path; new deployments should use `/root/agent-state-backup/`)
