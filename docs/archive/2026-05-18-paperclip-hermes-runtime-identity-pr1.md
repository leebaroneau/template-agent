# Paperclip Hermes Runtime Identity PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable Paperclip-managed Hermes profile for every `hermes_local` agent.

**Architecture:** Extend the server adapter contract with an optional runtime identity hook. Paperclip calls the hook after agent creation and adapter-type/config updates; the Hermes registration implements the hook by creating a profile directory under the Paperclip instance root, then patching the agent's adapter env and metadata.

**Tech Stack:** TypeScript, Express, Drizzle, Vitest, Paperclip adapter registry, Hermes local adapter.

---

## Scope

This PR intentionally does not add the tool access dashboard. It only makes runtime identity durable enough for PR 2 to render tool policy into the right Hermes profile.

## Files

- Modify: `packages/adapter-utils/src/types.ts`
- Modify: `packages/adapter-utils/src/index.ts`
- Create: `server/src/adapters/hermes-runtime-identity.ts`
- Modify: `server/src/adapters/registry.ts`
- Modify: `server/src/routes/agents.ts`
- Modify: `packages/shared/src/types/agent.ts`
- Create: `server/src/__tests__/hermes-runtime-identity.test.ts`
- Modify: `server/src/__tests__/adapter-registry.test.ts`
- Modify: `docs/adapters/creating-an-adapter.md`

## Task 1: Add Runtime Identity Types

**Files:**
- Modify: `packages/adapter-utils/src/types.ts`
- Modify: `packages/adapter-utils/src/index.ts`

- [ ] **Step 1: Add the failing type-level test mentally before editing**

Expected contract:

```ts
const adapter: ServerAdapterModule = {
  type: "test",
  execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
  testEnvironment: async () => ({ adapterType: "test", status: "pass", checks: [], testedAt: new Date().toISOString() }),
  ensureRuntimeIdentity: async (ctx) => ({
    adapterConfig: ctx.adapterConfig,
    metadata: ctx.metadata,
    detail: { ok: true },
  }),
};
```

- [ ] **Step 2: Extend `packages/adapter-utils/src/types.ts`**

Add these interfaces after `HireApprovedHookResult`:

```ts
export interface AdapterRuntimeIdentityContext {
  companyId: string;
  companyName: string;
  agentId: string;
  agentName: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

export interface AdapterRuntimeIdentityResult {
  adapterConfig: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  detail?: Record<string, unknown>;
  warnings?: string[];
}
```

Then add this optional hook to `ServerAdapterModule`:

```ts
  /**
   * Optional lifecycle hook that gives an adapter one stable runtime identity
   * per Paperclip agent. The hook must be idempotent.
   */
  ensureRuntimeIdentity?: (
    ctx: AdapterRuntimeIdentityContext,
  ) => Promise<AdapterRuntimeIdentityResult>;
```

- [ ] **Step 3: Export the new types from `packages/adapter-utils/src/index.ts`**

Add the two names to the existing type export block:

```ts
  AdapterRuntimeIdentityContext,
  AdapterRuntimeIdentityResult,
```

- [ ] **Step 4: Run a targeted typecheck**

Run:

```bash
pnpm --filter @paperclipai/adapter-utils typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-utils/src/types.ts packages/adapter-utils/src/index.ts
git commit -m "feat: add adapter runtime identity hook"
```

## Task 2: Implement Hermes Runtime Identity

**Files:**
- Create: `server/src/adapters/hermes-runtime-identity.ts`
- Create: `server/src/__tests__/hermes-runtime-identity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/__tests__/hermes-runtime-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureHermesRuntimeIdentity,
  deriveHermesProfileSlug,
} from "../adapters/hermes-runtime-identity.js";

describe("Hermes runtime identity", () => {
  it("derives a safe stable profile slug", () => {
    expect(deriveHermesProfileSlug({
      companyName: "Acme, Inc.",
      agentName: "Head of Sales",
      existingSlug: null,
    })).toBe("acme-inc-head-of-sales");
  });

  it("reuses an existing managed profile slug", () => {
    expect(deriveHermesProfileSlug({
      companyName: "Renamed Company",
      agentName: "Renamed Agent",
      existingSlug: "acme-inc-head-of-sales",
    })).toBe("acme-inc-head-of-sales");
  });

  it("creates a profile home and patches adapter env plus metadata", async () => {
    const instanceRoot = await mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-profile-"));
    const result = await ensureHermesRuntimeIdentity({
      companyId: "company-1",
      companyName: "Acme",
      agentId: "agent-1",
      agentName: "Reviewer",
      adapterType: "hermes_local",
      adapterConfig: { env: { EXISTING: "1" } },
      metadata: null,
      instanceRoot,
      now: "2026-05-18T00:00:00.000Z",
    });

    const identity = result.metadata?.runtimeIdentity as Record<string, unknown>;
    expect(identity.profileSlug).toBe("acme-reviewer");
    expect(identity.adapter).toBe("hermes_local");
    expect(result.adapterConfig.env).toMatchObject({
      EXISTING: "1",
      HERMES_HOME: path.join(instanceRoot, "runtimes", "hermes", "profiles", "acme-reviewer"),
    });
    await expect(stat(path.join(instanceRoot, "runtimes", "hermes", "profiles", "acme-reviewer"))).resolves.toBeTruthy();
    await expect(readFile(path.join(instanceRoot, "runtimes", "hermes", "profiles", "acme-reviewer", "config.yaml"), "utf8"))
      .resolves.toContain("dashboard:");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/hermes-runtime-identity.test.ts
```

Expected: FAIL because `server/src/adapters/hermes-runtime-identity.ts` does not exist.

- [ ] **Step 3: Add implementation**

Create `server/src/adapters/hermes-runtime-identity.ts`:

```ts
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterRuntimeIdentityContext,
  AdapterRuntimeIdentityResult,
} from "@paperclipai/adapter-utils";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";

const MANAGED_BY = "paperclip.hermes_local.runtime_identity.v1";
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugPart(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || "unnamed";
}

function safeExistingSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_SLUG_RE.test(trimmed) ? trimmed : null;
}

export function deriveHermesProfileSlug(input: {
  companyName: string;
  agentName: string;
  existingSlug: unknown;
}): string {
  const existing = safeExistingSlug(input.existingSlug);
  if (existing) return existing;
  const combined = `${slugPart(input.companyName)}-${slugPart(input.agentName)}`;
  if (combined.length <= 96) return combined;
  const digest = createHash("sha1").update(combined).digest("hex").slice(0, 8);
  return `${combined.slice(0, 87).replace(/-+$/g, "")}-${digest}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureHermesRuntimeIdentity(
  ctx: AdapterRuntimeIdentityContext & {
    instanceRoot?: string;
    now?: string;
  },
): Promise<AdapterRuntimeIdentityResult> {
  const metadata = isRecord(ctx.metadata) ? { ...ctx.metadata } : {};
  const previousIdentity = isRecord(metadata.runtimeIdentity)
    ? metadata.runtimeIdentity
    : {};
  const profileSlug = deriveHermesProfileSlug({
    companyName: ctx.companyName,
    agentName: ctx.agentName,
    existingSlug: previousIdentity.profileSlug,
  });
  const instanceRoot = ctx.instanceRoot ?? resolvePaperclipInstanceRoot();
  const hermesHome = path.join(instanceRoot, "runtimes", "hermes", "profiles", profileSlug);
  await mkdir(hermesHome, { recursive: true });

  const configPath = path.join(hermesHome, "config.yaml");
  if (!(await exists(configPath))) {
    await writeFile(configPath, [
      "dashboard:",
      "  show_token_analytics: true",
      "",
    ].join("\n"));
  }

  const adapterEnv = isRecord(ctx.adapterConfig.env)
    ? { ...ctx.adapterConfig.env }
    : {};
  const adapterConfig = {
    ...ctx.adapterConfig,
    env: {
      ...adapterEnv,
      HERMES_HOME: hermesHome,
    },
  };

  return {
    adapterConfig,
    metadata: {
      ...metadata,
      runtimeIdentity: {
        ...previousIdentity,
        adapter: "hermes_local",
        profileSlug,
        hermesHome,
        managedBy: MANAGED_BY,
        createdAt: typeof previousIdentity.createdAt === "string"
          ? previousIdentity.createdAt
          : ctx.now ?? new Date().toISOString(),
      },
    },
    detail: { profileSlug, hermesHome },
  };
}
```

- [ ] **Step 4: Run the tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/hermes-runtime-identity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/adapters/hermes-runtime-identity.ts server/src/__tests__/hermes-runtime-identity.test.ts
git commit -m "feat: create managed Hermes runtime identities"
```

## Task 3: Register the Hermes Hook

**Files:**
- Modify: `server/src/adapters/registry.ts`
- Modify: `server/src/__tests__/adapter-registry.test.ts`

- [ ] **Step 1: Add a failing registry assertion**

In `server/src/__tests__/adapter-registry.test.ts`, add:

```ts
import { findServerAdapter } from "../adapters/index.js";

it("registers Hermes runtime identity support", () => {
  const adapter = findServerAdapter("hermes_local");
  expect(adapter?.ensureRuntimeIdentity).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/adapter-registry.test.ts
```

Expected: FAIL because `ensureRuntimeIdentity` is not registered.

- [ ] **Step 3: Wire the hook into the Hermes adapter registration**

In `server/src/adapters/registry.ts`, add:

```ts
import { ensureHermesRuntimeIdentity } from "./hermes-runtime-identity.js";
```

Then add this property to `hermesLocalAdapter`:

```ts
  ensureRuntimeIdentity: ensureHermesRuntimeIdentity,
```

- [ ] **Step 4: Run the registry test**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/adapter-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/adapters/registry.ts server/src/__tests__/adapter-registry.test.ts
git commit -m "feat: register Hermes runtime identity hook"
```

## Task 4: Invoke Runtime Identity During Agent Create And Update

**Files:**
- Modify: `server/src/routes/agents.ts`
- Test: existing route tests or create `server/src/__tests__/hermes-agent-runtime-identity-routes.test.ts`

- [ ] **Step 1: Write route tests**

Create `server/src/__tests__/hermes-agent-runtime-identity-routes.test.ts` using the local test helper style already used in server route tests. The assertions must cover:

```ts
expect(created.adapterConfig.env.HERMES_HOME).toContain("/runtimes/hermes/profiles/");
expect(created.metadata.runtimeIdentity.profileSlug).toBe("acme-reviewer");
```

Also cover update from another adapter to `hermes_local`:

```ts
expect(updated.adapterConfig.env.HERMES_HOME).toContain("/runtimes/hermes/profiles/");
expect(updated.metadata.runtimeIdentity.adapter).toBe("hermes_local");
```

- [ ] **Step 2: Run the failing route tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/hermes-agent-runtime-identity-routes.test.ts
```

Expected: FAIL because routes do not call the hook.

- [ ] **Step 3: Add a route helper**

In `server/src/routes/agents.ts`, near other helper functions inside `agentRoutes`, add:

```ts
  async function ensureAdapterRuntimeIdentityForAgent(
    agent: NonNullable<Awaited<ReturnType<typeof svc.getById>>>,
    source: string,
  ) {
    const adapter = findActiveServerAdapter(agent.adapterType);
    if (!adapter?.ensureRuntimeIdentity) return agent;

    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, agent.companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) return agent;

    const result = await adapter.ensureRuntimeIdentity({
      companyId: agent.companyId,
      companyName: company.name,
      agentId: agent.id,
      agentName: agent.name,
      adapterType: agent.adapterType,
      adapterConfig: asRecord(agent.adapterConfig) ?? {},
      metadata: asRecord(agent.metadata),
    });

    const normalizedAdapterConfig = await normalizeMediatedAdapterConfigForPersistence({
      companyId: agent.companyId,
      adapterType: agent.adapterType,
      adapterConfig: result.adapterConfig,
    });

    const updated = await svc.update(
      agent.id,
      {
        adapterConfig: normalizedAdapterConfig,
        metadata: result.metadata,
      },
      {
        recordRevision: {
          createdByAgentId: null,
          createdByUserId: null,
          source,
        },
      },
    );
    return updated ?? agent;
  }
```

- [ ] **Step 4: Call the helper after agent creation**

In `POST /companies/:companyId/agents`, replace:

```ts
    const agent = await materializeDefaultInstructionsBundleForNewAgent(createdAgent, instructionsBundle);
```

with:

```ts
    const bundledAgent = await materializeDefaultInstructionsBundleForNewAgent(createdAgent, instructionsBundle);
    const agent = await ensureAdapterRuntimeIdentityForAgent(
      bundledAgent,
      "adapter_runtime_identity_create",
    );
```

- [ ] **Step 5: Call the helper after adapter changes**

In `PATCH /agents/:id`, after `svc.update(...)` returns an agent and before returning JSON, add:

```ts
    const agentWithRuntimeIdentity = touchesAdapterConfiguration
      ? await ensureAdapterRuntimeIdentityForAgent(agent, "adapter_runtime_identity_update")
      : agent;
```

Return `agentWithRuntimeIdentity`.

- [ ] **Step 6: Run the route tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/hermes-agent-runtime-identity-routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/agents.ts server/src/__tests__/hermes-agent-runtime-identity-routes.test.ts
git commit -m "feat: reconcile runtime identity for Hermes agents"
```

## Task 5: Surface Runtime Identity In Shared Types And Docs

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `docs/adapters/creating-an-adapter.md`

- [ ] **Step 1: Add shared runtime identity types**

In `packages/shared/src/types/agent.ts`, add:

```ts
export interface AgentRuntimeIdentity {
  adapter: string;
  profileSlug?: string;
  hermesHome?: string;
  managedBy?: string;
  createdAt?: string;
}
```

Then change the metadata field to remain backward compatible while documenting the new shape:

```ts
  metadata: (Record<string, unknown> & { runtimeIdentity?: AgentRuntimeIdentity }) | null;
```

- [ ] **Step 2: Add adapter docs**

In `docs/adapters/creating-an-adapter.md`, add a section:

```md
## Runtime identity hooks

Adapters that need one durable runtime profile per Paperclip agent can implement `ensureRuntimeIdentity`.

The hook runs after Paperclip creates an agent and after adapter type/config changes. It must be idempotent. Return the adapter config and metadata Paperclip should persist. Do not delete runtime state from this hook.
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @paperclipai/shared typecheck
pnpm --filter @paperclipai/server typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/agent.ts docs/adapters/creating-an-adapter.md
git commit -m "docs: document adapter runtime identity"
```

## Task 6: Final Verification

**Files:**
- Verify all files changed in this PR.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run \
  src/__tests__/hermes-runtime-identity.test.ts \
  src/__tests__/hermes-agent-runtime-identity-routes.test.ts \
  src/__tests__/adapter-registry.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package typechecks**

Run:

```bash
pnpm --filter @paperclipai/adapter-utils typecheck
pnpm --filter @paperclipai/shared typecheck
pnpm --filter @paperclipai/server typecheck
```

Expected: PASS.

- [ ] **Step 3: Prepare PR body from template**

Read `.github/PULL_REQUEST_TEMPLATE.md` and fill every section. The verification section must include the exact commands above.

- [ ] **Step 4: Commit any final fixes**

```bash
git status --short
git add packages/adapter-utils/src/types.ts packages/adapter-utils/src/index.ts server/src/adapters/hermes-runtime-identity.ts server/src/adapters/registry.ts server/src/routes/agents.ts packages/shared/src/types/agent.ts server/src/__tests__/hermes-runtime-identity.test.ts server/src/__tests__/hermes-agent-runtime-identity-routes.test.ts server/src/__tests__/adapter-registry.test.ts docs/adapters/creating-an-adapter.md
git commit -m "test: cover Hermes runtime identity lifecycle"
```

Only run this commit if final fixes were required.
