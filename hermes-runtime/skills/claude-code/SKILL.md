---
name: claude-code
description: Delegate a coding task to Claude Code (claude CLI). Use for multi-file refactors, PR creation, test writing, and sustained code generation. Runs non-interactively and returns a diff summary.
triggers:
  - "/claude-code"
  - "use claude code"
  - "delegate to claude"
  - "run claude on"
  - "have claude fix"
  - "claude code this"
---

# Claude Code Delegation

Delegate coding work to the `claude` CLI subprocess. Claude Code is best for: multi-file refactors, writing tests, opening PRs, and any task that benefits from a full agentic loop with file read/write/bash.

## Invocation

```bash
claude -p "<task description>" \
  --plugin-dir /opt/plugins/superpowers \
  --allowedTools "Read,Edit,Write,Bash,Glob,Grep" \
  --max-turns 20 \
  --output-format json \
  2>&1
```

Run from the repo root. Capture stdout. Parse the JSON result for the `result` field and any file diffs.

## When to use

- Multi-file changes (3+ files)
- Writing or updating tests
- Opening a PR end-to-end
- Code review on a diff
- Any task where you want a full agentic loop with bash access

## When NOT to use

- Single-line fixes — do it yourself directly
- Read-only questions about code — use your own context window
- Tasks needing interactive approval — use your terminal toolset instead

## After running

1. Check exit code — non-zero means Claude Code hit an error or ran out of turns
2. Run `git diff` to see what changed
3. If the task was to open a PR, verify with `gh pr view`
4. Post a summary comment on the Paperclip issue with what changed

## Auth

Uses `ANTHROPIC_API_KEY` from the container env automatically. No extra auth needed.
