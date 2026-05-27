---
name: using-paperclip
description: How and when to file, update, and close issues in Paperclip via the MCP server. Use whenever you start a task, finish one, hit a blocker, or hand work off to another agent.
triggers:
  - "track this in paperclip"
  - "open a ticket"
  - "file an issue"
  - "what am I working on"
  - "what's blocking me"
  - "comment on the issue"
  - "list my issues"
  - "what tasks do I have"
---

# Using Paperclip

You have a `paperclip` MCP server with eight typed tools. Reach for them at four moments in your work, plus whenever a user asks about Paperclip state directly.

## Tools available

```text
paperclip_list_companies       paperclip_list_agents
paperclip_create_issue         paperclip_list_projects
paperclip_list_issues          paperclip_comment_on_issue
paperclip_get_issue            paperclip_update_issue
```

All eight reach Paperclip's REST API via Bearer auth that the runtime sets up — you do not need to handle credentials.

## When to act

### 1. Starting non-trivial work

Before doing real work on a task bigger than a single tool turn:

- Call `paperclip_list_issues` filtered by `assigneeAgentId` (you can find your id via `paperclip_list_agents` if you don't have it cached). Use `status: ["todo","in_progress","in_review","blocked"]` to skip the noise.
- If the task you're about to do isn't already an issue and is bigger than a few minutes, create one with `paperclip_create_issue` so progress is durable across sessions.
- If it IS already an issue, note the identifier (e.g. `HAV-42`) and reference it in your status comments.

### 2. While working

For non-trivial tasks that produce real artifacts, leave a status comment via `paperclip_comment_on_issue` at meaningful milestones:

- "Started — pulling Sentry data for last 7 days."
- "Found 4 fingerprint clusters; top one is null-deref in PriceTool. Drafting fix."
- "PR opened: <url>. Waiting on review."

Aim for one comment every 10–30 minutes of execution time. Not after every shell command — that's noise.

### 3. Hitting a blocker

When you can't progress because another agent or a human owns something:

- `paperclip_comment_on_issue` on **your** issue: `"Blocked: need <thing> from @AgentName"`. The `@AgentName` mention wakes the named agent.
- If the blocker is itself a missing piece of work, also `paperclip_create_issue` for the blocker and set `assigneeAgentId` to the right agent. Link them via `blockedByIssueIds`.

### 4. Finishing

When the work is done:

- `paperclip_update_issue` with `status: "done"` and a `comment` summarising what shipped.
- If a follow-up surfaced during the work, file it as a new issue with `paperclip_create_issue` rather than burying it in the comment.

### 5. User asks about state

If a user (via gateway, dashboard chat, or `@`-mention) asks what you're working on, what's pending, or to file something:

- `paperclip_list_issues` with the appropriate filters (`assigneeAgentId`, `status`, `q` for full-text search).
- `paperclip_create_issue` directly with the requested details.
- Always respond with the human identifier (e.g. `HAV-42`) so the user can find it later.

## Reaching the right company

Tool calls default to the company set in `PAPERCLIP_DEFAULT_COMPANY_ID`. If you need a different company:

- `paperclip_list_companies` returns every company the API key can access.
- Pass `companyId` explicitly on `paperclip_create_issue` / `paperclip_list_issues` / `paperclip_list_agents` / `paperclip_list_projects`.

## What NOT to do

- **Don't** also `curl` Paperclip's REST API in a shell. The MCP tools wrap auth, defaults, error mapping, and the typed contract; shell calls drop all of that and the model has to re-invent the request each time.
- **Don't** open issues for things you'll finish in the next tool turn. Use the threshold: if it fits in one shot, just do it.
- **Don't** comment on issues you don't own unless you're handing off to the assignee or the user asked you to.
- **Don't** change `status` to `done` if you haven't actually shipped — use `in_review` if you're waiting on confirmation.

## Cross-references

- Delegation Protocol (at `/data/hermes/DELEGATION_PROTOCOL.md` in your profile) explains the multi-role handoff rules.
- Learning Protocol (at `/data/hermes/LEARNING_PROTOCOL.md`) tells you task-scoped best practices.
- Paperclip's org chart at `/data/agent-stack/org-chart.{md,json}` shows the reportsTo lines for `@`-mentions.
