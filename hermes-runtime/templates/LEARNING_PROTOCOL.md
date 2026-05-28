# Learning Protocol

This is the Hermes-profile mirror of the shared Paperclip learning protocol.
The canonical runtime copy is `/data/agent-stack/learning-protocol.md`.

When the shared file is unavailable, follow this local copy.

## 1. Start With What You Already Know

At the start of meaningful work, search your prior session history before
assuming you have no relevant context.

```
session_search(query="<project, client, issue, or concept>")
```

If session_search returns no useful context, continue from the Paperclip task.

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
- Copying runtime databases, sessions, logs, or secrets into memory.
- Treating every transient task detail as durable knowledge.

## 3. Capture Durable Learning

At task end, save concise durable facts when the work produced reusable context.

```python
memory(action="add", target="memory", content="<compact fact — under 200 chars>")
```

Save: decisions, conventions, client facts, role-specific notes, known risks.
Do not save: transient task state, logs, raw transcripts, another profile's notes.

## 4. Maintain The Shared Index

When you discover a pointer that many roles will need, update:

```text
/data/agent-stack/important-information-index.md
```

Keep this index short. Link to durable sources instead of duplicating large content.

## 5. Leave A Trail

If you save durable memory facts, mention what you stored in the Paperclip issue
comment or final answer — so reviewers and future agents know what context exists.

## 6. Capture `$100M` Field Learnings

When a task applies the `$100M` framework and produces a reusable improvement,
save a sanitized note using the `memory` tool.

Key: `inbox/100m-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>`

Format:
- Proposed Improvement (one paragraph)
- Promotion Class: one of `clarity`, `example`, `pattern`, `strategic`
- Evidence (source citations)
- Why It Generalizes
- Why It May Not Generalize
- Suggested Framework Target

Never include client names, private metrics, customer names, secrets, raw
transcripts, or runtime database content.

## 7. Capture EOS Field Learnings

Same protocol as `$100M` field learnings. Key shape:

`inbox/eos-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>`

Never include client names, private metrics, or secrets.
