# Paperclip Hermes Tool Access Design

**Date:** 2026-05-18
**Status:** Draft for review
**Owner:** Lee Barone
**Target:** Upstream Paperclip PR series, with Lee's Paperclip + Hermes + GBrain stack as the proving ground

## Problem

Paperclip can create and manage AI employees, while Hermes gives each runtime profile its own tools, skills, memory, sessions, MCP servers, and config. Today those two lifecycle models are only loosely connected.

That creates two problems:

- A new Paperclip agent does not automatically imply a durable Hermes runtime identity unless Lee's local `profile-sync` wrapper repairs it.
- Tool access is configured profile by profile in Hermes config instead of from one Paperclip control plane.

The result is brittle setup. A company can hire multiple agents, but the human still has to reason about which Hermes profile exists, which config file has which MCP server, and which tools each profile should be allowed to call.

## Goal

Make Paperclip and Hermes more plug and play by adding a Paperclip-owned access model that can render into Hermes profiles.

The design should support three upstream PRs:

1. **Hermes profile provisioning:** one Paperclip `hermes_local` agent maps to one stable Hermes profile.
2. **Tool catalog and access matrix:** Paperclip stores company tools and per-agent grants, then renders Hermes toolsets and MCP filters.
3. **Governance polish:** risky access changes are auditable and can require approval.

Lee's stack should remain the test harness, but the feature should be framed for upstream Paperclip so other Paperclip + Hermes users benefit too.

## Non-Goals

- Replacing Hermes' own profile system.
- Building a general secrets manager.
- Supporting every Paperclip adapter in the first PR series.
- Inferring safety from natural-language role descriptions.
- Moving durable memories between Hermes profiles.
- Creating a public hosted Paperclip service.

## Design Principle

Paperclip is the control plane. Hermes is the runtime.

Paperclip should own:

- Agents and org chart.
- Company-level tool catalog.
- Per-agent tool policy.
- Approval and audit trail.

Hermes should own:

- Profile-local execution.
- `config.yaml` and `.env` runtime details.
- Toolsets and MCP server filters.
- Skills, sessions, memory, and gateway state.

The integration boundary is an adapter policy renderer: Paperclip stores normalized policy, and the `hermes_local` adapter renders it into Hermes-compatible profile config.

## PR 1: Hermes Profile Provisioning

### Purpose

Every Paperclip `hermes_local` agent should have a stable Hermes profile, created and repaired by Paperclip or the Paperclip Hermes adapter.

This makes runtime identity explicit. Without it, tool access policy can drift because multiple agents may accidentally share the same Hermes profile.

### Data Model

Add adapter-managed runtime identity metadata to the Paperclip agent record.

Suggested metadata fields:

```json
{
  "runtimeIdentity": {
    "adapter": "hermes_local",
    "profileSlug": "acme-head-of-sales",
    "hermesHome": "/data/hermes/profiles/acme-head-of-sales",
    "createdAt": "2026-05-18T00:00:00.000Z",
    "managedBy": "paperclip"
  }
}
```

The profile slug should be deterministic on first creation, then persisted so company or agent renames do not move existing memory.

### Lifecycle

When a `hermes_local` agent is created or updated:

1. Resolve or create its profile slug.
2. Ensure the Hermes profile directory exists.
3. Ensure the profile has a config file and env file.
4. Patch the agent adapter env with `HERMES_HOME` and any adapter-required URLs.
5. Record the runtime identity on the agent.

When an agent is terminated:

- Default behavior should archive the Hermes profile.
- Purge should require explicit operator action.

### Acceptance Criteria

- Creating a new `hermes_local` agent creates exactly one stable Hermes profile.
- Re-running reconciliation is idempotent.
- Renaming the agent does not move the existing profile.
- Terminating the agent archives, not deletes, runtime state by default.
- Existing users with manually configured profiles are not broken.

## PR 2: Tool Catalog and Access Matrix

### Purpose

Give Paperclip one company-level surface where tools are added once, then granted to agents through a matrix.

This answers the core user workflow: "I want one tool dashboard where I turn access on and off for profiles, not configure every profile by hand."

### Tool Catalog

Tools are added at the Paperclip company level.

Catalog entries should support these sources:

- `paperclip_builtin`: Paperclip issue, project, agent, approval, budget, and routine actions.
- `adapter_toolset`: Hermes toolsets such as `terminal`, `file`, `web`, `browser`, `code_execution`, `vision`, and `mcp`.
- `mcp_tool`: tools contributed by configured MCP servers, such as GBrain, Pipedrive, GitHub, Gmail, Notion, or Paperclip's own MCP server.
- `skill`: optional future extension for Paperclip-managed skills.

Suggested catalog shape:

```json
{
  "id": "tool_123",
  "companyId": "company_123",
  "key": "mcp.gbrain.query",
  "label": "GBrain query",
  "source": "mcp_tool",
  "adapter": "hermes_local",
  "serverKey": "gbrain",
  "toolName": "query",
  "risk": "read",
  "supportsModes": ["off", "read"],
  "render": {
    "hermes": {
      "mcpServer": "gbrain",
      "includeTool": "query"
    }
  }
}
```

Manual catalog entries are enough for the first version. Discovery can follow later.

### Access Matrix

The matrix stores per-agent grants against the company catalog.

Suggested grant shape:

```json
{
  "companyId": "company_123",
  "agentId": "agent_123",
  "toolId": "tool_123",
  "mode": "read",
  "grantedBy": "user_123",
  "grantedAt": "2026-05-18T00:00:00.000Z"
}
```

Allowed modes:

- `off`: tool is unavailable.
- `read`: non-mutating access.
- `write`: mutating access.
- `admin`: destructive or broad management access.

Not every tool supports every mode. For Hermes MCP tools, the first version can map grants to include/exclude lists. More nuanced read/write enforcement can come from scoped MCP servers or future adapter metadata.

### Hermes Rendering

The `hermes_local` renderer converts Paperclip grants into profile config.

Examples:

- Granting `adapter_toolset.terminal` adds `terminal` to the agent's Hermes `toolsets`.
- Removing `adapter_toolset.terminal` removes `terminal` from the agent's Hermes `toolsets`.
- Granting `mcp.gbrain.query` enables the `gbrain` MCP server and includes `query`.
- Denying all tools on a server disables the MCP server or renders an empty include list.

Hermes already supports MCP `enabled`, `tools.include`, `tools.exclude`, `tools.resources`, and `tools.prompts`, so Paperclip should render to those native fields rather than inventing a parallel Hermes permission format.

### UI

Add a company settings page or dashboard tab named **Tools**.

The first version should include:

- Tool catalog table: name, source, risk, adapter, server, available modes.
- Add/edit tool form for manual catalog entries.
- Access matrix: tools as rows, agents as columns.
- Cell control for `off`, `read`, `write`, or `admin`, limited by the tool's supported modes.
- "Apply changes" action that saves grants and triggers adapter reconciliation.

The UI does not need to be fancy. The key is that the source of truth moves out of hand-edited Hermes profile files.

### Acceptance Criteria

- A user can add a company-level tool once.
- A user can grant or remove that tool for multiple agents from one screen.
- Hermes profile config changes match the matrix after reconciliation.
- Agents without grants cannot see or call the denied MCP tools.
- Existing adapter configs continue to work if no catalog or grants exist.

## PR 3: Governance and Audit

### Purpose

Tool access is a safety boundary. Paperclip should track who changed access and make risky grants reviewable.

### Audit Trail

Every access change should create an activity event:

```text
Lee granted mcp.pipedrive.update_deal write access to Head of Sales.
```

The event should include:

- Company ID.
- Agent ID.
- Tool ID.
- Previous mode.
- New mode.
- Actor.
- Timestamp.

### Risk Gates

Tools carry a risk level:

- `read`: safe by default.
- `write`: changes external systems.
- `admin`: broad or destructive.
- `secret`: exposes credentials or sensitive user data.

Company policy can require approval for increasing access at or above a chosen risk level. The first version can default to direct changes and only record audit events, then add approval gating behind a feature flag.

### Presets

Role presets make the matrix faster to use:

- CEO / orchestrator.
- Sales.
- Customer support.
- Marketing.
- Coder.
- Reviewer.

Presets are not magic role prompts. They are saved bundles of grants that can be applied to an agent and then edited.

### Acceptance Criteria

- Access changes are visible in Paperclip activity.
- Risk metadata is visible in the tool catalog.
- Approval gates can be enabled without changing Hermes.
- Presets create grants through the same policy model as manual edits.

## Migration Path for Lee's Stack

Lee's current `paperclip-hermes-gbrain` stack already has the proving pieces:

- `profile-sync.mjs` creates and repairs per-agent Hermes and GBrain homes.
- Hermes profiles use native MCP server config.
- GBrain and Paperclip MCP servers are already registered in the Hermes template.
- Per-profile MCP include/exclude filters can be rendered into `config.yaml`.

The upstream PRs should gradually replace local wrapper behavior:

1. Move the profile identity concept from `profile-sync.mjs` into Paperclip or the upstream `hermes_local` adapter.
2. Keep Lee's wrapper as a compatibility reconciler while upstream matures.
3. Add the Paperclip tool catalog and matrix.
4. Teach Lee's wrapper to read upstream policy if needed during the transition.
5. Remove local-only config patching once upstream Paperclip can provision and render Hermes profiles itself.

## Testing Strategy

### Unit Tests

- Profile slug generation is stable and safe.
- Profile provisioning is idempotent.
- Tool catalog validation rejects invalid keys and unsupported modes.
- Access grant validation rejects modes the tool does not support.
- Hermes renderer produces expected `toolsets` and MCP include/exclude config.

### Integration Tests

- Create a Paperclip company with three Hermes agents.
- Verify three distinct Hermes profiles are created.
- Add GBrain and Paperclip MCP tools to the catalog.
- Grant GBrain to one agent and deny it to another.
- Reconcile adapter config.
- Verify generated profile configs differ as expected.

### Manual Smoke Test

Use Lee's stack:

1. Hire `Head of Sales`, `Head of Marketing`, and `Reviewer`.
2. Confirm each agent gets a distinct Hermes profile.
3. Add tools: `gbrain.query`, `paperclip.create_issue`, `terminal`, and a customer-facing MCP write tool.
4. Grant terminal only to the coder/reviewer role.
5. Grant customer-facing write access only to Head of Sales.
6. Ask each agent to list available tools and attempt a denied action.
7. Confirm denied tools are not visible or fail safely.

## PR Decomposition

### PR 1: Stable Hermes runtime identity

Smallest useful upstream change. It should not include the matrix UI.

Files likely touched:

- Agent creation/update path.
- `hermes_local` adapter.
- Agent metadata/types.
- Tests around adapter env and profile provisioning.

### PR 2: Tool catalog and access matrix

Adds the policy model and user-facing control plane.

Files likely touched:

- Database schema.
- API routes.
- Company settings/dashboard UI.
- Adapter policy renderer interface.
- Hermes renderer implementation.
- Tests for policy validation and rendering.

### PR 3: Governance, audit, presets

Adds safety and workflow polish after the core model works.

Files likely touched:

- Activity/audit event creation.
- Approval rules.
- Role preset storage.
- UI affordances for risk and approvals.

## Upstream Validation Points

These are the main choices to validate against the upstream Paperclip codebase before implementation:

- **Profile provisioning location:** prefer the `hermes_local` adapter package if it has a clear lifecycle hook; otherwise put the lifecycle service in Paperclip core and call it from the adapter path.
- **First catalog input method:** start with manual entries and seeded defaults. MCP discovery is useful, but it should not block the first reviewable PR.
- **Grant scope:** store grants per agent in PR 2. Add presets in PR 3 as bundles that create normal per-agent grants.
- **Config reload behavior:** generated Hermes config should apply on the next run for the first version. Immediate reload can be added later for long-running gateways.

## Recommendation

Ship this as a three-PR sequence.

PR 1 makes Paperclip + Hermes durable by ensuring every `hermes_local` agent has a stable runtime profile. PR 2 adds the actual dashboard and central source of truth for tools. PR 3 adds safety, audit, and presets once the model is proven.

This keeps each reviewable change small enough for upstream maintainers while still moving toward the real outcome: a plug-and-play Paperclip + Hermes stack where users manage tool access once from Paperclip instead of hand-editing every Hermes profile.
