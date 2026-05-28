# Learning Protocol

This protocol is the shared learning contract for Paperclip-managed Hermes roles.
It is task-scoped: learn from the work in front of you, not by crawling the whole
runtime volume.

## 1. Start With Shared Context

At the start of meaningful work, consult the shared protocols and index before assuming
the answer is only in the current issue.

Read the following if they exist:
- `/data/agent-stack/important-information-index.md` — pointers to key runtime context.
- `/data/agent-stack/delegation-protocol.md` — multi-role handoff rules.
- `/data/hermes/LEARNING_PROTOCOL.md` — fallback copy of this protocol.

## 2. Read Only Relevant Runtime Context

You can inspect the shared `/data` volume, but do not browse it aimlessly.

Prioritize:
- The current Paperclip issue, project, and attached artifacts.
- Paths listed in `/data/agent-stack/important-information-index.md`.
- Relevant files under `/data/instances/default/projects/`.
- Your own Hermes profile home at `$HERMES_HOME`.

Avoid:
- Crawling every project.
- Reading unrelated role profile directories.
- Copying runtime databases, sessions, logs, or secrets into shared memory.
- Treating every transient task detail as durable knowledge.

## 3. Capture Durable Learning

At task end, update the shared index if you discovered a pointer that many roles will need.

When you discover a pointer:
- Add it to `/data/agent-stack/important-information-index.md`.
- Link to durable sources instead of duplicating large content.
- Include direct source citations, for example:

```text
[Source: /data/instances/default/projects/<project>/<file>.md, 2026-05-16]
```

## 4. Capture `$100M` Field Learnings

When a task applies the `$100M` framework and produces a reusable improvement,
write a sanitized proposal to the shared field-learning inbox. Use this only for
lessons that may improve shared doctrine across companies.

Slug shape:

```text
inbox/100m-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>
```

Page schema:

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

Promotion classes:

- `clarity`: wording, naming, navigation, and explanation improvements. Curator may auto-promote when source-backed and client-neutral.
- `example`: sanitized examples that illustrate existing doctrine without changing the doctrine. Curator may auto-promote when source-backed and client-neutral.
- `pattern`: repeated finding across companies that may add or reshape a reusable heuristic. Requires Lee review.
- `strategic`: changes to scoring, sequencing, diagnosis, doctrine, or operating policy. Requires Lee review.

Never include client names, private metrics, customer names, secrets, raw
transcripts, or runtime database content. Do not edit shared framework doctrine
from a company profile.

## 5. Capture EOS Field Learnings

When a task applies the EOS framework and produces a reusable improvement, write
a sanitized proposal to the shared field-learning inbox. Use this only for lessons
that may improve shared operating doctrine across companies.

Slug shape:

```text
inbox/eos-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>
```

Page schema:

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

Promotion classes:

- `clarity`: wording, naming, navigation, and explanation improvements. Curator may auto-promote when source-backed and client-neutral.
- `example`: sanitized examples that illustrate existing doctrine without changing the doctrine. Curator may auto-promote when source-backed and client-neutral.
- `pattern`: repeated finding across companies that may add or reshape a reusable heuristic. Requires Lee review.
- `strategic`: changes to scoring, sequencing, cadence, ownership, escalation, doctrine, or operating policy. Requires Lee review.

Never include client names, private metrics, customer names, secrets, raw
transcripts, or runtime database content. Do not edit shared framework doctrine
from a company profile.
