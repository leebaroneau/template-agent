---
name: paperclip-org-structure
description: How to answer "who reports to who / what roles exist" questions using Paperclip, without relying on huge API responses.
triggers:
  - "org structure"
  - "org chart"
  - "who reports to who"
  - "paperclip roles"
  - "list agents"
  - "team structure"
---

# Paperclip org structure (source of truth + pitfalls)

## Default call (Haverford convention)

When the user asks for "org", treat that as "Paperclip org structure". Do this first:

1) Read `/data/agent-stack/org-chart.json` (source of truth for routing).
2) Use `/data/agent-stack/org-chart.md` only when you want a human-readable skim.

Reason: `paperclip_list_agents` can return very large payloads and tool outputs may truncate, which makes you miss roles and mis-route work.

## When to hit the live Paperclip API anyway

Only call the API when you need to confirm the current live state (for example: a role was just created, or you suspect the generated file is stale).

- Use `paperclip_list_companies` to get the company id.
- Then call `paperclip_list_agents(companyId=...)`.

Pitfall: If `PAPERCLIP_DEFAULT_COMPANY_ID` is not set, `paperclip_list_agents` and `paperclip_list_projects` require an explicit `companyId`.

## Output standard

- Answer from `org-chart.json` first.
- Include: role name, and who it reports to.
- If user asked about "CTO org", include direct reports.

## Preference note (Lee)

When Lee asks for org structure, always check `/data/agent-stack/org-chart.json` first before answering.
