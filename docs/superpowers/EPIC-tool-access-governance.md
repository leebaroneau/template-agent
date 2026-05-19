# Epic — Tool Access Governance

**Status:** plan ready. Active code dev paused on this branch pending Paperclip PR1-3 stabilization.
**Branch:** `feat/tool-access-governance-template`
**PR:** #17 (single home for active dev + spec + plan)

## What this epic delivers

A central, auditable system for declaring which tools each Paperclip agent can use, with per-Hermes-profile enforcement on disk. Tokens are projected by reference (`secret://...`) — never at rest in profile dirs. Editing surface (Paperclip) and enforcement (per-profile `config.yaml`) are split; `profile-sync.mjs` is the bridge.

Three phases, in order:

1. **Phase 1 — Security plumbing.** `profile-sync` extensions, managed-flag opt-in, atomic YAML writes, three-tier gateway bounce, `secret://` resolver wrapper. No new UI. *Plan in this branch.*
2. **Phase 2 — Conversational governance.** Paperclip MCP governance tools (`paperclip_grant_tool`, `paperclip_apply_preset`, …) so daily use is "@admin grant Marketer GitHub" — no clicking.
3. **Phase 3 — Policy + audit UI.** Matrix tab, Connections tab, Presets editor, Audit log. Built when scale demands (15+ agents, second operator, multi-tenant client security review). Full IA + UX is captured in the design spec.

## Documents in this branch

- [Design spec](specs/2026-05-19-tool-access-matrix-design.md) — full architecture, IA, UX for all three phases, projection contract, edge cases, division of responsibility
- [Phase 1 implementation plan](plans/2026-05-20-tool-access-governance-phase-1.md) — 9 tasks, TDD-shaped, ready to execute

## Upstream Paperclip PRs this epic depends on

These are upstream changes in `paperclipai/paperclip`. Phase 1 cannot proceed until at least the first two land.

| PR | Scope | Status |
|---|---|---|
| **Paperclip #6242** | Tool catalog data model + REST API | (set by upstream) |
| **Paperclip #6243** | Governance, approvals, presets, rendered tool-access metadata | (set by upstream) |
| **Paperclip #6244** (planned) | `metadata.toolAccess.managed` flag + MCP governance tools + Connection `inject_as_env` mapping | (planned) |

When picking this work up, first verify:
- All three Paperclip PRs are merged (or at least mergeable + on a stable branch you can pin to)
- `hermes-agent` upstream has `secret://` URI resolution (or the wrapper-script approach from Phase 1 plan Task 6 is acceptable)
- `hermes gateway reload` is available (or fall back to `restart` per Phase 1 plan Task 5)

## When to actively develop Phase 1

Pick any of:
- A Paperclip company you're running has reached **5+ agents** that need different tool sets
- You want a deployable client template that includes per-profile credential isolation
- You're about to add an OAuth tool (GitHub, Slack, Linear) and don't want a shared credential bag
- A client demands a security review for the template

Until then, leave the spec + plan as a parked reference. Rebase weekly against `main` so the branch doesn't rot.

## When to start Phase 3 (the UI)

After Phase 1 + 2 are deployed in production for at least one brand, and any of:
- A company crosses **15+ agents** (matrix becomes the only sane way to see "who has what")
- **Second operator** joins (audit trail stops being optional)
- First multi-tenant client demands a visual security review surface

Phase 3 details (Matrix tab, Connections tab, Presets editor, Audit log mockups, acceptance criteria) live in [the design spec §6-§15](specs/2026-05-19-tool-access-matrix-design.md).

## What to do when picking it up

1. Verify upstream Paperclip PR status (see table above)
2. Pull latest `main` and rebase this branch onto it
3. Read [the Phase 1 plan](plans/2026-05-20-tool-access-governance-phase-1.md)
4. Execute via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`
5. Each task is one commit; PR #17 flips from draft to ready once Phase 1's full task list is green
