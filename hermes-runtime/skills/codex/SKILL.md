---
name: codex
description: Delegate a coding task to the Codex CLI (@openai/codex). Use for fast single-file fixes, bug reproduction, and sandboxed code execution. Faster turnaround than Claude Code for focused changes.
triggers:
  - "/codex"
  - "use codex"
  - "delegate to codex"
  - "run codex on"
  - "have codex fix"
  - "codex this"
---

# Codex Delegation

Delegate coding work to the `codex` CLI subprocess. Codex is best for: fast bug fixes, single-file edits, sandboxed code execution, and tasks where speed matters more than depth.

## Invocation

```bash
codex "<task description>" \
  --approval-mode full-auto \
  2>&1
```

Run from the repo root. Codex runs in a sandboxed environment and applies changes directly.

## When to use

- Single-file bug fixes
- Fast iteration on a specific function
- Sandboxed code execution / testing a hypothesis
- Tasks where you want a quick turnaround without a full agentic loop

## When NOT to use

- Multi-file refactors — use claude-code instead
- Opening PRs — use claude-code or gh CLI directly
- Tasks requiring sustained context across many files

## After running

1. Run `git diff` to see what changed
2. Review changes before committing — Codex is fast but may overshoot
3. Post a summary comment on the Paperclip issue

## Skills available to Codex

`obra/superpowers` is pre-installed into the image at `/opt/plugins/superpowers` and symlinked into `/home/node/.codex/skills/`. Codex subagent sessions have access to: `brainstorming`, `systematic-debugging`, `test-driven-development`, `writing-plans`, `executing-plans`, `dispatching-parallel-agents`, and the full code-review cycle.

## Auth

Requires `OPENAI_API_KEY` in the container env, OR route through `hermes proxy` if using ChatGPT OAuth subscription.
