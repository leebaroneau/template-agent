# Volumes (data inventory)

One row per named volume / bind mount. This is the single most dangerous thing to get wrong on
Coolify — a reshaped `volumes:` block has wiped prod data before. Keep this current.

This repo ships ONE named volume, shared by both services. Per-brand deployments mount the same
shape; the data inside is brand-specific and lives only on each brand's droplet (never in this repo).

| Volume / container path | Service | What it persists | Backup command | Restore command |
| --- | --- | --- | --- | --- |
| `paperclip-data` → `/data` | paperclip + hermes (shared) | Paperclip DB (embedded postgres) + Hermes profiles/state, `agent-stack/` (org-chart, profile-sync), OAuth tokens under `hermes/.config`, `repos/` worktrees | `paperclipai db:backup --dir <dir>` for the DB; `tar czf hermes-profiles.tar.gz -C /data hermes/profiles ...` for Hermes state. Both are wired into `paperclip/pre-deploy-backup.sh` and `scripts/host/nightly-backup.sh`, which upload GitHub Release assets (`paperclip-db.sql.gz`, `hermes-profiles.tar.gz`, `manifest.json`) to the per-brand state repo. | `bash /opt/paperclip/restore-backup.sh --force latest` or `--tag <predeploy-or-nightly-tag>`. Restore downloads Release assets, refuses missing or mismatched manifests, runs `paperclipai db:restore`, extracts Hermes state into `/data`, and fixes ownership. |

Rule: before ANY change to the `volumes:` block in `compose.yaml`, back up every row above
and store the archive OUTSIDE the volume. Confirm the restore command actually works.
