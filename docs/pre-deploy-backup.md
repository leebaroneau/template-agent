# Pre-deployment backup

When a Paperclip+Hermes deployment is replaced, the shared `/data` volume must have a recovery point
outside the volume before Coolify swaps containers. This template ships a pre-deployment backup hook
that writes snapshots to GitHub Release assets on the brand's own `agent-<brand>` state repo.

## How it works

1. **Coolify deploy starts.** Coolify runs `bash /opt/paperclip/pre-deploy-backup.sh` in the old
   `paperclip` container.
2. **The script dumps state.** It runs `paperclipai db:backup`, tars Hermes profile state from
   `/data`, and creates or reuses a GitHub Release tagged `predeploy-YYYYMMDDTHHMMSSZ`.
3. **The script uploads Release assets.** It uploads `paperclip-db.sql.gz`,
   `hermes-profiles.tar.gz`, verifies each asset's size and `sha256` digest through the Releases
   API, then writes and uploads `manifest.json` last.
4. **Retention runs.** Releases tagged `predeploy-*` older than `AGENT_STATE_RETENTION_DAYS`
   are deleted, and their git tags are deleted through the API.
5. **Coolify replaces the container.** If any configured backup step fails, the hook exits non-zero
   and the deploy is blocked.

If `AGENT_STATE_REPO` is unset, the script exits 0 as a graceful no-op. This keeps blank-template
deployments usable before a state repo exists. Once `AGENT_STATE_REPO` is set, the hook is fail-closed.

## Required env vars

Set these in the Coolify application's Environment Variables tab:

| Variable | Required | Example | Notes |
| :---- | :---: | :---- | :---- |
| `AGENT_STATE_REPO` | yes to enable | `<Org>/agent-<brand>` | Repo that owns the Release backups. Leave blank for a no-op. |
| `AGENT_STATE_TOKEN` | yes when enabled | `github_pat_...` | GitHub token with `contents:write` on the state repo. Store as a secret. |
| `AGENT_STATE_BRAND` | no | `<brand>` | Short slug for logs and manifest metadata. Defaults to the repo basename. |

Optional overrides:

| Variable | Default | Notes |
| :---- | :---- | :---- |
| `AGENT_STATE_RETENTION_DAYS` | `30` | Prunes old `predeploy-*` releases and tags after successful upload. |
| `AGENT_STATE_BACKUP_RETRIES` | `6` | DB dump retry count for embedded-postgres warmup. |
| `AGENT_STATE_BACKUP_RETRY_DELAY` | `10` | Seconds between DB dump attempts. |
| `AGENT_STATE_SOURCE_COMMIT` | `unknown` | Optional commit/image identifier written into `manifest.json`. |

Deprecated variables:

| Variable | Status |
| :---- | :---- |
| `AGENT_STATE_BRANCH` | Deprecated. Snapshots no longer commit to a branch. |
| `AGENT_STATE_DEPLOY_KEY`, `AGENT_STATE_KEY`, `AGENT_STATE_KEY_FILE` | Deprecated for backups. SSH deploy keys cannot create releases, upload Release assets, verify digests, or prune tags through the Releases REST API. |
| `AGENT_STATE_ARCHIVE_SPLIT_BYTES` | Deprecated. Release assets are uploaded whole; do not split unless GitHub's 2 GB asset limit is exceeded. |

## Coolify wiring

In the Coolify application's General → Pre-Deployment section:

- **Pre-deployment command:** `bash /opt/paperclip/pre-deploy-backup.sh`
- **Pre-deployment container:** `paperclip`

The old container must already have `AGENT_STATE_REPO` and `AGENT_STATE_TOKEN`. When enabling the hook
for the first time, deploy once to get the env vars into the running container, then deploy again to
exercise the hook.

## Release layout

Each snapshot is one GitHub Release:

```text
tag: predeploy-YYYYMMDDTHHMMSSZ
assets:
  paperclip-db.sql.gz
  hermes-profiles.tar.gz
  manifest.json
```

`manifest.json` is uploaded last and contains:

- snapshot metadata: kind, tag, creation time, brand, repo, source, commit
- file names, byte sizes, and `sha256` checksums for the DB and Hermes assets

Restore tooling must refuse releases without a manifest or with mismatched checksums.

## Restoring

Use the restore helper inside a paperclip container:

```bash
bash /opt/paperclip/restore-backup.sh --force latest
bash /opt/paperclip/restore-backup.sh --force --tag predeploy-YYYYMMDDTHHMMSSZ
```

`--force` is required because restore overwrites live state. The script downloads `manifest.json`,
verifies the listed assets, restores the DB with `paperclipai db:restore`, extracts Hermes state into
`/data`, and repairs ownership.

## Host nightly backups

The host cron script uses the same Release helper and writes `nightly-YYYYMMDDTHHMMSSZ` releases.
When installing it on a droplet, copy both files:

```bash
scp scripts/host/nightly-backup.sh <host>:/root/agent-state-backup/nightly-backup.sh
scp paperclip/lib/release-backup.sh <host>:/root/agent-state-backup/release-backup.sh
```

Set `AGENT_STATE_TOKEN_FILE=/root/agent-state-backup/github-token` in `backup.env`; SSH deploy keys
are not a valid auth path for Release assets.

## Re-installing the nightly backup on a droplet

Copy or pull this repo on the droplet, ensure `/root/agent-state-backup/github-token` exists and is
non-empty, then run:

```bash
sudo scripts/host/install-nightly-backup.sh --repo <Org>/agent-<brand> --brand <brand> --compose-filter <coolify-app-uuid> --verify
```

The installer refreshes `nightly-backup.sh`, `release-backup.sh`, `backup.env`, and the cron line
idempotently. Re-run it after backup script updates or when changing the state repo, compose filter,
token path, or retention period.
