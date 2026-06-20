---
name: deploy
description: Production deploy procedure for this Coolify-hosted service. Push, monitor, verify, rollback.
---

# Deploy

This service auto-deploys via Coolify webhook when commits land on `main`.

## Standard release

1. Confirm `./scripts/doctor` passed on the merge commit and the deployment workflow, if any, is green.
2. Merge to `main` — Coolify webhook fires; do NOT also trigger a manual deploy (queues a duplicate).
3. Watch the Coolify deploy log until the new container is healthy.
4. Hit `/healthz` against `<FQDN>` — expect `200`.
5. Tail logs for ~2 minutes after the new container takes traffic. Look for new error patterns.

## Rollback

1. In the Coolify UI, open the application → Deployments → pick the prior successful deploy → Redeploy.
2. Confirm `/healthz` recovers on `<FQDN>`.
3. Open an issue documenting what broke, severity, and follow-up.

## Pre-deploy backup

If the deploy includes a schema migration, volume change, or anything touching `/data`:

1. Follow `docs/pre-deploy-backup.md` BEFORE merging.
2. Capture the backup artifact location in the PR description.

## Do not

- Never DELETE the Coolify app with `docker_cleanup=true` (sweeps adjacent containers sharing volume names).
- Never reshape the `volumes:` block without a verified backup.
- Never trigger a manual deploy immediately after a push (queues a duplicate).
