# Paperclip Tool Access Matrix PR2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a company-level tool catalog and per-agent access matrix that renders grants into `hermes_local` agent configuration.

**Architecture:** Store available tools in a company-scoped catalog table and store grants in a company-scoped agent grant table. Server routes expose catalog and grant management. A Hermes renderer converts grants into adapter config fields that Hermes can consume on the next run, with profile file rendering reserved for the runtime identity layer.

**Tech Stack:** TypeScript, Drizzle, Express routes, React, TanStack Query, Vitest.

---

## Scope

This PR depends on PR 1. It assumes each `hermes_local` agent has `metadata.runtimeIdentity` and an adapter env with `HERMES_HOME`.

The first version uses manual catalog entries and seeded Hermes defaults. MCP discovery is deliberately out of scope.

## Files

- Create: `packages/db/src/schema/company_tools.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/shared/src/types/tool-access.ts`
- Create: `packages/shared/src/validators/tool-access.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/validators/index.ts`
- Create: `server/src/services/tool-access.ts`
- Modify: `server/src/services/index.ts`
- Create: `server/src/routes/tool-access.ts`
- Modify: `server/src/routes/index.ts`
- Modify: `server/src/app.ts`
- Create: `ui/src/api/tool-access.ts`
- Modify: `ui/src/api/queryKeys.ts`
- Create: `ui/src/pages/CompanyTools.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/CompanySettingsSidebar.tsx`
- Create: `server/src/__tests__/tool-access-service.test.ts`
- Create: `server/src/__tests__/tool-access-routes.test.ts`
- Create: `ui/src/pages/CompanyTools.test.tsx`

## Task 1: Add Tool Access Schema

**Files:**
- Create: `packages/db/src/schema/company_tools.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write schema file**

Create `packages/db/src/schema/company_tools.ts`:

```ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const companyTools = pgTable(
  "company_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    source: text("source").notNull(),
    adapter: text("adapter").notNull(),
    serverKey: text("server_key"),
    toolName: text("tool_name"),
    risk: text("risk").notNull().default("read"),
    supportedModes: jsonb("supported_modes").$type<string[]>().notNull().default(["off", "read"]),
    render: jsonb("render").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeyUniqueIdx: uniqueIndex("company_tools_company_key_idx").on(table.companyId, table.key),
    companySourceIdx: index("company_tools_company_source_idx").on(table.companyId, table.source),
  }),
);

export const agentToolGrants = pgTable(
  "agent_tool_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    toolId: uuid("tool_id").notNull().references(() => companyTools.id),
    mode: text("mode").notNull().default("off"),
    grantedByUserId: text("granted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentToolUniqueIdx: uniqueIndex("agent_tool_grants_agent_tool_idx").on(table.agentId, table.toolId),
    companyAgentIdx: index("agent_tool_grants_company_agent_idx").on(table.companyId, table.agentId),
  }),
);
```

- [ ] **Step 2: Export schema**

In `packages/db/src/schema/index.ts`, add:

```ts
export { companyTools, agentToolGrants } from "./company_tools.js";
```

- [ ] **Step 3: Generate migration**

Run:

```bash
pnpm db:generate
```

Expected: a new migration file under `packages/db/src/migrations/`.

- [ ] **Step 4: Run db typecheck**

Run:

```bash
pnpm --filter @paperclipai/db typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/company_tools.ts packages/db/src/schema/index.ts packages/db/src/migrations
git commit -m "feat: add company tool access tables"
```

## Task 2: Add Shared Types And Validators

**Files:**
- Create: `packages/shared/src/types/tool-access.ts`
- Create: `packages/shared/src/validators/tool-access.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/validators/index.ts`

- [ ] **Step 1: Add shared types**

Create `packages/shared/src/types/tool-access.ts`:

```ts
export type CompanyToolSource = "paperclip_builtin" | "adapter_toolset" | "mcp_tool" | "skill";
export type CompanyToolRisk = "read" | "write" | "admin" | "secret";
export type ToolAccessMode = "off" | "read" | "write" | "admin";

export interface CompanyTool {
  id: string;
  companyId: string;
  key: string;
  label: string;
  description: string | null;
  source: CompanyToolSource;
  adapter: string;
  serverKey: string | null;
  toolName: string | null;
  risk: CompanyToolRisk;
  supportedModes: ToolAccessMode[];
  render: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentToolGrant {
  id: string;
  companyId: string;
  agentId: string;
  toolId: string;
  mode: ToolAccessMode;
  grantedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolAccessMatrix {
  tools: CompanyTool[];
  grants: AgentToolGrant[];
}
```

- [ ] **Step 2: Add validators**

Create `packages/shared/src/validators/tool-access.ts`:

```ts
import { z } from "zod";

export const companyToolSourceSchema = z.enum(["paperclip_builtin", "adapter_toolset", "mcp_tool", "skill"]);
export const companyToolRiskSchema = z.enum(["read", "write", "admin", "secret"]);
export const toolAccessModeSchema = z.enum(["off", "read", "write", "admin"]);

export const companyToolCreateSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  source: companyToolSourceSchema,
  adapter: z.string().trim().min(1),
  serverKey: z.string().trim().min(1).optional().nullable(),
  toolName: z.string().trim().min(1).optional().nullable(),
  risk: companyToolRiskSchema.default("read"),
  supportedModes: z.array(toolAccessModeSchema).min(1).default(["off", "read"]),
  render: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).optional().nullable(),
}).superRefine((value, ctx) => {
  if (!value.supportedModes.includes("off")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "supportedModes must include off",
      path: ["supportedModes"],
    });
  }
});

export const companyToolUpdateSchema = companyToolCreateSchema.partial();

export const agentToolGrantSetSchema = z.object({
  agentId: z.string().uuid(),
  toolId: z.string().uuid(),
  mode: toolAccessModeSchema,
});

export const agentToolGrantBulkSetSchema = z.object({
  grants: z.array(agentToolGrantSetSchema),
});
```

- [ ] **Step 3: Export shared modules**

In `packages/shared/src/types/index.ts`, add:

```ts
export * from "./tool-access.js";
```

In `packages/shared/src/validators/index.ts`, add:

```ts
export * from "./tool-access.js";
```

- [ ] **Step 4: Run shared typecheck**

Run:

```bash
pnpm --filter @paperclipai/shared typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/tool-access.ts packages/shared/src/validators/tool-access.ts packages/shared/src/types/index.ts packages/shared/src/validators/index.ts
git commit -m "feat: add tool access shared contract"
```

## Task 3: Add Server Tool Access Service

**Files:**
- Create: `server/src/services/tool-access.ts`
- Modify: `server/src/services/index.ts`
- Create: `server/src/__tests__/tool-access-service.test.ts`

- [ ] **Step 1: Write service tests**

Create `server/src/__tests__/tool-access-service.test.ts` following the embedded database helper style used by nearby service tests. Include these assertions:

```ts
expect(await svc.listMatrix(companyId)).toMatchObject({ tools: [], grants: [] });
expect(created.key).toBe("mcp.gbrain.query");
expect(grant.mode).toBe("read");
await expect(svc.setGrant(companyId, agentId, created.id, "write", null)).rejects.toThrow(/does not support mode/);
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/tool-access-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service**

Create `server/src/services/tool-access.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentToolGrants, agents, companyTools } from "@paperclipai/db";
import type { ToolAccessMode } from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";

function normalizeModes(value: unknown): ToolAccessMode[] {
  const modes = Array.isArray(value) ? value : ["off", "read"];
  return modes.filter((mode): mode is ToolAccessMode =>
    mode === "off" || mode === "read" || mode === "write" || mode === "admin",
  );
}

export function toolAccessService(db: Db) {
  async function listMatrix(companyId: string) {
    const [tools, grants] = await Promise.all([
      db.select().from(companyTools).where(eq(companyTools.companyId, companyId)).orderBy(asc(companyTools.label)),
      db.select().from(agentToolGrants).where(eq(agentToolGrants.companyId, companyId)),
    ]);
    return { tools, grants };
  }

  return {
    listMatrix,

    createTool: async (companyId: string, input: Omit<typeof companyTools.$inferInsert, "companyId">) => {
      const [created] = await db.insert(companyTools).values({ ...input, companyId }).returning();
      return created;
    },

    setGrant: async (
      companyId: string,
      agentId: string,
      toolId: string,
      mode: ToolAccessMode,
      grantedByUserId: string | null,
    ) => {
      const [agent] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
      if (!agent) throw notFound("Agent not found");
      const [tool] = await db.select().from(companyTools).where(and(eq(companyTools.id, toolId), eq(companyTools.companyId, companyId)));
      if (!tool) throw notFound("Tool not found");
      if (!normalizeModes(tool.supportedModes).includes(mode)) {
        throw unprocessable(`Tool ${tool.key} does not support mode ${mode}`);
      }
      const existing = await db
        .select()
        .from(agentToolGrants)
        .where(and(eq(agentToolGrants.agentId, agentId), eq(agentToolGrants.toolId, toolId)))
        .then((rows) => rows[0] ?? null);
      if (existing) {
        const [updated] = await db.update(agentToolGrants)
          .set({ mode, grantedByUserId, updatedAt: new Date() })
          .where(eq(agentToolGrants.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db.insert(agentToolGrants).values({
        companyId,
        agentId,
        toolId,
        mode,
        grantedByUserId,
      }).returning();
      return created;
    },
  };
}
```

- [ ] **Step 4: Export service**

In `server/src/services/index.ts`, add:

```ts
export { toolAccessService } from "./tool-access.js";
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/tool-access-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/tool-access.ts server/src/services/index.ts server/src/__tests__/tool-access-service.test.ts
git commit -m "feat: add tool access service"
```

## Task 4: Add API Routes

**Files:**
- Create: `server/src/routes/tool-access.ts`
- Modify: `server/src/routes/index.ts`
- Modify: `server/src/app.ts`
- Create: `server/src/__tests__/tool-access-routes.test.ts`

- [ ] **Step 1: Write route tests**

Create `server/src/__tests__/tool-access-routes.test.ts` with assertions:

```ts
await request(app).get(`/api/companies/${companyId}/tools`).expect(200);
await request(app).post(`/api/companies/${companyId}/tools`).send({ key: "mcp.gbrain.query", label: "GBrain query", source: "mcp_tool", adapter: "hermes_local", serverKey: "gbrain", toolName: "query", risk: "read", supportedModes: ["off", "read"] }).expect(201);
await request(app).post(`/api/companies/${companyId}/tool-grants`).send({ grants: [{ agentId, toolId, mode: "read" }] }).expect(200);
```

- [ ] **Step 2: Add routes**

Create `server/src/routes/tool-access.ts`:

```ts
import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  agentToolGrantBulkSetSchema,
  companyToolCreateSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { accessService, logActivity, toolAccessService } from "../services/index.js";
import { forbidden } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function toolAccessRoutes(db: Db) {
  const router = Router();
  const svc = toolAccessService(db);
  const access = accessService(db);

  async function assertCanManage(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      if (await access.canUser(companyId, req.actor.userId, "agents:create")) return;
    }
    throw forbidden("Missing permission: agents:create");
  }

  router.get("/companies/:companyId/tools", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listMatrix(companyId));
  });

  router.post("/companies/:companyId/tools", validate(companyToolCreateSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManage(req, companyId);
    const tool = await svc.createTool(companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.tool_created",
      entityType: "company_tool",
      entityId: tool.id,
      details: { key: tool.key, label: tool.label, risk: tool.risk },
    });
    res.status(201).json(tool);
  });

  router.post("/companies/:companyId/tool-grants", validate(agentToolGrantBulkSetSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManage(req, companyId);
    const actor = getActorInfo(req);
    const grants = [];
    for (const grant of req.body.grants) {
      const saved = await svc.setGrant(
        companyId,
        grant.agentId,
        grant.toolId,
        grant.mode,
        actor.actorType === "user" ? actor.actorId : null,
      );
      grants.push(saved);
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.tool_grants_updated",
      entityType: "company",
      entityId: companyId,
      details: { count: grants.length },
    });
    res.json({ grants });
  });

  return router;
}
```

- [ ] **Step 3: Export and register routes**

In `server/src/routes/index.ts`, add:

```ts
export { toolAccessRoutes } from "./tool-access.js";
```

In `server/src/app.ts`, import `toolAccessRoutes` beside `companySkillRoutes`:

```ts
import { toolAccessRoutes } from "./routes/tool-access.js";
```

Register `toolAccessRoutes(db)` beside other company-scoped routes:

```ts
api.use(companySkillRoutes(db));
api.use(toolAccessRoutes(db));
api.use(agentRoutes(db, { pluginWorkerManager: workerManager }));
```

- [ ] **Step 4: Run route tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/tool-access-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/tool-access.ts server/src/routes/index.ts server/src/app.ts server/src/__tests__/tool-access-routes.test.ts
git commit -m "feat: add tool access API"
```

## Task 5: Render Hermes Grants Into Agent Config

**Files:**
- Modify: `server/src/services/tool-access.ts`
- Modify: `server/src/__tests__/tool-access-service.test.ts`

- [ ] **Step 1: Add renderer tests**

Add a test that creates tools:

```ts
const terminal = await svc.createTool(companyId, { key: "adapter_toolset.terminal", label: "Terminal", source: "adapter_toolset", adapter: "hermes_local", risk: "admin", supportedModes: ["off", "admin"], render: { hermes: { toolset: "terminal" } } });
const gbrain = await svc.createTool(companyId, { key: "mcp.gbrain.query", label: "GBrain query", source: "mcp_tool", adapter: "hermes_local", serverKey: "gbrain", toolName: "query", risk: "read", supportedModes: ["off", "read"], render: { hermes: { mcpServer: "gbrain", includeTool: "query" } } });
await svc.setGrant(companyId, agentId, terminal.id, "admin", null);
await svc.setGrant(companyId, agentId, gbrain.id, "read", null);
const rendered = await svc.renderHermesAgentConfig(companyId, agent);
expect(rendered.adapterConfig.toolsets).toContain("terminal");
expect(rendered.adapterConfig.mcp_servers.gbrain.tools.include).toEqual(["query"]);
```

- [ ] **Step 2: Add renderer**

In `server/src/services/tool-access.ts`, add a method:

```ts
    renderHermesAgentConfig: async (
      companyId: string,
      agent: { id: string; adapterType: string; adapterConfig: Record<string, unknown> },
    ) => {
      if (agent.adapterType !== "hermes_local") return { adapterConfig: agent.adapterConfig };
      const matrix = await listMatrix(companyId);
      const grants = matrix.grants.filter((grant) => grant.agentId === agent.id && grant.mode !== "off");
      const toolById = new Map(matrix.tools.map((tool) => [tool.id, tool]));
      const toolsets = new Set(
        String(agent.adapterConfig.toolsets ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      const mcpServers: Record<string, { tools: { include: string[]; resources: false; prompts: false }; enabled: true }> = {};
      for (const grant of grants) {
        const tool = toolById.get(grant.toolId);
        const hermes = tool?.render?.hermes as Record<string, unknown> | undefined;
        if (!hermes) continue;
        if (typeof hermes.toolset === "string") toolsets.add(hermes.toolset);
        if (typeof hermes.mcpServer === "string" && typeof hermes.includeTool === "string") {
          const server = mcpServers[hermes.mcpServer] ?? {
            enabled: true,
            tools: { include: [], resources: false, prompts: false },
          };
          server.tools.include.push(hermes.includeTool);
          mcpServers[hermes.mcpServer] = server;
        }
      }
      return {
        adapterConfig: {
          ...agent.adapterConfig,
          toolsets: [...toolsets].sort().join(","),
          mcp_servers: mcpServers,
        },
      };
    },
```

- [ ] **Step 3: Call renderer after grants change**

After saving grants in the route, load affected agents and patch `adapterConfig` through `agentService.update`. Add this route-level loop after grant saves:

```ts
const affectedAgentIds = [...new Set(grants.map((grant) => grant.agentId))];
for (const agentId of affectedAgentIds) {
  const agent = await agentService(db).getById(agentId);
  if (!agent || agent.companyId !== companyId || agent.adapterType !== "hermes_local") continue;
  const rendered = await svc.renderHermesAgentConfig(companyId, {
    id: agent.id,
    adapterType: agent.adapterType,
    adapterConfig: agent.adapterConfig,
  });
  await agentService(db).update(agent.id, { adapterConfig: rendered.adapterConfig }, {
    recordRevision: {
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      source: "tool_access_policy_render",
    },
  });
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @paperclipai/server exec vitest run \
  src/__tests__/tool-access-service.test.ts \
  src/__tests__/tool-access-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/tool-access.ts server/src/routes/tool-access.ts server/src/__tests__/tool-access-service.test.ts server/src/__tests__/tool-access-routes.test.ts
git commit -m "feat: render Hermes tool grants"
```

## Task 6: Add Company Tools UI

**Files:**
- Create: `ui/src/api/tool-access.ts`
- Modify: `ui/src/api/queryKeys.ts`
- Create: `ui/src/pages/CompanyTools.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/CompanySettingsSidebar.tsx`
- Create: `ui/src/pages/CompanyTools.test.tsx`

- [ ] **Step 1: Add API client**

Create `ui/src/api/tool-access.ts`:

```ts
import type { AgentToolGrant, CompanyTool, ToolAccessMatrix, ToolAccessMode } from "@paperclipai/shared";
import { api } from "./client";

export const toolAccessApi = {
  matrix: (companyId: string) =>
    api.get<ToolAccessMatrix>(`/companies/${companyId}/tools`),
  createTool: (companyId: string, data: Partial<CompanyTool>) =>
    api.post<CompanyTool>(`/companies/${companyId}/tools`, data),
  setGrants: (companyId: string, grants: Array<{ agentId: string; toolId: string; mode: ToolAccessMode }>) =>
    api.post<{ grants: AgentToolGrant[] }>(`/companies/${companyId}/tool-grants`, { grants }),
};
```

- [ ] **Step 2: Add query key**

In `ui/src/api/queryKeys.ts`, add:

```ts
  toolAccess: {
    matrix: (companyId: string) => ["tool-access", companyId] as const,
  },
```

- [ ] **Step 3: Add page**

Create `ui/src/pages/CompanyTools.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ToolAccessMode } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { toolAccessApi } from "@/api/tool-access";
import { useCompany } from "@/context/CompanyContext";
import { Button } from "@/components/ui/button";

const modes: ToolAccessMode[] = ["off", "read", "write", "admin"];

export function CompanyTools() {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id ?? "";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, ToolAccessMode>>({});
  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: Boolean(companyId),
  });
  const { data } = useQuery({
    queryKey: queryKeys.toolAccess.matrix(companyId),
    queryFn: () => toolAccessApi.matrix(companyId),
    enabled: Boolean(companyId),
  });
  const grantByCell = useMemo(() => {
    const map = new Map<string, ToolAccessMode>();
    for (const grant of data?.grants ?? []) map.set(`${grant.agentId}:${grant.toolId}`, grant.mode);
    return map;
  }, [data?.grants]);
  const save = useMutation({
    mutationFn: () => toolAccessApi.setGrants(companyId, Object.entries(draft).map(([cell, mode]) => {
      const [agentId, toolId] = cell.split(":");
      return { agentId: agentId!, toolId: toolId!, mode };
    })),
    onSuccess: async () => {
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: queryKeys.toolAccess.matrix(companyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    },
  });
  if (!selectedCompany) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tools</h1>
        <p className="text-sm text-muted-foreground">Manage which agents can use company tools.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="p-3 text-left">Tool</th>
              {agents.map((agent) => <th key={agent.id} className="p-3 text-left">{agent.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {(data?.tools ?? []).map((tool) => (
              <tr key={tool.id} className="border-t border-border">
                <td className="p-3">
                  <div className="font-medium">{tool.label}</div>
                  <div className="text-xs text-muted-foreground">{tool.key}</div>
                </td>
                {agents.map((agent) => {
                  const cell = `${agent.id}:${tool.id}`;
                  const value = draft[cell] ?? grantByCell.get(cell) ?? "off";
                  return (
                    <td key={cell} className="p-3">
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1"
                        value={value}
                        onChange={(event) => setDraft((prev) => ({ ...prev, [cell]: event.target.value as ToolAccessMode }))}
                      >
                        {modes.filter((mode) => tool.supportedModes.includes(mode)).map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button disabled={Object.keys(draft).length === 0 || save.isPending} onClick={() => save.mutate()}>
        Apply changes
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Add catalog creation controls**

Extend `CompanyTools` with an `Add tool` form above the matrix. The form has inputs for `key`, `label`, `source`, `adapter`, `risk`, `serverKey`, `toolName`, and `render` as JSON text. Submit through `toolAccessApi.createTool(companyId, payload)`, invalidate `queryKeys.toolAccess.matrix(companyId)` on success, and reset the form state.

Use these defaults:

```ts
const [toolForm, setToolForm] = useState({
  key: "",
  label: "",
  source: "mcp_tool",
  adapter: "hermes_local",
  risk: "read",
  serverKey: "",
  toolName: "",
  render: "{\n  \"hermes\": {}\n}",
});
```

When building the payload, parse `toolForm.render` with `JSON.parse`, omit empty `serverKey` and `toolName`, and set `supportedModes` from risk:

```ts
const supportedModes = toolForm.risk === "read" ? ["off", "read"] : ["off", "read", "write", "admin"];
```

- [ ] **Step 5: Register route**

In `ui/src/App.tsx`, import:

```ts
import { CompanyTools } from "./pages/CompanyTools";
```

Add route:

```tsx
<Route path="company/settings/tools" element={<CompanyTools />} />
```

- [ ] **Step 6: Add navigation**

In `ui/src/components/CompanySettingsSidebar.tsx`, add a link to `/company/settings/tools` labeled `Tools`. Use the existing `SidebarNavItem` pattern and add `Wrench` from `lucide-react`.

- [ ] **Step 7: Add UI test**

Create `ui/src/pages/CompanyTools.test.tsx` with one test that creates a catalog entry through the form and one test that renders one tool, two agents, changes a select, and asserts `toolAccessApi.setGrants` receives one changed grant.

- [ ] **Step 8: Run UI test**

Run:

```bash
pnpm --filter @paperclipai/ui exec vitest run src/pages/CompanyTools.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src/api/tool-access.ts ui/src/api/queryKeys.ts ui/src/pages/CompanyTools.tsx ui/src/pages/CompanyTools.test.tsx ui/src/App.tsx ui/src/components/CompanySettingsSidebar.tsx
git commit -m "feat: add company tool access matrix UI"
```

## Task 7: Final Verification

- [ ] **Step 1: Run server tests**

```bash
pnpm --filter @paperclipai/server exec vitest run \
  src/__tests__/tool-access-service.test.ts \
  src/__tests__/tool-access-routes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run UI test**

```bash
pnpm --filter @paperclipai/ui exec vitest run src/pages/CompanyTools.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks**

```bash
pnpm --filter @paperclipai/db typecheck
pnpm --filter @paperclipai/shared typecheck
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/ui typecheck
```

Expected: PASS.

- [ ] **Step 4: Prepare PR body**

Use `.github/PULL_REQUEST_TEMPLATE.md`. Include screenshots of the Tools page if browser verification was run.
