# Paperclip Tool Access Governance PR3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audit detail, optional approval gates, and role presets for tool access changes.

**Architecture:** Build on the PR 2 tool catalog and grant model. Access changes log per-grant activity events with before and after modes. Company policy decides whether risky increases require approval. Presets are named bundles that create normal per-agent grants.

**Tech Stack:** TypeScript, Drizzle, Express routes, approval service, activity log, React.

---

## Scope

This PR depends on PR 2. It does not change Hermes rendering semantics. It only makes tool access safer and faster to manage.

## Files

- Create: `packages/db/src/schema/tool_access_governance.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/shared/src/types/tool-access.ts`
- Modify: `packages/shared/src/validators/tool-access.ts`
- Modify: `server/src/services/tool-access.ts`
- Modify: `server/src/services/approvals.ts`
- Modify: `server/src/routes/tool-access.ts`
- Modify: `ui/src/pages/CompanyTools.tsx`
- Create: `server/src/__tests__/tool-access-governance.test.ts`
- Modify: `ui/src/pages/CompanyTools.test.tsx`

## Task 1: Add Governance Schema

**Files:**
- Create: `packages/db/src/schema/tool_access_governance.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Add schema**

Create `packages/db/src/schema/tool_access_governance.ts`:

```ts
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const toolAccessPolicies = pgTable(
  "tool_access_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    approvalRequiredAtRisk: text("approval_required_at_risk"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("tool_access_policies_company_idx").on(table.companyId),
  }),
);

export const toolAccessPresets = pgTable(
  "tool_access_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    grants: jsonb("grants").$type<Array<{ toolKey: string; mode: string }>>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeyUniqueIdx: uniqueIndex("tool_access_presets_company_key_idx").on(table.companyId, table.key),
    companyIdx: index("tool_access_presets_company_idx").on(table.companyId),
  }),
);
```

- [ ] **Step 2: Export schema**

In `packages/db/src/schema/index.ts`, add:

```ts
export { toolAccessPolicies, toolAccessPresets } from "./tool_access_governance.js";
```

- [ ] **Step 3: Generate migration**

Run:

```bash
pnpm db:generate
```

Expected: new migration under `packages/db/src/migrations/`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/tool_access_governance.ts packages/db/src/schema/index.ts packages/db/src/migrations
git commit -m "feat: add tool access governance tables"
```

## Task 2: Add Governance Contracts

**Files:**
- Modify: `packages/shared/src/types/tool-access.ts`
- Modify: `packages/shared/src/validators/tool-access.ts`

- [ ] **Step 1: Extend types**

In `packages/shared/src/types/tool-access.ts`, add:

```ts
export interface ToolAccessPolicy {
  id: string;
  companyId: string;
  approvalRequiredAtRisk: CompanyToolRisk | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolAccessPresetGrant {
  toolKey: string;
  mode: ToolAccessMode;
}

export interface ToolAccessPreset {
  id: string;
  companyId: string;
  key: string;
  label: string;
  grants: ToolAccessPresetGrant[];
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Extend validators**

In `packages/shared/src/validators/tool-access.ts`, add:

```ts
export const toolAccessPolicyUpdateSchema = z.object({
  approvalRequiredAtRisk: companyToolRiskSchema.optional().nullable(),
});

export const toolAccessPresetCreateSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  grants: z.array(z.object({
    toolKey: z.string().trim().min(1),
    mode: toolAccessModeSchema,
  })).default([]),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const applyToolAccessPresetSchema = z.object({
  agentId: z.string().uuid(),
  presetId: z.string().uuid(),
});
```

- [ ] **Step 3: Run shared typecheck**

Run:

```bash
pnpm --filter @paperclipai/shared typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/tool-access.ts packages/shared/src/validators/tool-access.ts
git commit -m "feat: add tool access governance contracts"
```

## Task 3: Add Per-Grant Audit Events

**Files:**
- Modify: `server/src/services/tool-access.ts`
- Modify: `server/src/routes/tool-access.ts`
- Create: `server/src/__tests__/tool-access-governance.test.ts`

- [ ] **Step 1: Write audit test**

Create `server/src/__tests__/tool-access-governance.test.ts` with assertions:

```ts
await request(app).post(`/api/companies/${companyId}/tool-grants`).send({ grants: [{ agentId, toolId, mode: "read" }] }).expect(200);
const activity = await db.select().from(activityLog).where(eq(activityLog.companyId, companyId));
expect(activity.some((event) => event.action === "company.tool_grant_changed")).toBe(true);
expect(activity.find((event) => event.action === "company.tool_grant_changed")?.details).toMatchObject({
  previousMode: "off",
  newMode: "read",
});
```

- [ ] **Step 2: Return previous mode from service**

In `server/src/services/tool-access.ts`, refactor `setGrant` into a local function above `return { ... }`, expose it as `setGrant`, and return both previous and saved grant:

```ts
  async function setGrant(
    companyId: string,
    agentId: string,
    toolId: string,
    mode: ToolAccessMode,
    grantedByUserId: string | null,
  ) {
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
    if (!agent) throw notFound("Agent not found");
    const [tool] = await db.select().from(companyTools).where(and(eq(companyTools.id, toolId), eq(companyTools.companyId, companyId)));
    if (!tool) throw notFound("Tool not found");
    if (!normalizeModes(tool.supportedModes).includes(mode)) {
      throw unprocessable(`Tool ${tool.key} does not support mode ${mode}`);
    }
    const existing = await db.select().from(agentToolGrants)
      .where(and(eq(agentToolGrants.agentId, agentId), eq(agentToolGrants.toolId, toolId)))
      .then((rows) => rows[0] ?? null);
    if (existing) {
      const [updated] = await db.update(agentToolGrants)
        .set({ mode, grantedByUserId, updatedAt: new Date() })
        .where(eq(agentToolGrants.id, existing.id))
        .returning();
      return { previousMode: existing.mode, grant: updated, tool };
    }
    const [created] = await db.insert(agentToolGrants).values({
      companyId,
      agentId,
      toolId,
      mode,
      grantedByUserId,
    }).returning();
    return { previousMode: "off", grant: created, tool };
  }

  return {
    setGrant,
```
```

- [ ] **Step 3: Log per-grant events**

In `server/src/routes/tool-access.ts`, replace the aggregate-only activity log with one event per saved grant:

```ts
for (const result of grantResults) {
  await logActivity(db, {
    companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    action: "company.tool_grant_changed",
    entityType: "company_tool",
    entityId: result.tool.id,
    details: {
      agentId: result.grant.agentId,
      toolKey: result.tool.key,
      previousMode: result.previousMode,
      newMode: result.grant.mode,
      risk: result.tool.risk,
    },
  });
}
```

- [ ] **Step 4: Run test**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/tool-access-governance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/tool-access.ts server/src/routes/tool-access.ts server/src/__tests__/tool-access-governance.test.ts
git commit -m "feat: audit tool access changes"
```

## Task 4: Add Approval Gate Policy

**Files:**
- Modify: `server/src/services/tool-access.ts`
- Modify: `server/src/services/approvals.ts`
- Modify: `server/src/routes/tool-access.ts`
- Modify: `server/src/__tests__/tool-access-governance.test.ts`

- [ ] **Step 1: Add risk comparison helper**

In `server/src/services/tool-access.ts`, add:

```ts
const RISK_RANK = { read: 1, write: 2, admin: 3, secret: 4 } as const;

export function riskMeetsThreshold(risk: string, threshold: string | null | undefined): boolean {
  if (!threshold) return false;
  const riskRank = RISK_RANK[risk as keyof typeof RISK_RANK] ?? 0;
  const thresholdRank = RISK_RANK[threshold as keyof typeof RISK_RANK] ?? 99;
  return riskRank >= thresholdRank;
}
```

- [ ] **Step 2: Add policy methods**

In `toolAccessService`, add:

```ts
    getPolicy: async (companyId: string) => {
      const [policy] = await db.select().from(toolAccessPolicies).where(eq(toolAccessPolicies.companyId, companyId));
      return policy ?? null;
    },

    getTool: async (companyId: string, toolId: string) => {
      const [tool] = await db.select().from(companyTools).where(and(eq(companyTools.companyId, companyId), eq(companyTools.id, toolId)));
      if (!tool) throw notFound("Tool not found");
      return tool;
    },

    upsertPolicy: async (companyId: string, input: { approvalRequiredAtRisk?: string | null }) => {
      const existing = await db.select().from(toolAccessPolicies).where(eq(toolAccessPolicies.companyId, companyId)).then((rows) => rows[0] ?? null);
      if (existing) {
        const [updated] = await db.update(toolAccessPolicies)
          .set({ approvalRequiredAtRisk: input.approvalRequiredAtRisk ?? null, updatedAt: new Date() })
          .where(eq(toolAccessPolicies.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db.insert(toolAccessPolicies).values({
        companyId,
        approvalRequiredAtRisk: input.approvalRequiredAtRisk ?? null,
      }).returning();
      return created;
    },
```

- [ ] **Step 3: Gate risky increases in route**

In `server/src/routes/tool-access.ts`, add:

```ts
import { riskMeetsThreshold } from "../services/tool-access.js";
```

Add `approvalService` to the existing services import. Then in `POST /companies/:companyId/tool-grants`, replace the simple grant-save loop with a policy-aware loop:

```ts
const policy = await svc.getPolicy(companyId);
const approvalSvc = approvalService(db);
const approvals = [];
const grantResults = [];
for (const grant of req.body.grants) {
  const tool = await svc.getTool(companyId, grant.toolId);
  if (policy && riskMeetsThreshold(tool.risk, policy.approvalRequiredAtRisk) && grant.mode !== "off") {
    const approval = await approvalSvc.create(companyId, {
      type: "tool_access_change",
      status: "pending",
      requestedByAgentId: actor.agentId,
      requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      payload: { agentId: grant.agentId, toolId: grant.toolId, mode: grant.mode },
    });
    approvals.push(approval);
    continue;
  }
  grantResults.push(await svc.setGrant(
    companyId,
    grant.agentId,
    grant.toolId,
    grant.mode,
    actor.actorType === "user" ? actor.actorId : null,
  ));
}
res.json({ grants: grantResults.map((result) => result.grant), approvals });
```

- [ ] **Step 4: Apply approved tool-access approvals**

In `server/src/services/approvals.ts`, import the service and type:

```ts
import type { ToolAccessMode } from "@paperclipai/shared";
import { toolAccessService } from "./tool-access.js";
```

Inside `approvalService`, create `const toolAccess = toolAccessService(db);`. In `approve`, after the `hire_agent` block and before returning, add:

```ts
      if (applied && updated.type === "tool_access_change") {
        const payload = updated.payload as Record<string, unknown>;
        const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
        const toolId = typeof payload.toolId === "string" ? payload.toolId : null;
        const mode = typeof payload.mode === "string" ? payload.mode : null;
        if (!agentId || !toolId || !mode) throw unprocessable("Invalid tool access change payload");
        await toolAccess.setGrant(
          updated.companyId,
          agentId,
          toolId,
          mode as ToolAccessMode,
          updated.requestedByUserId ?? null,
        );
      }
```

- [ ] **Step 5: Add policy routes**

Add:

```ts
router.get("/companies/:companyId/tool-access-policy", async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  res.json(await svc.getPolicy(companyId));
});

router.patch("/companies/:companyId/tool-access-policy", validate(toolAccessPolicyUpdateSchema), async (req, res) => {
  const companyId = req.params.companyId as string;
  await assertCanManage(req, companyId);
  res.json(await svc.upsertPolicy(companyId, req.body));
});
```

- [ ] **Step 6: Run governance tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/tool-access-governance.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/tool-access.ts server/src/services/approvals.ts server/src/routes/tool-access.ts server/src/__tests__/tool-access-governance.test.ts
git commit -m "feat: gate risky tool access changes"
```

## Task 5: Add Presets

**Files:**
- Modify: `server/src/services/tool-access.ts`
- Modify: `server/src/routes/tool-access.ts`
- Modify: `ui/src/pages/CompanyTools.tsx`
- Modify: `ui/src/pages/CompanyTools.test.tsx`

- [ ] **Step 1: Add service methods**

In `toolAccessService`, add:

```ts
    listPresets: async (companyId: string) =>
      db.select().from(toolAccessPresets).where(eq(toolAccessPresets.companyId, companyId)).orderBy(asc(toolAccessPresets.label)),

    createPreset: async (companyId: string, input: Omit<typeof toolAccessPresets.$inferInsert, "companyId">) => {
      const [created] = await db.insert(toolAccessPresets).values({ ...input, companyId }).returning();
      return created;
    },

    applyPreset: async (companyId: string, agentId: string, presetId: string, grantedByUserId: string | null) => {
      const [preset] = await db.select().from(toolAccessPresets).where(and(eq(toolAccessPresets.companyId, companyId), eq(toolAccessPresets.id, presetId)));
      if (!preset) throw notFound("Preset not found");
      const tools = await db.select().from(companyTools).where(eq(companyTools.companyId, companyId));
      const byKey = new Map(tools.map((tool) => [tool.key, tool]));
      const results = [];
      for (const item of preset.grants) {
        const tool = byKey.get(item.toolKey);
        if (!tool) continue;
        results.push(await setGrant(companyId, agentId, tool.id, item.mode as ToolAccessMode, grantedByUserId));
      }
      return results;
    },
```

- [ ] **Step 2: Add routes**

Add to `server/src/routes/tool-access.ts`:

```ts
router.get("/companies/:companyId/tool-presets", async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  res.json(await svc.listPresets(companyId));
});

router.post("/companies/:companyId/tool-presets", validate(toolAccessPresetCreateSchema), async (req, res) => {
  const companyId = req.params.companyId as string;
  await assertCanManage(req, companyId);
  res.status(201).json(await svc.createPreset(companyId, req.body));
});

router.post("/companies/:companyId/tool-presets/apply", validate(applyToolAccessPresetSchema), async (req, res) => {
  const companyId = req.params.companyId as string;
  await assertCanManage(req, companyId);
  const actor = getActorInfo(req);
  const results = await svc.applyPreset(
    companyId,
    req.body.agentId,
    req.body.presetId,
    actor.actorType === "user" ? actor.actorId : null,
  );
  res.json({ grants: results.map((result) => result.grant) });
});
```

- [ ] **Step 3: Add UI affordance**

In `CompanyTools.tsx`, add a compact preset selector above the matrix:

```tsx
<div className="flex items-center gap-2">
  <select className="rounded-md border border-border bg-background px-2 py-1">
    <option value="">Apply preset...</option>
    {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
  </select>
  <span className="text-xs text-muted-foreground">Presets apply normal grants that can still be edited.</span>
</div>
```

Wire it to `toolAccessApi.applyPreset(companyId, { agentId, presetId })` using the selected agent from a second select.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/tool-access-governance.test.ts
pnpm --filter @paperclipai/ui exec vitest run src/pages/CompanyTools.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/tool-access.ts server/src/routes/tool-access.ts ui/src/pages/CompanyTools.tsx ui/src/pages/CompanyTools.test.tsx
git commit -m "feat: add tool access presets"
```

## Task 6: Final Verification

- [ ] **Step 1: Run targeted tests**

```bash
pnpm --filter @paperclipai/server exec vitest run \
  src/__tests__/tool-access-service.test.ts \
  src/__tests__/tool-access-routes.test.ts \
  src/__tests__/tool-access-governance.test.ts
pnpm --filter @paperclipai/ui exec vitest run src/pages/CompanyTools.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typechecks**

```bash
pnpm --filter @paperclipai/db typecheck
pnpm --filter @paperclipai/shared typecheck
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/ui typecheck
```

Expected: PASS.

- [ ] **Step 3: Prepare PR body**

Use `.github/PULL_REQUEST_TEMPLATE.md`. Include the risk gate behavior and how to test a preset application manually.
