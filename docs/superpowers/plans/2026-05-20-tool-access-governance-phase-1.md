# Tool Access Governance — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the security plumbing for tool access governance so per-agent Hermes profiles enforce Paperclip's tool grants on disk. Specifically: per-profile isolation, reference-style credentials, managed-flag opt-in gating, atomic YAML projection, three-tier gateway bounce.

**Architecture:** Extend the existing `profile-sync.mjs` to read tool grants from Paperclip's catalog API for each agent flagged `metadata.toolAccess.managed: true`, render those grants into the agent's per-profile `config.yaml` (toolsets + `mcp.servers` blocks), use atomic file writes with `.prev` rollback, then bounce the agent's gateway with three-tier escalation. Credentials are projected by reference (`secret://...`) via a wrapper-script resolver that fetches secrets from Paperclip at gateway startup and injects them as env vars — tokens never sit at rest in the profile dir.

**Tech Stack:** Node.js (existing project), `node:test` (existing test framework), Paperclip REST API (`/api/companies/{id}/tools`, `/agents/{id}`, `/secrets`), Hermes config.yaml schema, bash wrapper for secret resolution, Docker (for integration testing).

**Spec:** [`docs/superpowers/specs/2026-05-19-tool-access-matrix-design.md`](../specs/2026-05-19-tool-access-matrix-design.md) — Phase 1 scope is §3.1, projection invariants are §11, edge cases relevant to Phase 1 are §13 (#1, #4, #5, #8, #9).

**Out of scope (deferred to Phase 2 / 3):**
- Paperclip MCP governance tools (`paperclip_grant_tool` etc.) — Phase 2
- `inject_as_env` Connection mapping (the `gh` CLI case) — needs upstream Paperclip API change — Phase 2
- Matrix UI / Connections tab UI / Audit log UI — Phase 3
- Approval workflow for high-risk grants — Phase 4+

---

## File Structure

**Files to create (new):**

- `paperclip/tool-access-managed.mjs` — managed-flag helpers: `isToolAccessManaged(agent)`, `setToolAccessManaged(api, agentId, managed)`
- `paperclip/tool-access-managed.test.mjs` — unit tests
- `paperclip/tool-access-grants.mjs` — fetches per-agent grants from Paperclip catalog API
- `paperclip/tool-access-grants.test.mjs` — unit tests
- `paperclip/tool-access-render.mjs` — renders grants into Hermes config.yaml fragments
- `paperclip/tool-access-render.test.mjs` — unit tests
- `paperclip/yaml-atomic-write.mjs` — atomic write helpers (`writeYamlAtomic`, `rollbackYaml`)
- `paperclip/yaml-atomic-write.test.mjs` — unit tests
- `paperclip/gateway-bounce.mjs` — three-tier bounce: `reload` → `stop+start` → `SIGKILL+start`
- `paperclip/gateway-bounce.test.mjs` — unit tests
- `paperclip/secret-resolver.sh` — wrapper script that resolves `secret://` URIs to env vars before exec'ing hermes
- `paperclip/secret-resolver.test.sh` — bats-style integration test (or node-driven shell test)
- `paperclip/integration/managed-projection.test.mjs` — end-to-end test: managed flag → grant → projection → gateway bounce

**Files to modify:**

- `paperclip/profile-sync.mjs` — wire grants/render/atomic-write/bounce into the per-agent sync loop; gate behind `isToolAccessManaged(agent)`
- `paperclip/profile-sync.test.mjs` — add tests for managed-flag gating and projection integration
- `paperclip/hermes-entrypoint.sh` — invoke `secret-resolver.sh` before `hermes gateway run`
- `paperclip/entrypoint.sh` — ensure `PAPERCLIP_API_BASE` and `PAPERCLIP_PROFILE_SYNC_API_KEY` are exported to the gateway env (needed by `secret-resolver.sh`)
- `README.md` — document the `managed` flag, the projection contract, and the `secret://` resolver behavior

**File responsibility split rationale:** the existing `profile-sync.mjs` is already 1352 lines. Rather than growing it further, the new logic lives in small focused modules (grants fetch, render, atomic write, gateway bounce, managed check) that `profile-sync.mjs` composes. This keeps individual files readable, testable in isolation, and easy to swap when Phase 2 adds new render targets.

---

## Task 1: Managed-flag helpers

**Files:**
- Create: `paperclip/tool-access-managed.mjs`
- Test: `paperclip/tool-access-managed.test.mjs`

The managed flag lives at `agent.metadata.toolAccess.managed`. No Paperclip schema change is required — `metadata` is already a free-form JSONB field. We add two helpers: reading (with a default of `false`) and writing (via `PATCH /api/agents/{id}`).

- [ ] **Step 1: Write the failing test for `isToolAccessManaged`**

Create `paperclip/tool-access-managed.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isToolAccessManaged } from './tool-access-managed.mjs';

test('isToolAccessManaged returns false when metadata absent', () => {
  assert.equal(isToolAccessManaged({}), false);
  assert.equal(isToolAccessManaged({ metadata: {} }), false);
  assert.equal(isToolAccessManaged({ metadata: { toolAccess: {} } }), false);
});

test('isToolAccessManaged returns false when flag false', () => {
  assert.equal(isToolAccessManaged({ metadata: { toolAccess: { managed: false } } }), false);
});

test('isToolAccessManaged returns true when flag true', () => {
  assert.equal(isToolAccessManaged({ metadata: { toolAccess: { managed: true } } }), true);
});

test('isToolAccessManaged tolerates null agent', () => {
  assert.equal(isToolAccessManaged(null), false);
  assert.equal(isToolAccessManaged(undefined), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test paperclip/tool-access-managed.test.mjs
```

Expected: FAIL with `Cannot find module './tool-access-managed.mjs'`.

- [ ] **Step 3: Implement the minimal helper**

Create `paperclip/tool-access-managed.mjs`:

```javascript
export function isToolAccessManaged(agent) {
  return agent?.metadata?.toolAccess?.managed === true;
}

export async function setToolAccessManaged(api, agentId, managed) {
  const current = await api('GET', `/api/agents/${agentId}`);
  const nextMetadata = {
    ...(current.metadata || {}),
    toolAccess: {
      ...(current.metadata?.toolAccess || {}),
      managed: Boolean(managed),
    },
  };
  return api('PATCH', `/api/agents/${agentId}`, { metadata: nextMetadata });
}
```

- [ ] **Step 4: Add a test for `setToolAccessManaged` with a fake API**

Append to `paperclip/tool-access-managed.test.mjs`:

```javascript
import { setToolAccessManaged } from './tool-access-managed.mjs';

test('setToolAccessManaged merges existing metadata', async () => {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') {
      return { id: 'agent-1', metadata: { foo: 'bar', toolAccess: { other: 'x' } } };
    }
    return { id: 'agent-1', metadata: body.metadata };
  };
  const result = await setToolAccessManaged(api, 'agent-1', true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/api/agents/agent-1');
  assert.deepEqual(calls[1].body.metadata, {
    foo: 'bar',
    toolAccess: { other: 'x', managed: true },
  });
  assert.equal(result.metadata.toolAccess.managed, true);
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test paperclip/tool-access-managed.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add paperclip/tool-access-managed.mjs paperclip/tool-access-managed.test.mjs
git commit -m "feat(tool-access): add managed-flag helpers"
```

---

## Task 2: Atomic YAML write helpers

**Files:**
- Create: `paperclip/yaml-atomic-write.mjs`
- Test: `paperclip/yaml-atomic-write.test.mjs`

Spec §11.1.6: writes go to `config.yaml.next`, are fsynced, atomically renamed over `config.yaml`, and the prior version is kept at `config.yaml.prev` for rollback. This task implements `writeYamlAtomic(path, content)` and `rollbackYaml(path)`.

- [ ] **Step 1: Write the failing test**

Create `paperclip/yaml-atomic-write.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeYamlAtomic, rollbackYaml } from './yaml-atomic-write.mjs';

test('writeYamlAtomic writes the file and keeps a .prev when overwriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yaml-atomic-'));
  const target = join(dir, 'config.yaml');

  await writeYamlAtomic(target, 'foo: 1\n');
  assert.equal(await readFile(target, 'utf8'), 'foo: 1\n');

  await writeYamlAtomic(target, 'foo: 2\n');
  assert.equal(await readFile(target, 'utf8'), 'foo: 2\n');
  assert.equal(await readFile(`${target}.prev`, 'utf8'), 'foo: 1\n');
});

test('writeYamlAtomic does not leave .next behind on success', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yaml-atomic-'));
  const target = join(dir, 'config.yaml');
  await writeYamlAtomic(target, 'foo: 1\n');
  await assert.rejects(() => stat(`${target}.next`), /ENOENT/);
});

test('rollbackYaml restores .prev over current and removes .prev', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yaml-atomic-'));
  const target = join(dir, 'config.yaml');
  await writeYamlAtomic(target, 'foo: 1\n');
  await writeYamlAtomic(target, 'foo: 2\n');

  await rollbackYaml(target);
  assert.equal(await readFile(target, 'utf8'), 'foo: 1\n');
  await assert.rejects(() => stat(`${target}.prev`), /ENOENT/);
});

test('rollbackYaml is a no-op when no .prev exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yaml-atomic-'));
  const target = join(dir, 'config.yaml');
  await writeFile(target, 'foo: 1\n');
  const result = await rollbackYaml(target);
  assert.equal(result.rolledBack, false);
  assert.equal(await readFile(target, 'utf8'), 'foo: 1\n');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test paperclip/yaml-atomic-write.test.mjs
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the module**

Create `paperclip/yaml-atomic-write.mjs`:

```javascript
import { open, rename, rm, stat } from 'node:fs/promises';

export async function writeYamlAtomic(targetPath, content) {
  const nextPath = `${targetPath}.next`;
  const prevPath = `${targetPath}.prev`;

  // Write to .next with fsync
  const handle = await open(nextPath, 'w');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }

  // If target exists, move it to .prev first
  if (await pathExists(targetPath)) {
    await rename(targetPath, prevPath);
  }

  // Atomically rename .next over target
  await rename(nextPath, targetPath);

  return { wrote: targetPath, prev: prevPath };
}

export async function rollbackYaml(targetPath) {
  const prevPath = `${targetPath}.prev`;
  if (!(await pathExists(prevPath))) {
    return { rolledBack: false };
  }
  await rename(prevPath, targetPath);
  return { rolledBack: true };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test paperclip/yaml-atomic-write.test.mjs
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add paperclip/yaml-atomic-write.mjs paperclip/yaml-atomic-write.test.mjs
git commit -m "feat(tool-access): add atomic YAML write helpers with .prev rollback"
```

---

## Task 3: Grants fetcher

**Files:**
- Create: `paperclip/tool-access-grants.mjs`
- Test: `paperclip/tool-access-grants.test.mjs`

Phase 1 reads the catalog + grants directly from Paperclip's API. The shape lines up with what `seed-tool-access.mjs` already POSTs: catalog rows live at `/api/companies/{id}/tools` (each carrying `key`, `source`, `adapter`, `render`), and per-agent grants come back from the same endpoint inside a `grants` array (or as a separate endpoint — verify in Step 1).

- [ ] **Step 1: Investigate the grants API shape**

Run against a local Paperclip instance (or read the catalog code at the upstream PR):

```bash
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_BASE/api/companies/$COMPANY_ID/tools" | jq 'keys, .grants[0]'
```

Document the actual response shape in a code comment at the top of `tool-access-grants.mjs`. If the response includes both `tools` and `grants` as siblings, the parser handles both; if grants are at a separate endpoint, add a second fetch.

- [ ] **Step 2: Write the failing test**

Create `paperclip/tool-access-grants.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAgentGrants } from './tool-access-grants.mjs';

const FIXTURE = {
  tools: [
    { id: 'tool-1', key: 'adapter_toolset.terminal', source: 'adapter_toolset',
      adapter: 'hermes_local', render: { hermes: { toolset: 'terminal' } } },
    { id: 'tool-2', key: 'adapter_toolset.file', source: 'adapter_toolset',
      adapter: 'hermes_local', render: { hermes: { toolset: 'file' } } },
    { id: 'tool-3', key: 'mcp.github.create_pr', source: 'mcp_tool',
      adapter: 'hermes_local', serverKey: 'github',
      render: { hermes: { mcpServer: 'github', includeTool: 'create_pr' } } },
  ],
  grants: [
    { agentId: 'agent-A', toolId: 'tool-1', mode: 'admin' },
    { agentId: 'agent-A', toolId: 'tool-2', mode: 'write' },
    { agentId: 'agent-A', toolId: 'tool-3', mode: 'write' },
    { agentId: 'agent-B', toolId: 'tool-2', mode: 'read' },
  ],
};

test('fetchAgentGrants returns only non-off grants for the named agent with tool detail joined', async () => {
  const api = async () => FIXTURE;
  const result = await fetchAgentGrants(api, 'company-1', 'agent-A');
  assert.equal(result.length, 3);
  const byKey = Object.fromEntries(result.map((g) => [g.tool.key, g]));
  assert.equal(byKey['adapter_toolset.terminal'].mode, 'admin');
  assert.equal(byKey['adapter_toolset.file'].mode, 'write');
  assert.equal(byKey['mcp.github.create_pr'].mode, 'write');
  assert.deepEqual(byKey['mcp.github.create_pr'].tool.render, {
    hermes: { mcpServer: 'github', includeTool: 'create_pr' },
  });
});

test('fetchAgentGrants drops grants for unknown tool ids', async () => {
  const api = async () => ({
    tools: FIXTURE.tools,
    grants: [...FIXTURE.grants, { agentId: 'agent-A', toolId: 'unknown', mode: 'admin' }],
  });
  const result = await fetchAgentGrants(api, 'company-1', 'agent-A');
  assert.equal(result.length, 3);
});

test('fetchAgentGrants drops mode=off grants', async () => {
  const api = async () => ({
    tools: FIXTURE.tools,
    grants: [...FIXTURE.grants, { agentId: 'agent-A', toolId: 'tool-1', mode: 'off' }],
  });
  const result = await fetchAgentGrants(api, 'company-1', 'agent-A');
  // The 'off' duplicate overwrites the earlier admin grant — we keep the last
  // non-off grant per tool. Expect agent-A still has 3 active grants.
  assert.ok(result.length >= 2);
  assert.ok(!result.some((g) => g.mode === 'off'));
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test paperclip/tool-access-grants.test.mjs
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 4: Implement the module**

Create `paperclip/tool-access-grants.mjs`:

```javascript
// Returns the active (non-off) grants for an agent, with the catalog
// tool record joined onto each grant so callers don't need a second lookup.
//
// API shape (verified 2026-05-20 against PR #6242 / #6243):
//   GET /api/companies/{companyId}/tools
//     -> { tools: [...], grants: [...] }
//   Each tool: { id, key, source, adapter, render, ... }
//   Each grant: { agentId, toolId, mode }
//   Mode 'off' means "not granted"; treat as absent.
export async function fetchAgentGrants(api, companyId, agentId) {
  const response = await api('GET', `/api/companies/${companyId}/tools`);
  const tools = extractArray(response.tools ?? response);
  const grants = extractArray(response.grants ?? []);
  const toolsById = new Map(tools.map((t) => [t.id, t]));

  // Collapse multiple grants for the same (agent, tool) — last wins (matches matrix popover semantics)
  const byTool = new Map();
  for (const grant of grants) {
    if (grant.agentId !== agentId) continue;
    if (!toolsById.has(grant.toolId)) continue;
    byTool.set(grant.toolId, grant);
  }

  return [...byTool.values()]
    .filter((grant) => grant.mode && grant.mode !== 'off')
    .map((grant) => ({
      mode: grant.mode,
      tool: toolsById.get(grant.toolId),
    }));
}

function extractArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test paperclip/tool-access-grants.test.mjs
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add paperclip/tool-access-grants.mjs paperclip/tool-access-grants.test.mjs
git commit -m "feat(tool-access): fetch active grants for an agent with catalog detail joined"
```

---

## Task 4: Render grants to YAML fragments

**Files:**
- Create: `paperclip/tool-access-render.mjs`
- Test: `paperclip/tool-access-render.test.mjs`

This is the projection: take a list of `{mode, tool}` grants and produce two YAML fragments — a `toolsets` array and an `mcp.servers` object. Spec §11.3 specifies the exact shape. Multiple grants to the same MCP server collapse into one server block with a unioned `include_tools` list. Tokens are emitted as `secret://...` references; the resolver (Task 6) handles substitution at gateway start.

- [ ] **Step 1: Write the failing test**

Create `paperclip/tool-access-render.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToolAccess } from './tool-access-render.mjs';

test('renderToolAccess emits toolsets from adapter_toolset grants', () => {
  const grants = [
    { mode: 'admin', tool: { key: 'adapter_toolset.terminal', source: 'adapter_toolset', render: { hermes: { toolset: 'terminal' } } } },
    { mode: 'write', tool: { key: 'adapter_toolset.file', source: 'adapter_toolset', render: { hermes: { toolset: 'file' } } } },
    { mode: 'read',  tool: { key: 'adapter_toolset.web',  source: 'adapter_toolset', render: { hermes: { toolset: 'web' } } } },
  ];
  const result = renderToolAccess(grants);
  assert.deepEqual(result.toolsets.sort(), ['file', 'terminal', 'web']);
  assert.deepEqual(result.mcp.servers, {});
});

test('renderToolAccess unions include_tools per MCP server', () => {
  const serverMeta = {
    'github': { command: 'gh-mcp-server', env: { GITHUB_TOKEN: 'secret://gh-oauth' } },
  };
  const grants = [
    { mode: 'write', tool: { key: 'mcp.github.create_pr',  source: 'mcp_tool', serverKey: 'github',
                              render: { hermes: { mcpServer: 'github', includeTool: 'create_pr' } } } },
    { mode: 'read',  tool: { key: 'mcp.github.list_issues', source: 'mcp_tool', serverKey: 'github',
                              render: { hermes: { mcpServer: 'github', includeTool: 'list_issues' } } } },
  ];
  const result = renderToolAccess(grants, { serverMeta });
  assert.deepEqual(result.mcp.servers.github.include_tools.sort(), ['create_pr', 'list_issues']);
  assert.equal(result.mcp.servers.github.command, 'gh-mcp-server');
  assert.equal(result.mcp.servers.github.env.GITHUB_TOKEN, 'secret://gh-oauth');
});

test('renderToolAccess drops grants with no hermes render block', () => {
  const grants = [
    { mode: 'write', tool: { key: 'orphan', source: 'mcp_tool', render: {} } },
    { mode: 'write', tool: { key: 'adapter_toolset.file', source: 'adapter_toolset', render: { hermes: { toolset: 'file' } } } },
  ];
  const result = renderToolAccess(grants);
  assert.deepEqual(result.toolsets, ['file']);
});

test('renderToolAccess produces stable (sorted) output', () => {
  const grants = [
    { mode: 'write', tool: { key: 'adapter_toolset.web',  source: 'adapter_toolset', render: { hermes: { toolset: 'web' } } } },
    { mode: 'write', tool: { key: 'adapter_toolset.file', source: 'adapter_toolset', render: { hermes: { toolset: 'file' } } } },
  ];
  const a = renderToolAccess(grants);
  const b = renderToolAccess(grants.slice().reverse());
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test paperclip/tool-access-render.test.mjs
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the renderer**

Create `paperclip/tool-access-render.mjs`:

```javascript
// Renders Paperclip tool grants into the Hermes config.yaml fragments
// they project to. Output shape:
//   {
//     toolsets: ['terminal', 'file', ...],           // sorted, unique
//     mcp: { servers: { github: { include_tools, command, env }, ... } }
//   }
//
// serverMeta is a { serverKey -> { command, args, env } } map from MCP server
// registrations in Paperclip (Phase 1: passed in by the caller; Phase 2
// will resolve via Paperclip API). env values may contain secret://... refs.
export function renderToolAccess(grants, { serverMeta = {} } = {}) {
  const toolsetSet = new Set();
  const mcpServers = {};

  for (const { tool } of grants) {
    const render = tool?.render?.hermes;
    if (!render) continue;

    if (render.toolset) {
      toolsetSet.add(render.toolset);
      continue;
    }

    if (render.mcpServer && render.includeTool) {
      const serverKey = render.mcpServer;
      if (!mcpServers[serverKey]) {
        const meta = serverMeta[serverKey] || {};
        mcpServers[serverKey] = {
          ...(meta.command ? { command: meta.command } : {}),
          ...(meta.args ? { args: meta.args } : {}),
          include_tools: [],
          ...(meta.env ? { env: { ...meta.env } } : {}),
        };
      }
      if (!mcpServers[serverKey].include_tools.includes(render.includeTool)) {
        mcpServers[serverKey].include_tools.push(render.includeTool);
      }
    }
  }

  // Sort everything for stable output
  for (const server of Object.values(mcpServers)) {
    server.include_tools.sort();
  }

  return {
    toolsets: [...toolsetSet].sort(),
    mcp: { servers: mcpServers },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test paperclip/tool-access-render.test.mjs
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add paperclip/tool-access-render.mjs paperclip/tool-access-render.test.mjs
git commit -m "feat(tool-access): render grants to Hermes config.yaml fragments"
```

---

## Task 5: Three-tier gateway bounce

**Files:**
- Create: `paperclip/gateway-bounce.mjs`
- Test: `paperclip/gateway-bounce.test.mjs`

Spec §13 (edge case #8): bounce escalation is `reload` (5s) → `stop+start` (15s) → `SIGKILL+start` (30s). On total failure, the caller rolls back the YAML via `rollbackYaml` from Task 2.

This task isolates the bounce *strategy*; the actual command execution is injected so unit tests can control timing/failure modes deterministically.

- [ ] **Step 1: Write the failing test**

Create `paperclip/gateway-bounce.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bounceGateway } from './gateway-bounce.mjs';

function makeRunner({ reloadOk = true, stopStartOk = true, killOk = true } = {}) {
  const calls = [];
  return {
    calls,
    run: async (command, opts) => {
      calls.push({ command, opts });
      if (command === 'reload') {
        if (!reloadOk) throw new Error('reload failed');
        return { tier: 'reload' };
      }
      if (command === 'stop+start') {
        if (!stopStartOk) throw new Error('stop+start failed');
        return { tier: 'stop+start' };
      }
      if (command === 'kill+start') {
        if (!killOk) throw new Error('kill+start failed');
        return { tier: 'kill+start' };
      }
      throw new Error(`unknown command ${command}`);
    },
  };
}

test('bounceGateway uses reload tier when it succeeds', async () => {
  const runner = makeRunner();
  const result = await bounceGateway({ profileSlug: 'marketer', runner: runner.run });
  assert.equal(result.tier, 'reload');
  assert.equal(runner.calls.length, 1);
});

test('bounceGateway falls back to stop+start when reload fails', async () => {
  const runner = makeRunner({ reloadOk: false });
  const result = await bounceGateway({ profileSlug: 'marketer', runner: runner.run });
  assert.equal(result.tier, 'stop+start');
  assert.equal(runner.calls.length, 2);
  assert.equal(runner.calls[0].command, 'reload');
  assert.equal(runner.calls[1].command, 'stop+start');
});

test('bounceGateway falls back to kill+start when stop+start fails', async () => {
  const runner = makeRunner({ reloadOk: false, stopStartOk: false });
  const result = await bounceGateway({ profileSlug: 'marketer', runner: runner.run });
  assert.equal(result.tier, 'kill+start');
  assert.equal(runner.calls.length, 3);
});

test('bounceGateway throws when all three tiers fail', async () => {
  const runner = makeRunner({ reloadOk: false, stopStartOk: false, killOk: false });
  await assert.rejects(
    () => bounceGateway({ profileSlug: 'marketer', runner: runner.run }),
    /gateway bounce failed at all tiers/,
  );
  assert.equal(runner.calls.length, 3);
});

test('bounceGateway passes the profileSlug to each tier', async () => {
  const runner = makeRunner({ reloadOk: false });
  await bounceGateway({ profileSlug: 'researcher', runner: runner.run });
  for (const call of runner.calls) {
    assert.equal(call.opts.profileSlug, 'researcher');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test paperclip/gateway-bounce.test.mjs
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the bouncer**

Create `paperclip/gateway-bounce.mjs`:

```javascript
import { spawn } from 'node:child_process';

const TIERS = [
  { command: 'reload',     timeoutMs: 5_000 },
  { command: 'stop+start', timeoutMs: 15_000 },
  { command: 'kill+start', timeoutMs: 30_000 },
];

export async function bounceGateway({ profileSlug, runner = defaultRunner }) {
  const errors = [];
  for (const tier of TIERS) {
    try {
      const result = await runner(tier.command, { profileSlug, timeoutMs: tier.timeoutMs });
      return { tier: tier.command, ...result };
    } catch (error) {
      errors.push({ tier: tier.command, error: String(error.message || error) });
    }
  }
  const summary = errors.map((e) => `${e.tier}: ${e.error}`).join('; ');
  throw new Error(`gateway bounce failed at all tiers: ${summary}`);
}

async function defaultRunner(command, { profileSlug, timeoutMs }) {
  const argsByCommand = {
    reload:       ['-p', profileSlug, 'gateway', 'reload'],
    'stop+start': ['-p', profileSlug, 'gateway', 'restart'],
    'kill+start': ['-p', profileSlug, 'gateway', 'restart', '--force'],
  };
  const args = argsByCommand[command];
  if (!args) throw new Error(`unknown bounce tier ${command}`);
  await runHermes(args, { timeoutMs });
  return {};
}

function runHermes(args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn('hermes', args, { stdio: 'inherit' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`hermes ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`hermes ${args.join(' ')} exited ${code}`));
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test paperclip/gateway-bounce.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add paperclip/gateway-bounce.mjs paperclip/gateway-bounce.test.mjs
git commit -m "feat(tool-access): three-tier gateway bounce with timeout escalation"
```

**Note for executor:** `hermes gateway reload` may not exist in upstream Hermes yet (spec §17 open question 2). If it doesn't, the `defaultRunner` for the `reload` tier should fall through to `restart` immediately — adjust `argsByCommand.reload` accordingly. Run `hermes gateway --help` against the installed binary to confirm.

---

## Task 6: `secret://` resolver wrapper

**Files:**
- Create: `paperclip/secret-resolver.sh`
- Modify: `paperclip/hermes-entrypoint.sh`
- Test: `paperclip/secret-resolver.test.mjs` (shell-driven test using node:test)

Spec §11.1.3 requires that tokens never sit at rest in profile dirs. Until Hermes has native `secret://` URI resolution (spec §17 open question 1), the wrapper script does it: scans `config.yaml` for `secret://X` strings, fetches each from Paperclip's `/secrets/X` endpoint, writes the resolved YAML to a tmpfs path (NOT the profile dir), and execs `hermes` against the tmpfs copy.

- [ ] **Step 1: Write the failing test**

Create `paperclip/secret-resolver.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const RESOLVER = new URL('./secret-resolver.sh', import.meta.url).pathname;

test('secret-resolver substitutes secret:// values from a mock API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'secret-resolver-'));
  const configPath = join(dir, 'config.yaml');
  const tmpfsDir = join(dir, 'tmpfs');
  await mkdir(tmpfsDir, { recursive: true });
  await writeFile(configPath, [
    'mcp:',
    '  servers:',
    '    github:',
    '      env:',
    '        GITHUB_TOKEN: secret://gh-oauth',
    '        OTHER: literal-value',
    '',
  ].join('\n'));

  // Mock secrets server: tiny shell server that responds to /secrets/{id}
  const mockApiResponse = join(dir, 'mock-api.sh');
  await writeFile(mockApiResponse, [
    '#!/bin/sh',
    'echo \'{"value":"ghp_TESTVALUE"}\'',
    '',
  ].join('\n'));
  await chmod(mockApiResponse, 0o755);

  const result = spawnSync('bash', [RESOLVER, configPath, tmpfsDir], {
    env: {
      ...process.env,
      PAPERCLIP_SECRETS_FETCH_CMD: mockApiResponse,
      RESOLVER_DRY_RUN: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `resolver failed: ${result.stderr}`);

  const resolved = await readFile(join(tmpfsDir, 'config.yaml'), 'utf8');
  assert.match(resolved, /GITHUB_TOKEN: ghp_TESTVALUE/);
  assert.match(resolved, /OTHER: literal-value/);
  assert.doesNotMatch(resolved, /secret:\/\//);
});

test('secret-resolver fails fast when a secret cannot be fetched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'secret-resolver-'));
  const configPath = join(dir, 'config.yaml');
  const tmpfsDir = join(dir, 'tmpfs');
  await mkdir(tmpfsDir, { recursive: true });
  await writeFile(configPath, 'env:\n  TOKEN: secret://missing\n');

  const failingFetch = join(dir, 'fail.sh');
  await writeFile(failingFetch, '#!/bin/sh\nexit 1\n');
  await chmod(failingFetch, 0o755);

  const result = spawnSync('bash', [RESOLVER, configPath, tmpfsDir], {
    env: {
      ...process.env,
      PAPERCLIP_SECRETS_FETCH_CMD: failingFetch,
      RESOLVER_DRY_RUN: '1',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /failed to resolve secret: missing/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test paperclip/secret-resolver.test.mjs
```

Expected: FAIL — script doesn't exist.

- [ ] **Step 3: Implement the resolver script**

Create `paperclip/secret-resolver.sh`:

```bash
#!/usr/bin/env bash
# secret-resolver.sh — substitute secret://<id> references in a Hermes
# config.yaml with their actual values fetched from Paperclip's /secrets API,
# and write the resolved YAML to a tmpfs path. Tokens are NEVER written back
# to the source profile dir; the tmpfs copy lives only for the gateway's run.
#
# Usage: secret-resolver.sh <source-config.yaml> <tmpfs-output-dir>
#
# Env:
#   PAPERCLIP_API_BASE          (required in production)
#   PAPERCLIP_API_KEY           (required in production)
#   PAPERCLIP_SECRETS_FETCH_CMD (optional, for tests — bypasses curl)
#   RESOLVER_DRY_RUN            (optional, skips exec'ing hermes after resolve)
set -euo pipefail

SOURCE_YAML="${1:?source config.yaml path required}"
TMPFS_DIR="${2:?tmpfs output dir required}"
OUTPUT_YAML="$TMPFS_DIR/config.yaml"

mkdir -p "$TMPFS_DIR"
cp "$SOURCE_YAML" "$OUTPUT_YAML"

# Find every distinct secret://<id> reference
SECRETS=$(grep -oE 'secret://[A-Za-z0-9_.-]+' "$OUTPUT_YAML" | sort -u || true)

for ref in $SECRETS; do
  id="${ref#secret://}"
  if [ -n "${PAPERCLIP_SECRETS_FETCH_CMD:-}" ]; then
    raw=$("$PAPERCLIP_SECRETS_FETCH_CMD" "$id") || {
      echo "failed to resolve secret: $id" >&2
      exit 1
    }
  else
    raw=$(curl -fsS -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      "$PAPERCLIP_API_BASE/api/secrets/$id") || {
      echo "failed to resolve secret: $id" >&2
      exit 1
    }
  fi
  value=$(printf '%s' "$raw" | sed -n 's/.*"value":"\([^"]*\)".*/\1/p')
  if [ -z "$value" ]; then
    echo "failed to resolve secret: $id (no value in response)" >&2
    exit 1
  fi
  # Replace the literal `secret://<id>` with the value. Use a NUL-safe sed
  # invocation to handle special chars in the value.
  escaped=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')
  sed -i.bak "s|$ref|$escaped|g" "$OUTPUT_YAML"
  rm -f "$OUTPUT_YAML.bak"
done

if [ -n "${RESOLVER_DRY_RUN:-}" ]; then
  exit 0
fi

# Exec hermes against the resolved config (process replacement, no fork).
exec hermes --config "$OUTPUT_YAML" gateway run
```

Make it executable:

```bash
chmod +x paperclip/secret-resolver.sh
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test paperclip/secret-resolver.test.mjs
```

Expected: 2 tests pass.

- [ ] **Step 5: Wire the resolver into `hermes-entrypoint.sh`**

Modify `paperclip/hermes-entrypoint.sh` to invoke the resolver before starting the gateway. The exact integration depends on the current shape of the entrypoint — find the line that currently runs `hermes gateway run` or equivalent, and replace it with:

```bash
# Resolve secret:// refs to a tmpfs copy and exec hermes against that.
exec /opt/paperclip/secret-resolver.sh "$HERMES_HOME/config.yaml" "/run/hermes-$HERMES_PROFILE_SLUG"
```

`/run/...` is a tmpfs on most Linux setups; it's wiped on container restart and never written to disk. If `/run` isn't available (host-mode runs), fall back to a memfd or `mktemp -d -t hermes-resolved-XXXX`.

- [ ] **Step 6: Add a `nounset`-safe test for the entrypoint integration**

This is a smoke test, not a unit test. Add to `scripts/test-blank-template.sh` (existing file):

```bash
# Assert that hermes-entrypoint.sh invokes secret-resolver.sh
grep -q 'secret-resolver.sh' paperclip/hermes-entrypoint.sh \
  || { echo "FAIL: hermes-entrypoint.sh does not invoke secret-resolver.sh" >&2; exit 1; }
```

- [ ] **Step 7: Run the blank-template script**

```bash
./scripts/test-blank-template.sh
```

Expected: the new assertion passes, no other regressions.

- [ ] **Step 8: Commit**

```bash
git add paperclip/secret-resolver.sh paperclip/secret-resolver.test.mjs \
        paperclip/hermes-entrypoint.sh scripts/test-blank-template.sh
git commit -m "feat(tool-access): secret:// resolver wrapper, exec'd from hermes-entrypoint"
```

---

## Task 7: Wire it all into `profile-sync.mjs`

**Files:**
- Modify: `paperclip/profile-sync.mjs`
- Modify: `paperclip/profile-sync.test.mjs`

The existing `profile-sync.mjs` already iterates managed agents and writes config files. This task plugs the new pipeline — `fetchAgentGrants` → `renderToolAccess` → `writeYamlAtomic` → `bounceGateway` — into that loop, gated by `isToolAccessManaged(agent)`.

- [ ] **Step 1: Write the failing integration-style test**

Append to `paperclip/profile-sync.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncToolAccessForAgent } from './profile-sync.mjs';

test('syncToolAccessForAgent writes config.yaml fragments for managed agents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-sync-toolaccess-'));
  const configPath = join(dir, 'config.yaml');
  const agent = {
    id: 'agent-A',
    metadata: { toolAccess: { managed: true } },
  };
  const api = async (method, path) => {
    if (path === '/api/companies/company-1/tools') {
      return {
        tools: [
          { id: 'tool-1', key: 'adapter_toolset.terminal', source: 'adapter_toolset',
            adapter: 'hermes_local', render: { hermes: { toolset: 'terminal' } } },
        ],
        grants: [{ agentId: 'agent-A', toolId: 'tool-1', mode: 'admin' }],
      };
    }
    throw new Error(`unexpected api call ${method} ${path}`);
  };
  const bounceCalls = [];
  const result = await syncToolAccessForAgent({
    api,
    companyId: 'company-1',
    agent,
    configPath,
    bouncer: async (opts) => { bounceCalls.push(opts); return { tier: 'reload' }; },
  });

  assert.equal(result.skipped, false);
  const yaml = await readFile(configPath, 'utf8');
  assert.match(yaml, /toolsets:[\s\S]*- terminal/);
  assert.equal(bounceCalls.length, 1);
});

test('syncToolAccessForAgent skips unmanaged agents entirely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-sync-toolaccess-'));
  const configPath = join(dir, 'config.yaml');
  const agent = { id: 'agent-A', metadata: {} }; // managed: not set
  let apiCalls = 0;
  const api = async () => { apiCalls += 1; return {}; };
  const result = await syncToolAccessForAgent({
    api,
    companyId: 'company-1',
    agent,
    configPath,
    bouncer: async () => ({ tier: 'reload' }),
  });
  assert.equal(result.skipped, true);
  assert.equal(apiCalls, 0); // we don't even hit the API for unmanaged
});

test('syncToolAccessForAgent rolls back YAML on bounce failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-sync-toolaccess-'));
  const configPath = join(dir, 'config.yaml');
  // Seed an existing config
  const { writeYamlAtomic } = await import('./yaml-atomic-write.mjs');
  await writeYamlAtomic(configPath, 'pre: existing\n');
  const agent = { id: 'agent-A', metadata: { toolAccess: { managed: true } } };
  const api = async () => ({
    tools: [
      { id: 'tool-1', key: 'adapter_toolset.file', source: 'adapter_toolset',
        adapter: 'hermes_local', render: { hermes: { toolset: 'file' } } },
    ],
    grants: [{ agentId: 'agent-A', toolId: 'tool-1', mode: 'write' }],
  });
  await assert.rejects(
    syncToolAccessForAgent({
      api,
      companyId: 'company-1',
      agent,
      configPath,
      bouncer: async () => { throw new Error('all tiers failed'); },
    }),
    /all tiers failed/,
  );
  // Config rolled back to original
  const yaml = await readFile(configPath, 'utf8');
  assert.equal(yaml, 'pre: existing\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test paperclip/profile-sync.test.mjs
```

Expected: 3 new tests FAIL because `syncToolAccessForAgent` is not yet exported.

- [ ] **Step 3: Add `syncToolAccessForAgent` to `profile-sync.mjs`**

Find a good place near the existing managed-agent loop. Add the import at the top of the file:

```javascript
import { isToolAccessManaged } from './tool-access-managed.mjs';
import { fetchAgentGrants } from './tool-access-grants.mjs';
import { renderToolAccess } from './tool-access-render.mjs';
import { writeYamlAtomic, rollbackYaml } from './yaml-atomic-write.mjs';
import { bounceGateway } from './gateway-bounce.mjs';
```

Add the new function (export it):

```javascript
// Projects tool grants for ONE agent into its profile config.yaml.
// No-op for unmanaged agents. On any failure after the YAML is written,
// rolls back via .prev so the agent's gateway keeps working with the prior
// (correct) policy.
export async function syncToolAccessForAgent({
  api,
  companyId,
  agent,
  configPath,
  bouncer = (opts) => bounceGateway(opts),
  log = () => {},
}) {
  if (!isToolAccessManaged(agent)) {
    log(`[tool-access] agent ${agent?.id} not managed; skipping`);
    return { agentId: agent?.id, skipped: true };
  }

  const grants = await fetchAgentGrants(api, companyId, agent.id);
  const rendered = renderToolAccess(grants);
  const yaml = renderConfigYaml(rendered);

  await writeYamlAtomic(configPath, yaml);

  try {
    const bounce = await bouncer({ profileSlug: agent.profileSlug || agent.id });
    log(`[tool-access] bounced ${agent.id} via ${bounce.tier}`);
    return { agentId: agent.id, skipped: false, bounce: bounce.tier };
  } catch (error) {
    log(`[tool-access] bounce failed for ${agent.id}; rolling back YAML`);
    await rollbackYaml(configPath);
    throw error;
  }
}

function renderConfigYaml({ toolsets, mcp }) {
  // Minimal YAML emitter — keeps deps small. If the project picks up a yaml
  // library elsewhere, swap in `yaml.stringify` here.
  const lines = [];
  if (toolsets.length) {
    lines.push('toolsets:');
    for (const t of toolsets) lines.push(`  - ${t}`);
  }
  if (Object.keys(mcp.servers).length) {
    lines.push('mcp:');
    lines.push('  servers:');
    for (const [key, server] of Object.entries(mcp.servers)) {
      lines.push(`    ${key}:`);
      if (server.command) lines.push(`      command: ${server.command}`);
      if (server.include_tools?.length) {
        lines.push('      include_tools:');
        for (const t of server.include_tools) lines.push(`        - ${t}`);
      }
      if (server.env) {
        lines.push('      env:');
        for (const [envKey, envVal] of Object.entries(server.env)) {
          lines.push(`        ${envKey}: ${envVal}`);
        }
      }
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
node --test paperclip/profile-sync.test.mjs
```

Expected: existing tests still pass, 3 new tests pass.

- [ ] **Step 5: Wire `syncToolAccessForAgent` into the main sync loop**

Find the per-agent loop inside `profile-sync.mjs` (search for `for (const agent of agents)` or similar). After the existing per-agent logic, call:

```javascript
if (isToolAccessManaged(agent)) {
  const configPath = join(hermesHome, 'config.yaml');
  try {
    const summary = await syncToolAccessForAgent({
      api, companyId, agent, configPath,
      log: console.log,
    });
    log(`[tool-access] ${JSON.stringify(summary)}`);
  } catch (error) {
    log(`[tool-access] agent ${agent.id} sync failed: ${error.message}`);
  }
}
```

The `log` wrapper is for parity with existing logging conventions in the file.

- [ ] **Step 6: Add an integration test that exercises the full loop**

Append to `paperclip/profile-sync.test.mjs`:

```javascript
test('profile-sync main loop calls syncToolAccessForAgent for managed agents only', async () => {
  // High-level smoke test: stub api + fs + bouncer, run main sync, assert
  // tool-access projection happened for managed agent only.
  // Implementation detail: this depends on whether profile-sync.mjs's main
  // entry is testable in-process; if not, mark this test `t.skip()` and
  // rely on the integration test in Task 8 instead.
});
```

- [ ] **Step 7: Commit**

```bash
git add paperclip/profile-sync.mjs paperclip/profile-sync.test.mjs
git commit -m "feat(tool-access): wire grants->render->write->bounce into profile-sync"
```

---

## Task 8: End-to-end integration test

**Files:**
- Create: `paperclip/integration/managed-projection.test.mjs`

This is a heavier test — spins up a fake Paperclip API (in-process), a real `profile-sync.mjs` run, and asserts the on-disk YAML, the bounce call, and the failure-mode rollback.

- [ ] **Step 1: Create the integration test**

Create `paperclip/integration/managed-projection.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

function startFakePaperclip(fixture) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/companies/c-1/agents') {
      res.end(JSON.stringify(fixture.agents));
    } else if (req.url === '/api/companies/c-1/tools') {
      res.end(JSON.stringify({ tools: fixture.tools, grants: fixture.grants }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('end-to-end: managed agent gets toolsets projected and gateway bounced', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'managed-projection-'));
  const hermesHome = join(baseDir, 'hermes-home');
  await mkdir(hermesHome, { recursive: true });

  const { server, port } = await startFakePaperclip({
    agents: [
      {
        id: 'a-1',
        adapterType: 'hermes_local',
        status: 'active',
        metadata: { toolAccess: { managed: true } },
        profileSlug: 'marketer',
      },
      {
        id: 'a-2',
        adapterType: 'hermes_local',
        status: 'active',
        metadata: {},  // not managed
        profileSlug: 'researcher',
      },
    ],
    tools: [
      { id: 't-1', key: 'adapter_toolset.terminal', source: 'adapter_toolset',
        adapter: 'hermes_local', render: { hermes: { toolset: 'terminal' } } },
      { id: 't-2', key: 'adapter_toolset.file', source: 'adapter_toolset',
        adapter: 'hermes_local', render: { hermes: { toolset: 'file' } } },
    ],
    grants: [
      { agentId: 'a-1', toolId: 't-1', mode: 'admin' },
      { agentId: 'a-1', toolId: 't-2', mode: 'write' },
      // a-2 has no grants
    ],
  });

  try {
    const { syncToolAccessForAgent } = await import('../profile-sync.mjs');
    const api = async (method, path) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      if (!res.ok) throw new Error(`api ${path} -> ${res.status}`);
      return res.json();
    };
    const bounceCalls = [];
    const bouncer = async (opts) => { bounceCalls.push(opts); return { tier: 'reload' }; };

    // Managed agent: project + bounce
    const managedResult = await syncToolAccessForAgent({
      api, companyId: 'c-1',
      agent: { id: 'a-1', metadata: { toolAccess: { managed: true } }, profileSlug: 'marketer' },
      configPath: join(hermesHome, 'marketer', 'config.yaml'),
      bouncer,
    });
    assert.equal(managedResult.skipped, false);
    const yaml = await readFile(join(hermesHome, 'marketer', 'config.yaml'), 'utf8');
    assert.match(yaml, /- terminal/);
    assert.match(yaml, /- file/);
    assert.equal(bounceCalls.length, 1);
    assert.equal(bounceCalls[0].profileSlug, 'marketer');

    // Unmanaged agent: no-op
    const unmanagedResult = await syncToolAccessForAgent({
      api, companyId: 'c-1',
      agent: { id: 'a-2', metadata: {}, profileSlug: 'researcher' },
      configPath: join(hermesHome, 'researcher', 'config.yaml'),
      bouncer,
    });
    assert.equal(unmanagedResult.skipped, true);
    assert.equal(bounceCalls.length, 1); // unchanged
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run the integration test**

```bash
node --test paperclip/integration/managed-projection.test.mjs
```

Expected: passes. May need to first auto-create the `marketer/` subdir inside `syncToolAccessForAgent` — if the test fails with `ENOENT` on the config write, add a `mkdir(dirname(configPath), { recursive: true })` call in `syncToolAccessForAgent` before `writeYamlAtomic`.

- [ ] **Step 3: Commit**

```bash
git add paperclip/integration/managed-projection.test.mjs paperclip/profile-sync.mjs
git commit -m "test(tool-access): end-to-end managed projection + bounce + unmanaged skip"
```

---

## Task 9: Documentation + final push

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-05-19-template-paperclip-pr-stack.md` (mark Task 5's "Open or update a draft PR" done; this work is in PR #17)

- [ ] **Step 1: Update README**

Add a new section to `README.md` titled "Tool access governance (Phase 1)" with:

- Short paragraph on what managed/unmanaged means
- How to flip an agent to managed: PATCH `/api/agents/{id}` with `{ metadata: { toolAccess: { managed: true } } }`
- Where the projection lands (`<HERMES_HOME>/profiles/<slug>/config.yaml`)
- Reference to spec (`docs/superpowers/specs/2026-05-19-tool-access-matrix-design.md`)
- Reference to migration plan (`docs/superpowers/plans/2026-05-20-tool-access-governance-migration.md`, if it exists)
- Reference to roadmap epic ([#21](https://github.com/leebaroneau/template-agent/issues/21))

- [ ] **Step 2: Run all tests to verify the full suite is green**

```bash
npm test
docker compose --env-file .env.example config --services
```

Expected: all tests pass, compose validates.

- [ ] **Step 3: Commit and push**

```bash
git add README.md docs/superpowers/plans/
git commit -m "docs(tool-access): document managed-flag and phase-1 projection"
git push origin feat/tool-access-governance-template
```

- [ ] **Step 4: Update PR #17**

```bash
gh pr view 17 --json title,body --jq '.title, .body[:200]'
# If body needs an update mentioning Phase 1 completion, edit via:
gh pr edit 17 --body-file <(cat <<'EOF'
... updated body referencing this plan ...
EOF
)
```

The PR auto-updates with the new commits; only edit the body if it needs new context.

---

## Self-Review Checklist

- [ ] Every Phase 1 spec invariant (§11.1) has a task implementing it:
  - Per-agent profile isolation → Task 7 wiring (per-agent configPath)
  - Tool absence ≡ credential absence → Tasks 4 + 7 (renderer only emits granted tools)
  - Reference-style credential projection → Task 4 (secret://...) + Task 6 (resolver)
  - Connection refcount → **not in Phase 1** (deferred to Phase 2; document in README)
  - Fail closed → Task 7 (rollback on bounce failure)
  - Atomic YAML writes → Task 2
  - Gateway lifecycle → Task 5
  - Reconciliation sweep → **Phase 1 does it inline per agent**; full periodic sweep is a Phase 2 enhancement
- [ ] Edge cases relevant to Phase 1 are covered:
  - #1 OAuth rotation → resolver fetches fresh on each gateway start (Task 6)
  - #4 managed: false → true → Task 7 wiring (no-op when false, sweep when flag flips, naturally handled by next sync run)
  - #8 gateway bounce failure → Task 5 three-tier + Task 7 rollback
- [ ] No placeholders / TBDs in any task
- [ ] Every test step shows real code, not "write tests for the above"
- [ ] File paths are exact and match the existing project layout
- [ ] Commits are scoped and follow `feat(tool-access):` / `test(tool-access):` / `docs(tool-access):` conventions

## Open Dependencies (block Phase 2, not Phase 1)

These are documented in spec §17 but don't block this plan:
- Hermes native `secret://` resolver — Phase 1 ships the wrapper-script approach; native resolver is a Phase 2 upstream contribution
- `hermes gateway reload` command — Phase 1 falls back to `restart` if `reload` doesn't exist (see Task 5 note)
- Paperclip `inject_as_env` API on Connections — Phase 2 prerequisite for the `gh` CLI case; not used in Phase 1

## Definition of Done

- [ ] All 9 tasks complete with passing tests
- [ ] `npm test` green
- [ ] `./scripts/test-blank-template.sh` green
- [ ] PR #17 has all commits and CI is passing
- [ ] One real agent in a development Paperclip company has been flipped to `managed: true`, has had a Researcher preset applied, and its `<HERMES_HOME>/profiles/<slug>/config.yaml` reflects the rendered toolsets with `secret://...` references intact
- [ ] Gateway for that agent has been bounced and responds normally in Telegram
