---
name: use-eos-framework
description: "Apply the shared EOS framework to Paperclip company work: turn selected $100M opportunities into Rocks, owners, scorecards, issues, routines, and escalation paths."
triggers:
  - "EOS"
  - "Entrepreneurial Operating System"
  - "Rock"
  - "Rocks"
  - "Level 10"
  - "Scorecard"
  - "IDS"
  - "Issues List"
  - "Accountability Chart"
  - "quarterly priority"
  - "operating rhythm"
  - "team accountability"
---

# Use EOS Framework

Use this skill when work involves company operating rhythm, quarterly priorities,
Rocks, owners, scorecards, Level 10 meetings, issue triage, accountability, or
team alignment.

## Source Of Truth

The shared framework lives outside this runtime template:

```text
00_resources/frameworks/eos-framework/
```

In deployed Paperclip/Hermes companies, use the framework pages only when they
are available through the task context, mounted files, or synced notes.
If the shared framework is not available, continue from the current
Paperclip context and write a field-learning proposal that names the missing
framework reference.

## When To Use

- Turning a selected `$100M` opportunity into execution.
- Setting or reviewing quarterly Rocks.
- Running or summarizing a Level 10 meeting.
- Translating a scorecard signal into action.
- Turning an issue list into assigned solve work.
- Clarifying ownership with the accountability chart.
- Escalating cross-team blockers through the Paperclip org chart.

## Application Flow

1. Read the current Paperclip issue, parent issue, project, goal, comments, and
   your own role context.
2. Consult `/data/agent-stack/important-information-index.md` for the company, project, current Rocks,
   scorecards, prior decisions, and prior field learnings.
3. If the work is strategic priority-setting, apply `use-100m-framework` first
   or confirm the `$100M` opportunity has already been selected.
4. Choose the smallest EOS workflow that matches the task:
   - `$100M` opportunity to quarterly Rock.
   - Quarterly Rock setting.
   - Weekly Level 10 issue processing.
   - Scorecard review.
   - Accountability cleanup.
5. Convert the EOS output into Paperclip state: goal, project, parent issue,
   child issues, routine setup issue, approval request, or manager escalation.
6. Name the owner, success metric, review date, unresolved issue, and evidence.
7. Leave company-specific diagnosis in the company runtime,
   not in shared framework doctrine.

## Paperclip Actions

Prefer the Paperclip MCP tools over shell API calls:

```text
paperclip_list_companies       paperclip_list_agents
paperclip_create_issue         paperclip_list_projects
paperclip_list_issues          paperclip_comment_on_issue
paperclip_get_issue            paperclip_update_issue
```

Use `paperclip_create_issue` for Rocks, solve actions, evidence tasks, blockers,
delegated work, and routine setup when no routine tool exists. Set `parentId`
and `goalId` when those identifiers are known.

Use `paperclip_comment_on_issue` for Level 10 summaries, scorecard review notes,
owner confirmations, and escalation rationale. Use `paperclip_update_issue` when
work is actually complete or needs a status change.

Escalate cross-team blockers through the manager chain shown in Paperclip's org
chart. Ask for approval before making strategy, budget, hiring, public
commitment, shared doctrine, or org-structure changes.

## Field-Learning Capture

Write an `eos-field-learning` proposal only when the work produced a lesson that
may improve reusable EOS doctrine across companies.

Use this slug shape:

```text
inbox/eos-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>
```

Use this page schema:

```markdown
---
title: "<short sanitized title>"
type: eos-field-learning
framework: eos
promotion_class: clarity
confidence: medium
source_company_redacted: true
---

# <Short Sanitized Title>

## Proposed Improvement

State the reusable improvement in one paragraph.

## Promotion Class

Use exactly one: clarity, example, pattern, strategic.

## Evidence

- [Source: Paperclip issue <identifier>, <YYYY-MM-DD>]
- [Source: Paperclip issue <identifier>, <YYYY-MM-DD>]

## Why It Generalizes

Explain why this applies beyond one company.

## Why It May Not Generalize

Name the limits, missing data, or company-specific conditions.

## Suggested Framework Target

Name the likely EOS page, workflow, template, scorecard, or operating rule.
```

## Promotion Rules

- `clarity`: wording, naming, navigation, and explanation improvements. Safe for
  curator auto-promotion when source-backed and client-neutral.
- `example`: sanitized examples that illustrate existing doctrine without
  changing the doctrine. Safe for curator auto-promotion when source-backed and
  client-neutral.
- `pattern`: repeated finding across companies that may add or reshape a
  reusable heuristic. Requires Lee review.
- `strategic`: changes to scoring, sequencing, cadence, ownership, escalation,
  doctrine, or operating policy. Requires Lee review.

Do not edit shared framework doctrine directly from a company profile. Do not
include client names, private metrics, customer names, secrets, raw transcripts,
or runtime database content in field-learning proposals.

## Output

When you use this skill, end with:

- EOS workflow used.
- `$100M` opportunity, if applicable.
- Rock, owner, success metric, and review date.
- Paperclip goal, project, parent issue, child issues, or routine setup issue.
- Blockers, escalations, or approvals needed.
- Field-learning proposal slug, if one was created.
- Gaps or review items.

## Anti-Patterns

- Giving generic EOS advice without grounding it in Paperclip state.
- Creating a Rock without one directly accountable owner.
- Creating a metric that cannot be reviewed weekly.
- Summarizing a Level 10 meeting without assigned solve issues.
- Suggesting hiring, firing, or reorg changes without accountability-chart
  rationale and approval.
- Letting EOS process override the selected `$100M` opportunity.
- Editing shared framework doctrine directly from a company profile.
