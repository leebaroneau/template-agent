# Learning Protocol

This protocol is the shared learning contract for Paperclip-managed Hermes roles.
It is task-scoped: learn from the work in front of you, not by crawling the whole
runtime volume.

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

Capture:
- Decisions and why they were made.
- Important source paths and Paperclip project or issue IDs.
- Reusable client conventions.
- Role-specific operating notes.
- Open questions or known risks.

Use direct source citations in the page body, for example:

```text
[Source: /data/instances/default/projects/<project>/<file>.md, 2026-05-16]
```

Write to your role-specific GBrain:

```bash
gbrain put "projects/<short-slug>-notes" <<'EOF'
---
title: <Short Title>
type: project-note
tags:
  - paperclip
  - learned-context
---

# <Short Title>

## Summary

...

## Sources

- [Source: /data/instances/default/projects/...]
EOF
```

## 4. Maintain The Shared Index

When you discover a pointer that many roles will need, update:

```text
/data/agent-stack/important-information-index.md
```

Keep this index short. Link to durable sources instead of duplicating large
content.

## 5. Leave A Trail

If you write or update GBrain pages, mention the page slug in the Paperclip issue
comment or final answer. Future roles should be able to follow your work without
searching blindly.
