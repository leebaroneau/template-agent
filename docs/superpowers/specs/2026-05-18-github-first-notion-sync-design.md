# GitHub-First Notion Intake Sync Design

**Date:** 2026-05-18
**Status:** Draft for review
**Owner:** Lee Barone
**Target:** Paperclip Hermes GBrain template, disabled by default and enabled per company by env vars

## Problem

Clients need a friendly way for non-technical people to submit work without learning GitHub. Notion Forms are a good intake surface because anyone with a form link can submit structured requests, and the responses live in a database that stakeholders already understand.

GitHub should still be the operational source of truth. Work is triaged in GitHub Issues and GitHub Projects, not in Notion. The sync needs to support two-way communication without letting Notion invent a parallel workflow.

## Goal

Add an optional GitHub-first sync bridge:

1. A Notion Form submission creates a GitHub issue.
2. GitHub Issues and Projects remain canonical for status, labels, assignee, priority, and triage.
3. Notion displays GitHub state for visibility and reporting.
4. Allowed Notion edits become explicit commands into GitHub, such as adding a requester comment or changing a GitHub-shaped label.

The bridge should make Notion speak GitHub's language, not the other way around.

## Non-Goals

- Do not replace GitHub Projects.
- Do not make Notion a second issue tracker.
- Do not support arbitrary field-by-field bidirectional sync.
- Do not sync private GitHub-only engineering notes back to public requester-facing Notion views.
- Do not require this feature for every deployment. It must be off unless env vars enable it.

## Design Principle

GitHub is canonical. Notion is intake plus reporting.

Every operational field shown in Notion should either:

- Submit a command to GitHub.
- Mirror a canonical value from GitHub.
- Store sync metadata.

No Notion-only workflow state should control engineering work.

## Architecture

Add a small Node service named `notion-github-sync`.

It runs only when `NOTION_GITHUB_SYNC_ENABLED=1`. It can run inside the existing image and compose stack, sharing no client data with the template repo.

Core modules:

- `config`: validates env vars and maps Notion properties to GitHub concepts.
- `notion`: reads form rows, updates sync fields, and receives Notion webhook events when configured.
- `github`: creates issues, applies labels, adds comments, reads issue state, and reads project item fields.
- `mapper`: converts Notion rows into GitHub issue titles, bodies, comments, and labels.
- `store`: tracks idempotency keys, hashes, and last processed webhook delivery IDs.
- `worker`: runs periodic reconciliation and webhook event processing.

The first version should support polling because it is easier to deploy behind Coolify. Webhooks can be enabled when each client has a public callback URL and secrets configured.

## Notion Database Shape

The Notion Form should write into a database with GitHub-shaped fields.

### Intake Fields

These fields are used to create the issue:

- `Title`: issue title.
- `Request Type`: maps to a GitHub issue type or label.
- `Description`: maps to the `## Request` section in the issue body.
- `Business Context`: maps to `## Business Context`.
- `Acceptance Criteria`: maps to `## Acceptance Criteria`.
- `Requester Name`: included in issue metadata.
- `Requester Email`: included in issue metadata when appropriate for the deployment.
- `Company`: maps to a GitHub label or body metadata.

After issue creation, edits to these fields do not rewrite the issue body by default. If someone changes intake context later, the bridge posts a GitHub comment that says the requester updated the Notion intake row.

### Notion Command Fields

These fields send explicit commands to GitHub:

- `Business Priority`: exact GitHub label vocabulary, such as `priority: high`.
- `Requested Due Date`: maps to a GitHub Project field when configured, otherwise posts a comment.
- `Requester Follow-up`: text to post as a GitHub issue comment.
- `Send Follow-up`: checkbox. When checked, the bridge posts `Requester Follow-up` to GitHub, records the comment URL, and clears the checkbox.

The command fields are intentionally narrow. This avoids accidental two-way conflicts.

### GitHub Mirror Fields

These fields are written by the bridge from GitHub:

- `GitHub Issue URL`
- `GitHub Issue Number`
- `GitHub Issue Node ID`
- `GitHub State`
- `GitHub State Reason`
- `GitHub Labels`
- `GitHub Assignee`
- `GitHub Project Status`
- `GitHub Milestone`
- `GitHub Closed At`
- `Last GitHub Sync`

Humans may view these in Notion, but edits are overwritten by GitHub on the next sync.

### Sync Metadata Fields

These fields prevent loops and duplicates:

- `Sync Status`: `pending`, `synced`, `error`, or `ignored`.
- `Sync Error`
- `Last Sync Direction`: `notion_to_github` or `github_to_notion`.
- `Last Sync Actor`: `worker`, `notion_user`, or `github_user`.
- `Last Notion Hash`
- `Last GitHub Hash`
- `Last Comment Hash`
- `Last Processed At`

## GitHub Issue Body Template

The GitHub issue body is the canonical record created from intake.

```md
## Request

<Description>

## Business Context

<Business Context>

## Acceptance Criteria

<Acceptance Criteria>

## Requester

- Name: <Requester Name>
- Email: <Requester Email>
- Company: <Company>

---

Notion intake: <Notion page URL>
Notion page ID: <Notion page ID>
Sync source: notion-github-sync
```

The `Notion page ID` line is the idempotency key. If a retry happens, the bridge searches existing GitHub issues for that marker before creating a new issue.

## Data Flow

### Notion Form to GitHub Issue

1. User submits the Notion Form.
2. The bridge sees a Notion row with no `GitHub Issue URL`.
3. The bridge validates required fields.
4. The bridge creates a GitHub issue with labels such as `intake`, `from:notion`, and mapped request labels.
5. GitHub Projects auto-adds the issue through a project workflow.
6. The bridge writes the issue URL, issue number, node ID, and sync status back to Notion.

### GitHub to Notion Reporting

1. A GitHub issue or project item changes.
2. GitHub webhook or scheduled reconciliation fetches the latest canonical state.
3. The bridge finds the linked Notion row by GitHub issue number or embedded Notion page ID.
4. The bridge updates only GitHub mirror fields in Notion.

### Notion Command to GitHub

1. A stakeholder edits a command field, for example `Requester Follow-up`.
2. The bridge detects the change.
3. The bridge performs the matching GitHub action, such as posting an issue comment.
4. The bridge records the command result in Notion metadata.
5. The next GitHub-to-Notion sync mirrors the resulting canonical state back.

## Conflict Rules

GitHub wins for:

- Issue state.
- Assignee.
- Labels.
- Milestones.
- Project status.
- Project priority.
- Engineering comments.

Notion can initiate:

- Initial issue creation.
- Requester follow-up comments.
- Business priority label commands, using exact GitHub label names.
- Requested due date commands, when a GitHub Project due date field is configured.

If both systems change a shared concept, the bridge applies GitHub's latest value to Notion and writes a sync note if the Notion command could not be applied.

## Drift Controls

- One Notion page maps to one GitHub issue.
- The bridge never treats Notion mirror fields as authoritative.
- Bot-originated updates are ignored when they would cause a loop.
- Every outbound update stores a hash, so repeated polling does not repost comments or relabel issues.
- Labels and project field options must be configured from GitHub vocabulary.
- Unknown Notion field values fail closed with `Sync Status=error` instead of inventing labels.

## Configuration

Required env vars when enabled:

```env
NOTION_GITHUB_SYNC_ENABLED=1
NOTION_TOKEN=...
NOTION_INTAKE_DATABASE_ID=...
GITHUB_TOKEN=...
GITHUB_OWNER=...
GITHUB_REPO=...
```

Optional env vars:

```env
NOTION_GITHUB_SYNC_POLL_SECONDS=60
NOTION_GITHUB_SYNC_LABELS=intake,from:notion
NOTION_GITHUB_SYNC_ALLOWED_PRIORITY_LABELS=priority: low,priority: medium,priority: high
GITHUB_PROJECT_ID=...
GITHUB_PROJECT_STATUS_FIELD_ID=...
GITHUB_PROJECT_DUE_DATE_FIELD_ID=...
GITHUB_WEBHOOK_SECRET=...
NOTION_WEBHOOK_SECRET=...
NOTION_GITHUB_SYNC_PUBLIC_URL=https://sync.<client-domain>
```

The service should refuse to start when enabled with missing required config.

## Security

- Tokens live only in Coolify env vars or local `.env`, never in the repo.
- Webhooks verify signatures when enabled.
- The GitHub token should be scoped to the target repo with issue write access and project access only when project fields are configured.
- Notion access should be limited to the intake database and reporting page.
- Requester email mirroring can be disabled per deployment if a client does not want email addresses in GitHub.

## Error Handling

Recoverable errors:

- GitHub rate limit.
- Notion rate limit.
- Temporary network failure.
- GitHub Project item not available immediately after issue creation.

The bridge retries these with backoff.

Hard errors:

- Missing required Notion fields.
- Unknown priority label.
- GitHub repository not found.
- Notion database not shared with the integration.

The bridge writes `Sync Status=error` and a concise `Sync Error` message on the Notion row.

## Testing

Unit tests should cover:

- Notion row to GitHub issue body mapping.
- Idempotency marker generation.
- Label mapping and unknown label rejection.
- Comment hash behavior.
- GitHub event to Notion mirror field mapping.
- Conflict rule handling.

Integration smoke tests should run against mocked Notion and GitHub APIs. Live API tests should remain opt-in because they require real tokens and client-specific resources.

## Rollout

1. Add the service disabled by default.
2. Add documented Notion database schema and form setup steps.
3. Add GitHub Project auto-add setup instructions.
4. Enable locally against a test Notion database and test repo.
5. Enable for one company via Coolify env vars.
6. Watch sync logs and Notion `Sync Error` rows before enabling more companies.

## Acceptance Criteria

- A Notion Form submission creates exactly one GitHub issue.
- The issue uses the canonical GitHub body template.
- GitHub Projects can auto-add the issue using labels.
- GitHub status, labels, assignee, and project status mirror into Notion.
- A Notion requester follow-up creates one GitHub comment, even if the worker retries.
- Notion cannot overwrite GitHub-owned status, assignee, labels, or project status by accident.
- Missing or invalid mappings fail with a visible Notion sync error.
- The feature is inert unless `NOTION_GITHUB_SYNC_ENABLED=1`.
