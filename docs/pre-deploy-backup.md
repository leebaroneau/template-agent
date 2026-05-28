# Pre-deployment backup

When a Paperclip+Hermes deployment is replaced (e.g. by a Coolify redeploy after a compose-shape change), the `/data` volume sometimes gets wiped. This template ships a pre-deployment backup hook that snapshots the volume to a per-brand state repo on GitHub *before* the new container takes over.

## How it works

1. **Container start.** `paperclip/entrypoint.sh` reads `AGENT_STATE_DEPLOY_KEY` from env. If set, it base64-decodes it into `/home/node/.ssh/agent-state-deploy` (`chmod 600`, owned by `node`) and pins `github.com`'s host key into `known_hosts`.
2. **Coolify deploy starts.** Coolify's `pre_deployment_command` runs `docker exec` against the OLD container, invoking `bash /opt/paperclip/pre-deploy-backup.sh`.
3. **The script** dumps Paperclip's DB (`paperclipai db:backup`), tars `/data/hermes/profiles/`, clones the state repo via the deploy key, drops the snapshots into a `YYYY-MM-DD/` directory, commits and pushes.
4. **Coolify replaces the container.** The new container's entrypoint re-installs the SSH key, ready for the next deploy.

If `AGENT_STATE_DEPLOY_KEY` is unset, both the entrypoint key-install and the backup script are graceful no-ops — the deployment proceeds unchanged. This keeps the template usable for new instances that haven't wired up a state repo yet.

## Required env vars

Set these in the Coolify application's Environment Variables tab:

| Variable | Required | Example | Notes |
| :---- | :---: | :---- | :---- |
| `AGENT_STATE_REPO` | yes | `Haverford-Brands/agent-haverford` | The state-only repo to push snapshots to. |
| `AGENT_STATE_BRAND` | no | `haverford` | Short slug used in commit messages. Defaults to the repo basename. |
| `AGENT_STATE_DEPLOY_KEY` | yes | `LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZ...` (base64) | Base64 of an SSH private key whose public half is registered as a write-enabled deploy key on the state repo. Generate per-brand; never share across brands. |

Optional overrides:

| Variable | Default | Notes |
| :---- | :---- | :---- |
| `AGENT_STATE_KEY_FILE` | `/home/node/.ssh/agent-state-deploy` | Where the entrypoint writes the decoded key. Change only if you need an alternate path. |
| `AGENT_STATE_WORKDIR` | `/tmp/agent-state-repo` | Working directory for the clone inside the container. |

## Coolify wiring

In the Coolify application's General → Pre-Deployment section:

- **Pre-deployment command:** `bash /opt/paperclip/pre-deploy-backup.sh`
- **Pre-deployment container:** `paperclip` (the compose service name where `paperclipai` lives)

## Generating the deploy key

On your droplet (or any machine):

```bash
# 1. Generate a per-brand keypair
ssh-keygen -t ed25519 -C "agent-<brand>-pre-deploy" -f ~/.ssh/agent-<brand>-deploy -N ''

# 2. Add the public key as a write-enabled deploy key on the state repo
gh api -X POST repos/<Org>/agent-<brand>/keys \
  -f title="pre-deploy backup hook" \
  -f key="$(cat ~/.ssh/agent-<brand>-deploy.pub)" \
  -F read_only=false

# 3. Base64-encode the private key and set it in Coolify
base64 -w 0 ~/.ssh/agent-<brand>-deploy
# Paste the output into Coolify as AGENT_STATE_DEPLOY_KEY (mark it as secret).
```

## State repo layout

Each snapshot is committed as a dated directory at the repo root:

```
agent-<brand>/
├── README.md
├── 2026-05-22/
│   ├── paperclip-db.sql.gz
│   └── hermes-profiles.tar.gz
└── 2026-05-23/
    └── ...
```

Files larger than `AGENT_STATE_ARCHIVE_SPLIT_BYTES` are committed as numbered
`.part-0000` files to stay under GitHub's 100 MB per-file limit. The default
split size is 95,000,000 bytes. Restore by concatenating matching parts in
lexical order before running `tar`.

A separate nightly cron on the droplet host (`/root/agent-haverford-backup/nightly-backup.sh` on the Haverford droplet) can co-exist with this pre-deploy hook. Both push to the same state repo; pre-deploy commits and nightly commits land naturally in date order.

## Restoring from a snapshot

See the state repo's own README for the canonical restore procedure.
