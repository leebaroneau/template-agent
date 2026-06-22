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

## Key decisions

## Coolify / UI-only facts
