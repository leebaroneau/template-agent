# Paperclip Profile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Paperclip Hermes agent automatically receive an isolated Hermes profile and GBrain home named `companyname-profilename`.

**Architecture:** Add a Node-based profile sync utility to the existing agent-stack image. It lists Paperclip companies and agents through the Paperclip CLI/API, provisions missing runtime homes, patches Hermes agents with per-profile `HERMES_HOME` and `GBRAIN_HOME`, and archives/purges homes for managed agents that disappear.

**Tech Stack:** Node 22 ESM, Paperclip HTTP API, existing Hermes/GBrain container image, Docker Compose.

---

### Task 1: Add Unit Tests For Profile Sync

**Files:**
- Create: `00_resources/agent-stack/paperclip/profile-sync.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildManagedAgentPayload,
  desiredProfileSlug,
  ensureProfileHomes,
  reconcileAgents,
} from './profile-sync.mjs';

test('desiredProfileSlug combines sanitized company and profile names', () => {
  assert.equal(desiredProfileSlug('Acme, Inc.', 'SEO Researcher'), 'acme-inc-seo-researcher');
});

test('buildManagedAgentPayload isolates Hermes and GBrain for one profile', () => {
  const payload = buildManagedAgentPayload({
    agent: { name: 'Researcher', adapterConfig: { timeoutSec: 30, env: { KEEP_ME: '1' } } },
    companyName: 'Acme',
    paperclipAgentServerUrl: 'http://paperclip:3100',
  });

  assert.equal(payload.adapterConfig.env.HERMES_HOME, '/data/hermes/profiles/acme-researcher');
  assert.equal(payload.adapterConfig.env.GBRAIN_HOME, '/data/gbrain/acme-researcher');
  assert.equal(payload.adapterConfig.env.PAPERCLIP_API_URL, 'http://paperclip:3100');
  assert.equal(payload.adapterConfig.env.KEEP_ME, '1');
  assert.equal(payload.metadata.agentStackProfileSlug, 'acme-researcher');
});

test('ensureProfileHomes creates profile config, soul, and gbrain directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-'));
  try {
    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: join(root, 'hermes'),
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    assert.equal(result.hermesHome, join(root, 'hermes/profiles/acme-researcher'));
    assert.equal(result.gbrainHome, join(root, 'gbrain/acme-researcher'));
    assert.match(await readFile(join(result.hermesHome, 'config.yaml'), 'utf8'), /model:/);
    assert.match(await readFile(join(result.hermesHome, 'SOUL.md'), 'utf8'), /Hermes/);
    await stat(result.gbrainHome);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reconcileAgents patches only hermes_local agents and records managed entries', async () => {
  const apiCalls = [];
  const result = await reconcileAgents({
    companies: [{ id: 'co_1', name: 'Acme, Inc.' }],
    listAgents: async () => [
      { id: 'a_1', name: 'Researcher', adapterType: 'hermes_local', adapterConfig: {}, metadata: {} },
      { id: 'a_2', name: 'Designer', adapterType: 'other', adapterConfig: {}, metadata: {} },
    ],
    patchAgent: async (agentId, payload) => {
      apiCalls.push({ agentId, payload });
      return { id: agentId, ...payload };
    },
    ensureHomes: async ({ profileSlug }) => ({ profileSlug }),
    manifest: { managedAgents: [] },
    paperclipAgentServerUrl: 'http://paperclip:3100',
  });

  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].agentId, 'a_1');
  assert.equal(apiCalls[0].payload.metadata.agentStackProfileSlug, 'acme-inc-researcher');
  assert.equal(result.manifest.managedAgents.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd 00_resources/agent-stack && node --test paperclip/profile-sync.test.mjs`
Expected: FAIL because `paperclip/profile-sync.mjs` does not exist.

### Task 2: Implement Profile Sync Utility

**Files:**
- Create: `00_resources/agent-stack/paperclip/profile-sync.mjs`
- Modify: `00_resources/agent-stack/paperclip/Dockerfile`

- [ ] **Step 1: Add `profile-sync.mjs` with exported helpers and CLI**

Implement:
- `desiredProfileSlug(companyName, profileName)`
- `buildManagedAgentPayload(...)`
- `ensureProfileHomes(...)`
- `reconcileAgents(...)`
- CLI modes: `once` and `loop`

- [ ] **Step 2: Copy script into image**

Add `COPY paperclip/profile-sync.mjs /opt/paperclip/profile-sync.mjs` to the Dockerfile.

- [ ] **Step 3: Run tests to verify pass**

Run: `cd 00_resources/agent-stack && node --test paperclip/profile-sync.test.mjs`
Expected: PASS.

### Task 3: Wire Compose Service

**Files:**
- Modify: `00_resources/agent-stack/compose.yaml`
- Modify: `00_resources/agent-stack/.env.example`
- Modify: `00_resources/agent-stack/.env.coolify.example`

- [ ] **Step 1: Add `profile-sync` service**

Use the existing image, shared `paperclip-data` volume, and command:

```yaml
entrypoint: ["/usr/bin/tini", "--", "node", "/opt/paperclip/profile-sync.mjs", "loop"]
```

- [ ] **Step 2: Add sync environment variables**

Add:

```env
PROFILE_SYNC_ENABLED=0
PROFILE_SYNC_INTERVAL_SEC=60
PROFILE_SYNC_DELETE_MODE=archive
PAPERCLIP_PROFILE_SYNC_API_KEY=
```

- [ ] **Step 3: Render compose**

Run: `cd 00_resources/agent-stack && docker compose --env-file .env.example config`
Expected: YAML renders `paperclip`, `hermes-ui`, and `profile-sync`.

### Task 4: Update Documentation

**Files:**
- Modify: `00_resources/agent-stack/README.md`
- Modify: `00_resources/agent-stack/docs/design.md`
- Modify: `00_resources/agent-stack/docs/runbook.md`

- [ ] **Step 1: Document lifecycle**

Explain that Paperclip owns companies/agents, profile-sync owns runtime homes, Hermes owns execution, and GBrain owns per-agent memory.

- [ ] **Step 2: Document deletion mode**

Explain `archive` default and `purge` opt-in.

### Task 5: Verify The Stack

**Files:**
- Test-only

- [ ] **Step 1: Run existing tests**

Run:
`cd 00_resources/agent-stack && node --test paperclip/seed-agents.test.mjs paperclip/profile-sync.test.mjs`

- [ ] **Step 2: Run shell checks**

Run:
`cd 00_resources/agent-stack && ./scripts/test-default-profile-only.sh && ./scripts/test-hermes-tui-prebuilt.sh && ./scripts/test-no-provider-placeholders.sh`

- [ ] **Step 3: Build image**

Run:
`cd 00_resources/agent-stack && docker build -f paperclip/Dockerfile -t agent-stack-paperclip:profile-sync-check .`
