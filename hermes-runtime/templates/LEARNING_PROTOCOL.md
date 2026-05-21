# Learning Protocol

This is the Hermes-profile mirror of the shared Paperclip learning protocol.
The canonical runtime copy is `/data/agent-stack/learning-protocol.md`.

When the shared file is unavailable, follow this local copy.

## 1. Start With Your Own Brain

At the start of meaningful work, query your role-specific GBrain before assuming
the answer is only in the current issue.

Use your existing `GBRAIN_HOME`. For synced Paperclip roles this points to:

```text
/data/gbrain/<company-role>
```

Useful commands:

```bash
gbrain search "<project, client, issue, or concept>"
gbrain query "<natural-language question>"
```

If the brain has no useful context, say so in your reasoning and continue from
the Paperclip task context.

## 2. Read Only Relevant Runtime Context

You can inspect the shared `/data` volume, but do not browse it aimlessly.

Prioritize:
- The current Paperclip issue, project, and attached artifacts.
- Paths listed in `/data/agent-stack/important-information-index.md`.
- Relevant files under `/data/instances/default/projects/`.
- Your own Hermes profile home at `$HERMES_HOME`.
- Your own GBrain home at `$GBRAIN_HOME`.

Avoid:
- Crawling every project.
- Reading unrelated role profile directories.
- Copying runtime databases, sessions, logs, or secrets into GBrain.
- Treating every transient task detail as durable knowledge.

## 3. Capture Durable Learning

At task end, write a concise learned-summary page when the work produced durable
context that would help future tasks.

Capture decisions, source paths, client conventions, role-specific notes, open
questions, and known risks. Include source citations in the page body.

## 4. Maintain The Shared Index

When you discover a pointer that many roles will need, update:

```text
/data/agent-stack/important-information-index.md
```

Keep this index short. Link to durable sources instead of duplicating large
content.

## 5. Leave A Trail

If you write or update GBrain pages, mention the page slug in the Paperclip issue
comment or final answer.

## 6. Capture `$100M` Field Learnings

When a task applies the `$100M` framework and produces a reusable improvement,
write a sanitized proposal to your role-specific GBrain. Use this only for
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
- [Source: sanitized company GBrain page <slug>, <YYYY-MM-DD>]

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

## 7. Capture EOS Field Learnings

When a task applies the EOS framework and produces a reusable improvement, write
a sanitized proposal to your role-specific GBrain. Use this only for lessons
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
- [Source: sanitized company GBrain page <slug>, <YYYY-MM-DD>]

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
