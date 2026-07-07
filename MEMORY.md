# template-agent — Memory

Gotchas, decisions, and Coolify-UI-only facts discovered while working this repo. Append as you learn.
Durable patterns graduate into `AGENTS.md` or `DEPLOYMENT.md`.

## Gotchas

### Hermes TUI lazy session metadata can falsely show 0 tools / 0 skills (diagnosed 2026-06-22)

Hermes `tui_gateway` returns a lazy `session.create` payload before `AIAgent`
construction completes. Stock Hermes fills that first payload with empty
`tools` and `skills`, then expects a later `session.info` event to hydrate the
panel. On slower starts, disconnects, or killed gateway builds, a healthy
profile can visibly stay at `0 tools / 0 skills` even when `hermes tools list`
and `hermes skills list` are populated. `template-agent` patches
`tui_gateway/server.py` at Hermes container startup so lazy metadata uses fast
configured-toolset and skill inventories immediately.

### GHA cache service can reject writes even with quota free (diagnosed 2026-07-07)

`failed to reserve cache` from buildx killed image builds three times (Jul 5/6
nightlies, first v2026.7.1 build) — twice at 9.19GB quota, once with the cache
fully purged. #287 set `type=gha,mode=max,ignore-error=true` on every cache-to;
the ghcr `:buildcache` registry cache is authoritative. Hermes ≥v0.18.0 layers
are notably larger (bundled Playwright Chromium — install.sh no longer
autodetects a system browser).

### Coolify pre_deployment_command falls back to another container (observed 2026-07-07)

`pre_deployment_command_container: paperclip` still executes — in the hermes
container — when no paperclip container exists (scale 0). Deploys therefore run
`pre-deploy-backup.sh` from whatever OLD image is live, not the incoming one:
a backup-script fix only protects deploys AFTER the image carrying it is
already running (we bridged with `docker cp` hot-patches into /opt).

## Key decisions

### Paperclip is opt-in, default OFF (2026-07-07, #261/#285)

Lee runs Hermes-only for now. `PAPERCLIP_ENABLED=1` in a brand's Coolify env +
redeploy re-enables; /data Paperclip state is preserved. Backups skip the DB
dump while disabled but keep the Hermes archive fail-closed.

## Coolify / UI-only facts

- `build-image.yml` triggers all three brand Coolify deploys after every
  successful `:latest` publish (vars/secrets `COOLIFY_{ALX,HAVERFORD,GENVEST}_*`).
  Never trigger a manual deploy after a merge — it duplicates and races.
- genvest's Coolify app tracks `genvest/agent-genvest` (brand-customized
  compose fork), NOT this repo; haverford/alx track this repo's main directly.
