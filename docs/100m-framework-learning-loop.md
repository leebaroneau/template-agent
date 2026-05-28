# 100M Framework Learning Loop

This template distributes the `$100M` application skill to every synced Hermes
profile. The skill helps company agents apply the framework and write sanitized
field-learning proposals. Shared doctrine promotion is centralized outside
company profiles.

## Roles

| Role | Runs where | Responsibility |
| --- | --- | --- |
| Company agents | Every company Paperclip/Hermes deployment | Apply the framework and write sanitized `100m-field-learning` proposals into their memories. |
| Company CEO | Every company Paperclip/Hermes deployment | Ensure company priorities use the framework when appropriate; does not own all framework learning. |
| Framework curator | Lee's personal Hermes profile or a dedicated framework-lab company | Pull field-learning proposals, dedupe them, auto-promote low-risk clarity/example changes, and escalate pattern/strategic changes. |

## Capture

Company agents write proposals with:

```text
type: 100m-field-learning
framework: 100m
promotion_class: clarity|example|pattern|strategic
source_company_redacted: true
```

Company profiles must not edit shared framework doctrine directly.

## Runtime Install Path

The skill is baked into the image at:

```text
/opt/hermes-runtime/skills/use-100m-framework/
```

The existing profile bootstrap and profile-sync sweep symlink every bundled
agent-stack skill into each profile:

```text
/data/hermes/skills/agent-stack/use-100m-framework
/data/hermes/profiles/<company-role>/skills/agent-stack/use-100m-framework
```

Each role keeps isolated memory and writes its own field-learning proposals.

## Pull

Use a central inbox that Lee controls. Acceptable inboxes:

- A private GitHub issue or discussion labeled `100m-field-learning`.
- A dedicated Paperclip company or project named `$100M Framework Lab`.

The first implementation should use GitHub issues because `gh` is already
available in the development workflow and the audit trail is simple.

## Personal Hermes Curator Cron

Run this from Lee's personal Hermes profile after the curator inbox exists:

```bash
hermes cron create "10 9 * * 1" \
  "Curate the $100M framework field-learning inbox. Read new proposals from the agreed inbox since the previous run. Classify each proposal as clarity, example, pattern, or strategic. Auto-promote only clarity/example changes that are source-backed, client-neutral, and do not alter scoring or sequencing. For pattern/strategic changes, create a review item for Lee with evidence, target framework page, and the smallest proposed change. If no new proposals exist, respond with [SILENT]. Save a report under reports/100m-framework-curator/<YYYY-MM-DD-HHMM>.md." \
  --name "100m framework curator" \
  --deliver local
```

Test before relying on the schedule:

```bash
hermes cron list
hermes cron run <job_id>
```

## Promotion Rules

- Auto-promote: clarity and example.
- Escalate: pattern and strategic.
- Reject: client-identifying, unsupported, secret-bearing, or one-company-only claims.

## First Manual Test

Create 3-5 sample proposals, run the curator job manually, and verify:

- Auto-promoted changes are wording or examples only.
- Strategic changes produce review items instead of doctrine edits.
- Reports include source proposal slugs.
- No client names or private data appear in shared doctrine.
