---
name: use-100m-framework
description: Apply the shared $100M framework to company work, diagnose bottlenecks, select opportunities, and capture sanitized field-learning proposals.
triggers:
  - "$100M"
  - "100m"
  - "Hormozi"
  - "offer"
  - "leads"
  - "money model"
  - "sales execution"
  - "business bottleneck"
---

# Use $100M Framework

Use this skill whenever the work involves offers, lead generation, sales execution, monetization, pricing, customer acquisition, or business bottleneck diagnosis.

## Source Of Truth

The shared framework lives outside this runtime template:

```text
00_resources/frameworks/100m-framework/
```

In deployed Paperclip/Hermes companies, use the framework pages only when they are available through the task context, mounted files, or synced notes. If the shared framework is not available, continue with the current task context and write a field-learning proposal that names the missing framework reference.

## Application Flow

1. Read the current Paperclip issue, project context, and any linked evidence.
2. Consult `/data/agent-stack/important-information-index.md` for the company, project, offer, channel, customer segment, or prior `$100M` field learnings.
3. Diagnose the active constraint as one of: Offer, Money Model, Leads, Sales Execution, or Market Selection.
4. Choose one candidate opportunity that directly attacks the constraint.
5. Name the evidence, confidence level, success metric, and learning date.
6. Leave the company-specific diagnosis in the company runtime, not in shared framework doctrine.

## Field-Learning Capture

Write a `100m-field-learning` proposal only when the work produced a lesson that may improve reusable doctrine across companies.

Use this slug shape:

```text
inbox/100m-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>
```

Use this page schema:

```markdown
---
title: "<short sanitized title>"
type: 100m-field-learning
framework: 100m
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

Name the likely target page, workflow, scorecard, or concept.
```

## Promotion Rules

- `clarity`: wording, naming, navigation, and explanation improvements. Safe for curator auto-promotion when source-backed and client-neutral.
- `example`: sanitized examples that illustrate existing doctrine without changing the doctrine. Safe for curator auto-promotion when source-backed and client-neutral.
- `pattern`: repeated finding across companies that may add or reshape a reusable heuristic. Requires Lee review.
- `strategic`: changes to scoring, sequencing, diagnosis, doctrine, or operating policy. Requires Lee review.

Do not edit shared framework doctrine directly from a company profile. Do not include client names, private metrics, customer names, secrets, raw transcripts, or runtime database content in field-learning proposals.

## Output

When you use this skill, end with:

- Constraint diagnosed.
- Opportunity chosen.
- Source evidence used.
- Field-learning proposal slug, if one was created.
- Gaps or review items.
