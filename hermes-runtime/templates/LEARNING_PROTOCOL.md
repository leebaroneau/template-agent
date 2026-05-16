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
