# Brand deployment standard

This is the canonical runbook for deploying a brand's dual Paperclip+Hermes stack from `template-agent`. Every brand deployment must match this shape — same backup chain, same env vars, same restore procedure — so we never lose state to a volume wipe.

If you're spinning up a new brand, follow [Setup](#setup-a-new-brand). If you're auditing an existing one, follow [Compliance audit](#compliance-audit). If you've lost data, follow [Restore](#restore).

## Why this exists

The dual container stores all live state (Paperclip DB, Hermes profiles, GBrain pglites) on a single `/data` volume. Volume-shape changes during deploy have wiped this volume in the past (3× in one week on the Haverford instance, per the [`feedback_paperclip_volume_shape_change_wipes_data`](https://github.com/leebaroneau/lee-dashboard/blob/main/.claude/projects/-Users-leebaroneau-Documents-GitHub-lee-dashboard/memory/feedback_paperclip_volume_shape_change_wipes_data.md) memory). Two backup mechanisms layer to keep data loss windows tight:

| When | Mechanism | Ships from | Pushes to |
| :---- | :---- | :---- | :---- |
| Nightly @ 17:00 UTC | Host-side cron runs [`scripts/host/nightly-backup.sh`](../scripts/host/nightly-backup.sh) | template-agent (template; operator copies once) | brand state repo |
| Before every deploy | Coolify `pre_deployment_command` runs [`paperclip/pre-deploy-backup.sh`](../paperclip/pre-deploy-backup.sh) inside the OLD container | template-agent (baked into image) | brand state repo |

Both push to the same `<Org>/agent-<brand>` GitHub repo, which holds dated snapshot directories with the Paperclip DB dump, tarred Hermes profiles, and tarred GBrain pglites.

Hermes profile archives intentionally exclude reconstructible dependency/cache folders and nested historical profile backups (`profile-backups`, `python-packages`, `bin`, `lsp`, `cache`, `audio_cache`, `__pycache__`). The state repo should preserve current operational state, not duplicate package installs or old backup material that can push snapshots past GitHub's 100 MB per-file limit.

## Uniform repo shape

Every brand deployment uses the same repo boundary:

- `leebaroneau/template-agent` is the only deployable code base for the stock Paperclip+Hermes+GBrain stack.
- `<Org>/agent-<brand>` is a private state-only repo. It holds nightly and pre-deploy snapshots only, not Dockerfiles, compose files, runtime seed scripts, or brand wrapper code.
- Coolify deploys the brand stack from `template-agent` and injects brand-specific settings through environment variables, persistent storage, and the `/data` volume.
- Both backup paths push into the brand's `agent-<brand>` repo so restore history lives with the brand while deployable code stays centralized.

If an older brand repo still contains a deployment wrapper or forked agent code, archive that history to a branch/tag before converting `main` to the state-only snapshot layout.

## Mandatory requirements per brand

A brand deployment is "compliant" iff all of the following are true:

- [ ] A private GitHub repo exists at `<Org>/agent-<brand>` (state-only; no code)
- [ ] An SSH deploy key with write access is registered on that repo. If deploy keys are disabled for the repo/org, use a root-owned GitHub token file instead.
- [ ] The droplet host has the private key at a known path (e.g. `/root/.ssh/agent-<brand>-deploy`, mode 600), or a root-owned token file at `/root/agent-state-backup/github-token` (mode 600)
- [ ] An `ssh-keyscan github.com` line is in the droplet's `~/.ssh/known_hosts`
- [ ] The state repo has been cloned once on the droplet at `/root/agent-state-backup/repo` (or equivalent), with the SSH alias `github-agent-state` mapping the deploy key to github.com
- [ ] A `backup.env` file on the droplet sets `AGENT_STATE_REPO`, `AGENT_STATE_BRAND`, `AGENT_STATE_COMPOSE_FILTER`, and either `AGENT_STATE_KEY` or `AGENT_STATE_TOKEN_FILE`
- [ ] A cron entry at `0 17 * * *` UTC (or equivalent) runs `nightly-backup.sh` and appends to `/var/log/agent-state-backup.log`
- [ ] Coolify env vars on the application include `AGENT_STATE_REPO`, `AGENT_STATE_BRAND`, and either `AGENT_STATE_DEPLOY_KEY` (base64 of the private key; marked secret) or `AGENT_STATE_TOKEN` (marked secret)
- [ ] Coolify `pre_deployment_command` is set to `bash /opt/paperclip/pre-deploy-backup.sh`
- [ ] Coolify `pre_deployment_command_container` is set to `paperclip` (the dual-container's paperclip service)
- [ ] At least one nightly commit AND one pre-deploy commit have landed on the state repo

The [Compliance audit](#compliance-audit) section is a checklist that maps each of these to a one-line shell check.

## Setup a new brand

You will need:
- A GitHub organization to hold the state repo (`alx-finance`, `haverford-brands`, etc.)
- A `gh` CLI session authenticated as a user with `admin:public_key` scope on the target repo (for adding the deploy key)
- SSH access to the brand's droplet (`ssh <brand>-droplet`)
- Coolify API access for the brand (token + base URL)

### 1. Create the state repo

```bash
gh repo create <Org>/agent-<brand> --private \
  --description "Nightly + pre-deploy state backups for the <brand> Paperclip+Hermes Coolify deployment. Code lives in leebaroneau/template-agent."
```

Seed a `README.md` describing the snapshot layout (see [`Haverford-Brands/agent-haverford/README.md`](https://github.com/Haverford-Brands/agent-haverford) for a canonical example).

### 2. Generate the deploy key + register it

```bash
# On the droplet, NOT on your laptop, so the key never leaves prod:
ssh <brand>-droplet
ssh-keygen -t ed25519 -C "agent-<brand>-state-backup@<brand>-droplet" \
  -f ~/.ssh/agent-<brand>-deploy -N ''

# Register the public half on the state repo (write-enabled):
gh api -X POST repos/<Org>/agent-<brand>/keys \
  -f title="<brand>-droplet state backup" \
  -f key="$(cat ~/.ssh/agent-<brand>-deploy.pub)" \
  -F read_only=false
```

If GitHub returns `Deploy keys are disabled for this repository`, store a GitHub token with push access as `/root/agent-state-backup/github-token` on the droplet (`chmod 600`) and use `AGENT_STATE_TOKEN_FILE=/root/agent-state-backup/github-token` in `backup.env`. For the Coolify pre-deploy hook, set `AGENT_STATE_TOKEN` as a secret runtime variable instead of `AGENT_STATE_DEPLOY_KEY`.

### 3. Wire SSH alias + first clone (host-side)

```bash
# Append to droplet's ~/.ssh/config:
cat >> ~/.ssh/config <<EOF
Host github-agent-state
  HostName github.com
  User git
  IdentityFile /root/.ssh/agent-<brand>-deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF

mkdir -p /root/agent-state-backup
git clone github-agent-state:<Org>/agent-<brand>.git /root/agent-state-backup/repo
```

### 4. Install the nightly script + env file + cron

```bash
# Copy the template script onto the droplet:
scp scripts/host/nightly-backup.sh <brand>-droplet:/root/agent-state-backup/nightly-backup.sh
ssh <brand>-droplet "chmod +x /root/agent-state-backup/nightly-backup.sh"

# Create /root/agent-state-backup/backup.env with the brand's values:
ssh <brand>-droplet "cat > /root/agent-state-backup/backup.env <<EOF
AGENT_STATE_REPO=<Org>/agent-<brand>
AGENT_STATE_BRAND=<brand>
AGENT_STATE_KEY=/root/.ssh/agent-<brand>-deploy
# Or, when deploy keys are disabled:
# AGENT_STATE_TOKEN_FILE=/root/agent-state-backup/github-token
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

A new commit should land on `<Org>/agent-<brand>`. If not, check `/var/log/agent-state-backup.log` on the droplet.

### 5. Wire the Coolify pre-deploy hook

```bash
TOKEN="<coolify-api-token-for-this-brand>"
BASE="<coolify-base-url>"
APP_UUID="<coolify-app-uuid>"

# Set the three env vars on the Coolify application:
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/v1/applications/$APP_UUID/envs" \
  -d "{\"key\":\"AGENT_STATE_REPO\",\"value\":\"<Org>/agent-<brand>\",\"is_preview\":false,\"is_buildtime\":false}"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/v1/applications/$APP_UUID/envs" \
  -d "{\"key\":\"AGENT_STATE_BRAND\",\"value\":\"<brand>\",\"is_preview\":false,\"is_buildtime\":false}"

# For the SSH key, do the base64 + POST on the droplet so the secret
# never leaves prod (and never lands in your shell history):
ssh <brand>-droplet "KEY_B64=\$(base64 -w 0 ~/.ssh/agent-<brand>-deploy); \
  jq -nc --arg v \"\$KEY_B64\" '{key:\"AGENT_STATE_DEPLOY_KEY\", value:\$v, is_preview:false, is_buildtime:false, is_literal:true, is_multiline:false}' | \
  curl -sS -X POST -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' \
    --data-binary @- '$BASE/api/v1/applications/$APP_UUID/envs'"

# If deploy keys are disabled, set AGENT_STATE_TOKEN as a secret runtime env
# instead of AGENT_STATE_DEPLOY_KEY.

# Set pre_deployment_command + container:
curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/v1/applications/$APP_UUID" \
  -d '{"pre_deployment_command":"bash /opt/paperclip/pre-deploy-backup.sh","pre_deployment_command_container":"paperclip"}'
```

> ⚠️ Coolify's API field name is `pre_deployment_command_container` (with `_command`). The GET response uses `pre_deployment_container_name` (without `_command`). Use `_command_container` for PATCH, despite the inconsistency.

### 6. Two-deploy bootstrap

The pre-deploy hook reads the env vars on the OLD container, but the OLD container predates step 5 so it doesn't have them yet. You need two deploys to fully bootstrap:

```bash
# Deploy 1: container restarts with the new env vars (including key);
# pre-deploy on the OLD container safely no-ops since no key is present.
curl -sS -X GET -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/deploy?uuid=$APP_UUID&force=true"

# Wait for deploy 1 to finish (status=finished), then deploy 2:
# This one's OLD container HAS the key, so pre-deploy fires correctly.
curl -sS -X GET -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/deploy?uuid=$APP_UUID&force=true"
```

After deploy 2, a `Pre-deploy snapshot: <date> (<brand>)` commit should appear on `<Org>/agent-<brand>` — by the `agent-state-pre-deploy` author, not the nightly `agent-state-nightly-backup` author.

## Compliance audit

For an existing brand, run these one-liners. Each `✓` means that requirement is met.

```bash
# 1. State repo exists + has content
gh api repos/<Org>/agent-<brand>/commits --jq 'length' && echo "✓ state repo has commits"

# 2. Last nightly commit is < 36h old
last_nightly=$(gh api repos/<Org>/agent-<brand>/commits \
  --jq '[.[] | select(.commit.author.name=="agent-state-nightly-backup")][0].commit.author.date')
echo "Last nightly: $last_nightly"

# 3. Pre-deploy commits exist
gh api repos/<Org>/agent-<brand>/commits \
  --jq '[.[] | select(.commit.author.name=="agent-state-pre-deploy")] | length' \
  | xargs -I{} echo "Pre-deploy commits found: {}"

# 4. Cron is installed on the droplet
ssh <brand>-droplet "crontab -l | grep -E 'agent-state-backup' && echo '✓ cron installed'"

# 5. The host script + env file exist
ssh <brand>-droplet "test -x /root/agent-state-backup/nightly-backup.sh && echo '✓ host script present'"
ssh <brand>-droplet "test -f /root/agent-state-backup/backup.env && echo '✓ backup.env present'"

# 6. Coolify env vars are set
TOKEN="<coolify-api-token>"; BASE="<coolify-base-url>"; APP_UUID="<coolify-app-uuid>"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/applications/$APP_UUID/envs" \
  | jq -r '.[].key' | grep -E '^AGENT_STATE_(REPO|BRAND|DEPLOY_KEY)$' | sort -u

# 7. Coolify pre_deployment_command is set
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/applications/$APP_UUID" \
  | jq -r '"pre_deployment_command: \(.pre_deployment_command)"'
```

If any line is missing or returns an empty result, that requirement is NOT met. Open an issue, fix it, re-audit.

## Restore

The state repo's own README documents the restore procedure for that specific brand. The general pattern:

```bash
# 1. SSH to droplet, clone the state repo
git clone github-agent-state:<Org>/agent-<brand>.git
cd agent-<brand>/<date-to-restore-from>

# 2. Restore Paperclip DB
docker cp paperclip-db.sql.gz <paperclip-container>:/tmp/
docker exec <paperclip-container> paperclipai db:restore /tmp/paperclip-db.sql.gz

# 3. Restore Hermes profiles + GBrain
docker cp hermes-profiles.tar.gz <hermes-container>:/data/
docker cp gbrain.tar.gz <hermes-container>:/data/
docker exec <hermes-container> bash -c 'cd /data && tar xzf hermes-profiles.tar.gz && tar xzf gbrain.tar.gz'
```

## Related docs

- [`docs/pre-deploy-backup.md`](pre-deploy-backup.md) — deeper dive on the Coolify pre-deploy hook (what's in the image, env vars, generating the key)
- [`scripts/host/nightly-backup.sh`](../scripts/host/nightly-backup.sh) — the host-side nightly script (brand-agnostic via env)
- [`paperclip/pre-deploy-backup.sh`](../paperclip/pre-deploy-backup.sh) — the in-container pre-deploy script (baked into the image)

## Known reference deployment

The Haverford brand was the first deployment fully wired to this standard. Audit it any time to see what a compliant brand looks like end-to-end:

- Coolify app: `g1177fqvz8uyq3irqj3hl5b8` on `coolify.haverford.au`
- State repo: [`Haverford-Brands/agent-haverford`](https://github.com/Haverford-Brands/agent-haverford)
- Droplet: `haverford-droplet` (root SSH access via `~/.ssh/haverford-droplet`)
- Cron: `0 17 * * *` UTC at `/root/agent-haverford-backup/nightly-backup.sh` (legacy path; new deployments should use `/root/agent-state-backup/`)
