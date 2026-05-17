# GitHub-First Notion Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an optional env-gated `notion-github-sync` service that turns Notion Form rows into GitHub issues, treats GitHub as canonical, and mirrors GitHub state back to Notion.

**Architecture:** Add a focused Node service under `paperclip/notion-github-sync/`. The service separates config parsing, GitHub-shaped mapping, Notion API access, GitHub API access, and the sync engine so each behavior can be tested with Node's built-in test runner. Docker and Compose wire the service into the existing image but leave it disabled unless `NOTION_GITHUB_SYNC_ENABLED=1`.

**Tech Stack:** Node 22 ESM, built-in `fetch`, built-in `node:test`, Notion REST API, GitHub REST API, optional GitHub GraphQL for future project field support.

---

## File Structure

- Create `paperclip/notion-github-sync/config.mjs`: reads env vars, normalizes booleans/lists/property names, validates required config when enabled.
- Create `paperclip/notion-github-sync/hash.mjs`: stable SHA-256 hashing for idempotency.
- Create `paperclip/notion-github-sync/mapper.mjs`: maps Notion rows into GitHub issue title/body/labels/comments and mirror updates.
- Create `paperclip/notion-github-sync/notion-client.mjs`: minimal Notion database query and page update client.
- Create `paperclip/notion-github-sync/github-client.mjs`: minimal GitHub issue create/read/comment/label client.
- Create `paperclip/notion-github-sync/sync-engine.mjs`: pure orchestration that accepts fake or real clients.
- Create `paperclip/notion-github-sync/service.mjs`: CLI entrypoint and polling loop.
- Create tests alongside those modules with `.test.mjs` suffix.
- Modify `paperclip/Dockerfile`: copy the new service directory into the image.
- Modify `compose.yaml`: add optional `notion-github-sync` service with env vars.
- Modify `.env.example`: document disabled defaults.
- Modify `README.md`: add setup docs for Notion Form, GitHub labels/project auto-add, and env vars.

## Task 1: Config and Hashing

**Files:**
- Create: `paperclip/notion-github-sync/config.mjs`
- Create: `paperclip/notion-github-sync/hash.mjs`
- Test: `paperclip/notion-github-sync/config.test.mjs`
- Test: `paperclip/notion-github-sync/hash.test.mjs`

- [ ] **Step 1: Write failing config tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.mjs';

test('loadConfig returns disabled config when sync is not enabled', () => {
  const config = loadConfig({});
  assert.equal(config.enabled, false);
});

test('loadConfig requires core env vars when enabled', () => {
  assert.throws(
    () => loadConfig({ NOTION_GITHUB_SYNC_ENABLED: '1' }),
    /Missing required env vars: NOTION_TOKEN, NOTION_INTAKE_DATABASE_ID, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO/,
  );
});

test('loadConfig parses labels and default property names', () => {
  const config = loadConfig({
    NOTION_GITHUB_SYNC_ENABLED: 'true',
    NOTION_TOKEN: 'notion-token',
    NOTION_INTAKE_DATABASE_ID: 'db',
    GITHUB_TOKEN: 'github-token',
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'repo',
    NOTION_GITHUB_SYNC_LABELS: 'intake, from:notion',
    NOTION_GITHUB_SYNC_ALLOWED_PRIORITY_LABELS: 'priority: low,priority: high',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.pollSeconds, 60);
  assert.deepEqual(config.defaultLabels, ['intake', 'from:notion']);
  assert.deepEqual(config.allowedPriorityLabels, ['priority: low', 'priority: high']);
  assert.equal(config.properties.title, 'Title');
  assert.equal(config.properties.githubIssueUrl, 'GitHub Issue URL');
});
```

- [ ] **Step 2: Run config test to verify it fails**

Run: `node --test paperclip/notion-github-sync/config.test.mjs`

Expected: FAIL with module-not-found for `config.mjs`.

- [ ] **Step 3: Implement config**

Create `config.mjs` with:

```js
const DEFAULT_PROPERTIES = Object.freeze({
  title: 'Title',
  requestType: 'Request Type',
  description: 'Description',
  businessContext: 'Business Context',
  acceptanceCriteria: 'Acceptance Criteria',
  requesterName: 'Requester Name',
  requesterEmail: 'Requester Email',
  company: 'Company',
  businessPriority: 'Business Priority',
  requestedDueDate: 'Requested Due Date',
  requesterFollowUp: 'Requester Follow-up',
  sendFollowUp: 'Send Follow-up',
  githubIssueUrl: 'GitHub Issue URL',
  githubIssueNumber: 'GitHub Issue Number',
  githubIssueNodeId: 'GitHub Issue Node ID',
  githubState: 'GitHub State',
  githubStateReason: 'GitHub State Reason',
  githubLabels: 'GitHub Labels',
  githubAssignee: 'GitHub Assignee',
  githubProjectStatus: 'GitHub Project Status',
  githubMilestone: 'GitHub Milestone',
  githubClosedAt: 'GitHub Closed At',
  lastGitHubSync: 'Last GitHub Sync',
  syncStatus: 'Sync Status',
  syncError: 'Sync Error',
  lastSyncDirection: 'Last Sync Direction',
  lastSyncActor: 'Last Sync Actor',
  lastNotionHash: 'Last Notion Hash',
  lastGitHubHash: 'Last GitHub Hash',
  lastCommentHash: 'Last Comment Hash',
  lastProcessedAt: 'Last Processed At',
});

const REQUIRED_WHEN_ENABLED = [
  'NOTION_TOKEN',
  'NOTION_INTAKE_DATABASE_ID',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO',
];

export function loadConfig(env = process.env) {
  const enabled = truthy(env.NOTION_GITHUB_SYNC_ENABLED);
  if (!enabled) {
    return {
      enabled: false,
      pollSeconds: parsePositiveInt(env.NOTION_GITHUB_SYNC_POLL_SECONDS, 60),
      properties: { ...DEFAULT_PROPERTIES },
    };
  }

  const missing = REQUIRED_WHEN_ENABLED.filter((name) => !String(env[name] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  return {
    enabled: true,
    notionToken: env.NOTION_TOKEN,
    notionDatabaseId: env.NOTION_INTAKE_DATABASE_ID,
    githubToken: env.GITHUB_TOKEN,
    githubOwner: env.GITHUB_OWNER,
    githubRepo: env.GITHUB_REPO,
    pollSeconds: parsePositiveInt(env.NOTION_GITHUB_SYNC_POLL_SECONDS, 60),
    defaultLabels: parseList(env.NOTION_GITHUB_SYNC_LABELS || 'intake,from:notion'),
    allowedPriorityLabels: parseList(env.NOTION_GITHUB_SYNC_ALLOWED_PRIORITY_LABELS || ''),
    includeRequesterEmail: truthy(env.NOTION_GITHUB_SYNC_INCLUDE_REQUESTER_EMAIL ?? '1'),
    publicUrl: emptyToUndefined(env.NOTION_GITHUB_SYNC_PUBLIC_URL),
    githubProjectId: emptyToUndefined(env.GITHUB_PROJECT_ID),
    githubProjectStatusFieldId: emptyToUndefined(env.GITHUB_PROJECT_STATUS_FIELD_ID),
    githubProjectDueDateFieldId: emptyToUndefined(env.GITHUB_PROJECT_DUE_DATE_FIELD_ID),
    githubWebhookSecret: emptyToUndefined(env.GITHUB_WEBHOOK_SECRET),
    notionWebhookSecret: emptyToUndefined(env.NOTION_WEBHOOK_SECRET),
    properties: { ...DEFAULT_PROPERTIES },
  };
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function emptyToUndefined(value) {
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}
```

- [ ] **Step 4: Run config test to verify it passes**

Run: `node --test paperclip/notion-github-sync/config.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing hash tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stableHash } from './hash.mjs';

test('stableHash returns the same hash for object keys in different orders', () => {
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
});

test('stableHash changes when content changes', () => {
  assert.notEqual(stableHash({ text: 'one' }), stableHash({ text: 'two' }));
});
```

- [ ] **Step 6: Run hash test to verify it fails**

Run: `node --test paperclip/notion-github-sync/hash.test.mjs`

Expected: FAIL with module-not-found or missing export for `stableHash`.

- [ ] **Step 7: Implement hash**

Create `hash.mjs` with:

```js
import { createHash } from 'node:crypto';

export function stableHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
```

- [ ] **Step 8: Run task tests**

Run: `node --test paperclip/notion-github-sync/config.test.mjs paperclip/notion-github-sync/hash.test.mjs`

Expected: PASS.

## Task 2: Mapping Functions

**Files:**
- Create: `paperclip/notion-github-sync/mapper.mjs`
- Test: `paperclip/notion-github-sync/mapper.test.mjs`

- [ ] **Step 1: Write failing mapper tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRowToIssue, mapRowToFollowUpComment, mapGitHubIssueToMirrorProperties } from './mapper.mjs';

const properties = {
  title: 'Title',
  requestType: 'Request Type',
  description: 'Description',
  businessContext: 'Business Context',
  acceptanceCriteria: 'Acceptance Criteria',
  requesterName: 'Requester Name',
  requesterEmail: 'Requester Email',
  company: 'Company',
  requesterFollowUp: 'Requester Follow-up',
};

test('mapRowToIssue creates a GitHub-style issue body and labels', () => {
  const row = {
    id: 'notion-page-id',
    url: 'https://notion.so/page',
    values: {
      Title: 'Checkout broken',
      'Request Type': 'Bug',
      Description: 'The checkout button fails.',
      'Business Context': 'Customers cannot pay.',
      'Acceptance Criteria': '- Button works',
      'Requester Name': 'Sam',
      'Requester Email': 'sam@example.com',
      Company: 'Acme',
    },
  };

  const issue = mapRowToIssue(row, {
    properties,
    defaultLabels: ['intake', 'from:notion'],
    includeRequesterEmail: true,
  });

  assert.equal(issue.title, 'Checkout broken');
  assert.deepEqual(issue.labels, ['intake', 'from:notion', 'type: bug']);
  assert.match(issue.body, /## Request\n\nThe checkout button fails\./);
  assert.match(issue.body, /## Business Context\n\nCustomers cannot pay\./);
  assert.match(issue.body, /- Email: sam@example\.com/);
  assert.match(issue.body, /Notion page ID: notion-page-id/);
});

test('mapRowToIssue omits requester email when disabled', () => {
  const issue = mapRowToIssue({
    id: 'id',
    url: 'url',
    values: {
      Title: 'Title',
      Description: 'Description',
      'Requester Email': 'private@example.com',
    },
  }, { properties, defaultLabels: [], includeRequesterEmail: false });

  assert.doesNotMatch(issue.body, /private@example\.com/);
});

test('mapRowToFollowUpComment returns null for empty follow-up', () => {
  assert.equal(mapRowToFollowUpComment({ values: { 'Requester Follow-up': '   ' } }, { properties }), null);
});

test('mapGitHubIssueToMirrorProperties mirrors GitHub-owned state', () => {
  const result = mapGitHubIssueToMirrorProperties({
    html_url: 'https://github.com/o/r/issues/4',
    number: 4,
    node_id: 'node',
    state: 'closed',
    state_reason: 'completed',
    labels: [{ name: 'intake' }, { name: 'priority: high' }],
    assignees: [{ login: 'lee' }],
    milestone: { title: 'v1' },
    closed_at: '2026-05-18T00:00:00Z',
  }, { properties, now: '2026-05-18T01:00:00.000Z' });

  assert.equal(result['GitHub Issue URL'], 'https://github.com/o/r/issues/4');
  assert.equal(result['GitHub Issue Number'], 4);
  assert.equal(result['GitHub Labels'], 'intake, priority: high');
  assert.equal(result['GitHub Assignee'], 'lee');
});
```

- [ ] **Step 2: Run mapper test to verify it fails**

Run: `node --test paperclip/notion-github-sync/mapper.test.mjs`

Expected: FAIL with module-not-found for `mapper.mjs`.

- [ ] **Step 3: Implement mapper**

Create `mapper.mjs` with focused exported functions: `mapRowToIssue`, `mapRowToFollowUpComment`, `mapGitHubIssueToMirrorProperties`, `priorityLabelForRow`, and `notionPageMarker`.

- [ ] **Step 4: Run mapper test to verify it passes**

Run: `node --test paperclip/notion-github-sync/mapper.test.mjs`

Expected: PASS.

## Task 3: Sync Engine With Fake Clients

**Files:**
- Create: `paperclip/notion-github-sync/sync-engine.mjs`
- Test: `paperclip/notion-github-sync/sync-engine.test.mjs`

- [ ] **Step 1: Write failing sync engine tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce } from './sync-engine.mjs';

function config() {
  return {
    properties: {
      title: 'Title',
      requestType: 'Request Type',
      description: 'Description',
      businessContext: 'Business Context',
      acceptanceCriteria: 'Acceptance Criteria',
      requesterName: 'Requester Name',
      requesterEmail: 'Requester Email',
      company: 'Company',
      businessPriority: 'Business Priority',
      requesterFollowUp: 'Requester Follow-up',
      sendFollowUp: 'Send Follow-up',
      githubIssueUrl: 'GitHub Issue URL',
      githubIssueNumber: 'GitHub Issue Number',
      githubIssueNodeId: 'GitHub Issue Node ID',
      githubState: 'GitHub State',
      githubStateReason: 'GitHub State Reason',
      githubLabels: 'GitHub Labels',
      githubAssignee: 'GitHub Assignee',
      githubMilestone: 'GitHub Milestone',
      githubClosedAt: 'GitHub Closed At',
      lastGitHubSync: 'Last GitHub Sync',
      syncStatus: 'Sync Status',
      syncError: 'Sync Error',
      lastSyncDirection: 'Last Sync Direction',
      lastSyncActor: 'Last Sync Actor',
      lastCommentHash: 'Last Comment Hash',
      lastProcessedAt: 'Last Processed At',
    },
    defaultLabels: ['intake', 'from:notion'],
    allowedPriorityLabels: ['priority: high'],
    includeRequesterEmail: true,
  };
}

test('syncOnce creates one GitHub issue for a new Notion row', async () => {
  const updates = [];
  const created = [];
  const notion = {
    listRows: async () => [{
      id: 'page-1',
      url: 'https://notion/page-1',
      values: {
        Title: 'New bug',
        Description: 'Broken',
      },
    }],
    updateRow: async (id, values) => updates.push({ id, values }),
  };
  const github = {
    findIssueByNotionPageId: async () => null,
    createIssue: async (issue) => {
      created.push(issue);
      return {
        html_url: 'https://github.com/o/r/issues/1',
        number: 1,
        node_id: 'node-1',
        state: 'open',
        labels: [{ name: 'intake' }],
        assignees: [],
      };
    },
  };

  const result = await syncOnce({ config: config(), notion, github, now: () => '2026-05-18T00:00:00.000Z' });

  assert.equal(result.createdIssues, 1);
  assert.equal(created.length, 1);
  assert.equal(updates[0].values['GitHub Issue Number'], 1);
  assert.equal(updates[0].values['Sync Status'], 'synced');
});

test('syncOnce posts a follow-up comment exactly once', async () => {
  const comments = [];
  const updates = [];
  const row = {
    id: 'page-1',
    url: 'https://notion/page-1',
    values: {
      Title: 'Existing',
      'GitHub Issue Number': 3,
      'GitHub Issue URL': 'https://github.com/o/r/issues/3',
      'Requester Follow-up': 'Any update?',
      'Send Follow-up': true,
      'Last Comment Hash': '',
    },
  };
  const notion = {
    listRows: async () => [row],
    updateRow: async (id, values) => updates.push({ id, values }),
  };
  const github = {
    addComment: async (number, body) => {
      comments.push({ number, body });
      return { html_url: 'https://github.com/o/r/issues/3#comment' };
    },
    getIssue: async () => ({
      html_url: 'https://github.com/o/r/issues/3',
      number: 3,
      node_id: 'node-3',
      state: 'open',
      labels: [],
      assignees: [],
    }),
  };

  const result = await syncOnce({ config: config(), notion, github, now: () => '2026-05-18T00:00:00.000Z' });

  assert.equal(result.commentsPosted, 1);
  assert.equal(comments[0].body, 'Requester follow-up from Notion:\n\nAny update?');
  assert.equal(updates[0].values['Send Follow-up'], false);
  assert.ok(updates[0].values['Last Comment Hash']);
});
```

- [ ] **Step 2: Run sync engine test to verify it fails**

Run: `node --test paperclip/notion-github-sync/sync-engine.test.mjs`

Expected: FAIL with module-not-found for `sync-engine.mjs`.

- [ ] **Step 3: Implement sync engine**

Create `sync-engine.mjs` with `syncOnce({ config, notion, github, now })`. It should process new rows, follow-up commands, priority labels when configured, and mirror GitHub fields back into Notion.

- [ ] **Step 4: Run sync engine test to verify it passes**

Run: `node --test paperclip/notion-github-sync/sync-engine.test.mjs`

Expected: PASS.

## Task 4: Real API Clients and Service Entrypoint

**Files:**
- Create: `paperclip/notion-github-sync/notion-client.mjs`
- Create: `paperclip/notion-github-sync/github-client.mjs`
- Create: `paperclip/notion-github-sync/service.mjs`
- Test: `paperclip/notion-github-sync/notion-client.test.mjs`
- Test: `paperclip/notion-github-sync/github-client.test.mjs`

- [ ] **Step 1: Write API client tests with fake fetch**

Tests should verify:

- Notion client converts title, rich text, select, multi-select, checkbox, date, url, and number properties into plain row values.
- Notion client converts plain update values back into Notion property payloads.
- GitHub client sends `POST /repos/{owner}/{repo}/issues` for issue creation.
- GitHub client searches issues using the Notion page marker before creating duplicates.

- [ ] **Step 2: Run API client tests to verify they fail**

Run: `node --test paperclip/notion-github-sync/notion-client.test.mjs paperclip/notion-github-sync/github-client.test.mjs`

Expected: FAIL with module-not-found for the new clients.

- [ ] **Step 3: Implement Notion client**

Implement `createNotionClient(config, fetchImpl = fetch)` with `listRows()` and `updateRow(pageId, values)`. Use `POST https://api.notion.com/v1/databases/{database_id}/query` and `PATCH https://api.notion.com/v1/pages/{page_id}` with `Notion-Version: 2022-06-28`.

- [ ] **Step 4: Implement GitHub client**

Implement `createGitHubClient(config, fetchImpl = fetch)` with `createIssue`, `getIssue`, `addComment`, `setPriorityLabel`, and `findIssueByNotionPageId`. Use GitHub REST with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`.

- [ ] **Step 5: Implement service entrypoint**

Implement `service.mjs` so disabled mode logs and exits, enabled mode validates config, creates clients, runs `syncOnce` in a loop, and backs off after errors without exiting.

- [ ] **Step 6: Run API client tests**

Run: `node --test paperclip/notion-github-sync/notion-client.test.mjs paperclip/notion-github-sync/github-client.test.mjs`

Expected: PASS.

## Task 5: Runtime Wiring and Docs

**Files:**
- Modify: `paperclip/Dockerfile`
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add Docker copy**

Add this near the existing `COPY paperclip/profile-sync.mjs` lines:

```dockerfile
COPY paperclip/notion-github-sync /opt/paperclip/notion-github-sync
```

- [ ] **Step 2: Add Compose service**

Add a `notion-github-sync` service using the same image, `node /opt/paperclip/notion-github-sync/service.mjs`, shared `/data`, `depends_on: [paperclip]`, and env vars from `.env.example`. Keep `restart: unless-stopped`.

- [ ] **Step 3: Add env defaults**

Add disabled defaults to `.env.example`:

```env
NOTION_GITHUB_SYNC_ENABLED=0
NOTION_GITHUB_SYNC_POLL_SECONDS=60
NOTION_TOKEN=
NOTION_INTAKE_DATABASE_ID=
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
NOTION_GITHUB_SYNC_LABELS=intake,from:notion
NOTION_GITHUB_SYNC_ALLOWED_PRIORITY_LABELS=priority: low,priority: medium,priority: high
NOTION_GITHUB_SYNC_INCLUDE_REQUESTER_EMAIL=1
```

- [ ] **Step 4: Add README section**

Document:

- Required Notion database fields.
- GitHub labels to create.
- GitHub Project auto-add filter such as `label:intake label:from:notion`.
- Env vars.
- The GitHub-first conflict rules.

- [ ] **Step 5: Run compose config verification**

Run: `docker compose --env-file .env.example config --services`

Expected includes:

```text
paperclip
hermes
notion-github-sync
```

## Task 6: Full Verification

**Files:**
- Modify only if verification reveals a focused issue in files touched above.

- [ ] **Step 1: Run focused tests**

Run: `node --test paperclip/notion-github-sync/*.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run full repo tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run compose services check**

Run: `docker compose --env-file .env.example config --services`

Expected: PASS and includes `notion-github-sync`.

- [ ] **Step 4: Check git diff**

Run: `git diff --stat && git status --short`

Expected: only files from this feature are modified or untracked.
