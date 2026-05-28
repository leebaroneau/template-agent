# Tool Access Catalog, Governance & Matrix — Design

**Status:** approved design, ready for implementation plan
**Author:** Lee Barone (with Claude)
**Date:** 2026-05-20
**Scope:** Paperclip upstream (catalog data model, governance MCP tools, optional UI) + template-agent (`profile-sync.mjs` projection, per-profile isolation, secret resolver)
**Related:** Paperclip PR #6242 (catalog), Paperclip PR #6243 (governance, approvals, presets, render metadata), [`paperclip/seed-tool-access.mjs`](../../../paperclip/seed-tool-access.mjs)

---

## 1. Goal

Give each Paperclip company a single, auditable system for declaring **what tools exist**, **which agents are allowed to use them**, and **how that policy materializes into each Hermes profile on disk** — usable from day one via natural language, growing into a full visual surface as scale demands.

Three properties must hold:

1. **Per-agent opt-in.** Adopting governance is per-agent, not all-or-nothing. Existing agents keep working unchanged. New agents can be onboarded one at a time.
2. **Conversational by default.** Daily grant operations happen through Paperclip MCP governance tools, callable from Telegram / chat / an admin agent. The UI is the exception path, not the daily driver.
3. **Per-profile isolation as the security boundary.** Tool absence ≡ credential absence on disk. The matrix is policy declaration; the per-agent Hermes profile dir is enforcement.

## 2. Why Paperclip + per-profile (not one or the other)

The Paperclip PRs are the right layer for **policy authoring**: typed catalog, named presets, render metadata, audit. They are NOT enough on their own — if all agents share one Hermes profile, OAuth tokens and MCP server configs sit in a shared bag reachable by any agent with `file` or `terminal`, regardless of what the matrix says.

Per-agent Hermes profiles fix this by making **tool absence ≡ credential absence on disk**. The matrix declares intent; `profile-sync` materializes intent into per-agent profile dirs. An ungranted tool is not just filtered at runtime — it is physically absent from the profile's `config.yaml` and credentials.

The PRs are not a mistake. The data model is the right shape. The full UX/IA was *initially* over-scoped for current scale, but is the correct long-term destination — sequenced over three phases below.

## 3. Phased delivery

The full design ships incrementally. Phase tags appear inline throughout this spec so the implementation plan can pick up Phase 1 cleanly.

### Phase 1 — Security plumbing (no new UI)

- `profile-sync.mjs` extended with the projection contract (§11)
- Reference-style credentials (`secret://...`) — tokens never at rest in profile dirs
- Per-profile isolation invariants enforced for `managed: true` agents only
- Three-tier gateway bounce + atomic YAML write with `.prev` rollback
- Paperclip catalog API exercised directly (no dedicated UI yet — current Paperclip agent edit page is enough)
- Managed flag on agents (§5)
- Hermes upstream contribution: `secret://` resolver against Paperclip `/secrets` (see §17)

Delivers ~80% of the security value. Drives daily use only with light Paperclip click-through; conversational comes in Phase 2.

### Phase 2 — Conversational governance

- Paperclip MCP governance tools (§13): `paperclip_grant_tool`, `paperclip_revoke_tool`, `paperclip_apply_preset`, `paperclip_inject_connection_env`, `paperclip_list_grants`, `paperclip_set_managed`, `paperclip_initiate_connection`
- Preset auto-apply on agent hire (managed: true + preset key in create payload)
- Connection setup (OAuth dance) remains in browser — unavoidable security event
- Daily use becomes "@admin grant Marketer GitHub" — no UI clicking

Delivers the "use it without thinking about the matrix" daily flow.

### Phase 3 — Policy + audit UI

- Full Matrix tab (§7), Connections tab (§9 detail UI), Presets editor (§16), Audit log (§15)
- Drift detection banners, state dots, per-cell projection state
- Bulk select + preset apply across multiple agents
- Agent drawer (§10), tool drawer

Ships when any of: 15+ agents in a company, a second operator, or the first multi-tenant client demanding a security review.

## 4. Architecture & data flow

```
        ┌──────────────────────────────────────────────────────────┐
        │                  Paperclip (data + API)                  │
        │                                                          │
        │   Tool catalog                                           │
        │   Connections (OAuth identities, refs to /secrets store) │
        │   Presets                                                │
        │   Per-agent grants                                       │
        │   agent.metadata.toolAccess.managed: true | false        │
        └─────────┬─────────────────────────────────────┬──────────┘
                  │                                     │
                  │ (1) Paperclip MCP governance tools  │ (1') UI (Phase 3)
                  │     [Phase 2 — daily driver]        │
                  │                                     │
        ┌─────────▼─────────┐                ┌──────────▼──────────┐
        │  Admin agent /    │                │   Matrix / Tools /  │
        │  Telegram / chat  │                │  Connections / etc. │
        │  "@admin grant X" │                │  (audit + exception)│
        └───────────────────┘                └─────────────────────┘
                  │
                  │ (writes to Paperclip via API)
                  ▼
         ┌──────────────────────────────────────────────────────────┐
         │   profile-sync.mjs  (template-side, periodic + on-event) │
         │   [Phase 1]                                              │
         │   Only touches profiles of agents with managed: true.    │
         │   Single writer to profile dirs.                         │
         └──────────────┬──────────────────────────┬────────────────┘
                        │                          │
       (2a) Atomic YAML projection         (2b) Three-tier gateway bounce
                        │                          │
                        ▼                          ▼
        ┌──────────────────────────────────────────────────────────┐
        │  <hermesHome>/profiles/<agent-slug>/config.yaml          │
        │  toolsets: [terminal, file, web]                         │
        │  toolsets.terminal.env:                                  │
        │    GH_TOKEN: secret://gh-oauth-haverford                 │
        │  mcp.servers.github.include_tools: [create_pr, ...]      │
        │  mcp.servers.github.env.GITHUB_TOKEN: secret://gh-oauth  │
        └──────────────┬───────────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────────────────────────┐
        │                                                 │
   (3a) Gateway-initiated                       (3b) Paperclip-initiated
   (Telegram, Discord, voice)                   (issue, routine, webhook)
   reads profile config.yaml at                 Paperclip adapter ALSO
   session start, resolves                      passes rendered toolsets
   secret://... against Paperclip               in adapterConfig
   /secrets API                                 (belt + braces)
```

**Single source of truth:** Paperclip DB (catalog, grants, presets, connections, managed flag).
**Single writer to disk:** `profile-sync.mjs`. Nothing else mutates managed profile dirs.
**Two daily interfaces:** Paperclip MCP governance tools (conversational, primary) + UI (visual, audit/exception).
**Two consumer paths:** gateway reads `config.yaml`; Paperclip adapter reads grants at run-time and passes the same rendered set in `adapterConfig`.

## 5. Managed vs unmanaged agents (the opt-in contract)

Each Paperclip agent carries `metadata.toolAccess.managed: true | false`.

| | `managed: false` (default for existing agents) | `managed: true` |
|---|---|---|
| **profile-sync behavior** | Does not touch this agent's `config.yaml` at all | Owns the tool-access portions of `config.yaml`; reconciles on every sweep |
| **Matrix UX (Phase 3)** | Row renders greyed-out with `[Manage this agent →]` | Editable cells with state dots |
| **Catalog visibility** | Catalog ignores the agent (no rendering against it) | Catalog entries materialize per granted tool |
| **OAuth Connections** | Can still reference `secret://...` in hand-edited YAML if Hermes resolver is installed | Connection env-injection (§9.3) writes the references automatically |
| **Failure modes** | Hand-managed; user owns drift and rotation | profile-sync invariants apply (§11) |

**Defaults:**
- Existing agents default to `managed: false` — preserves current behavior, zero migration risk.
- New agents created via the "hire with preset" flow default to `managed: true` (Phase 2) — new agents get the security benefit by default.

**Transitions:**
- `false → true`: profile-sync runs a one-time materialization sweep that reads current grants, writes the projected YAML, bounces the gateway. If no grants exist yet, the agent's profile has its tool-access blocks emptied (then re-applied as grants are made).
- `true → false`: profile-sync drops the agent from its scope. The current `config.yaml` is preserved as-is; the user takes ownership. An audit event is logged. Re-flipping to `true` triggers another reconciliation sweep that may overwrite manual changes.

**Hybrid companies are supported.** Same company can have some managed and some unmanaged agents. profile-sync iterates the managed set only.

## 6. Information architecture (Phase 3 UI)

Phase 3 introduces a new Settings cluster:

```
Company > Settings > Access
├── Matrix        ← daily editing (managed agents only show as live cells)
├── Tools         ← catalog of what can be granted
├── Connections   ← authenticated identities (OAuth lives here)
├── Presets       ← named grant bundles
└── Audit log     ← grant changes + projection events
```

Why Connections is its own tab: OAuth is once-per-provider, not once-per-tool. Connecting to GitHub *as Lee* once can back many catalog entries. Burying the OAuth dance inside "New tool" makes every tool feel like a security event when it isn't.

Phase 1 + 2 don't require any of these tabs — the existing Paperclip agent edit page is the fallback UI.

## 7. Tool granularity

Asymmetric on purpose, because runtime granularity is asymmetric.

| Source | Catalog granularity | Mode semantics |
|---|---|---|
| **Hermes toolset** (`adapter_toolset.terminal`, `.file`, `.web`, `.browser`, `.code_execution`, `.vision`, `.mcp`, `.creative`, `.productivity`) | one entry per toolset bundle | `off` = toolset not loaded; `read` / `write` / `admin` = loaded with gating filter where Hermes supports it (e.g. `file` read-only) |
| **MCP tool** (`mcp.github.create_pr`, `mcp.paperclip.list_issues`, …) | one entry per individual tool | binary: `off` or the tool's natural risk. `supportedModes` is metadata so the popover only renders meaningful radio buttons |
| **Custom** (webhook actions, internal HTTP) | one entry per action | binary |

**Consequence:** you cannot grant "list files but not write files" as separate matrix entries. If that distinction matters, express it via the Hermes `file` toolset's mode column (`read` vs `write`). Splitting Hermes toolsets further would require forking upstream — not in scope.

## 8. Matrix page (Phase 3, landing tab)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Access › Matrix                                              [+ New tool]   │
│  Filter:  source [all ▾]   risk [all ▾]   adapter [hermes_local ▾]           │
│  Show:    [✓] managed   [ ] unmanaged                                        │
│  Selected: 0 agents     Preset: [Researcher ▾]  [Apply to selection]         │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▢ Agent ↓           │ term │ file │ web │ pc.list │ pc.get │ pc.create │ ... │
│ ▢ CEO         (M)   │ ADM● │  W●  │ R●  │   R●    │   R●   │    W●     │     │
│ ▢ Marketer    (M)   │ off  │  W●  │ R●  │   R●    │   R●   │   off     │     │
│ ▢ Coder       (M)   │ ADM◐ │  W●  │ R●  │   R●    │   R●   │    W●     │     │
│ ▢ Researcher  ( )   │  —      —     —      —        —          —      [Manage]│
│  Dots: ● Projected  ◐ Projecting  ✕ Failed  ○ Pending     (M) = managed      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Sticky-left agent column, sticky-top tool header.
- Unmanaged agents render greyed with a `[Manage]` button — clicking flips `managed: true` (with a confirm dialog).
- Click cell → popover with `off / read / write / admin` radios (only supportedModes enabled).
- Shift-click multi-select within a column for bulk set.
- Row checkbox + "Apply preset to selection" for new-agent onboarding.
- No save button — cell changes commit on popover close (toast + 5s undo).
- Click agent name → agent drawer. Click tool header → tool drawer.
- Each cell shows a state dot (see §11.2 state machine).

### 8.1 Cell popover — security-aware

```
┌─────────────────────────────────────────────────┐
│  Marketer × mcp.github.create_pr                │
│                                                 │
│  Mode:  ○ off   ● read   ○ write   – admin      │
│                                                 │
│  Changing this will:                            │
│   • Install github MCP server in marketer's     │
│     profile (config.yaml)                       │
│   • Provision secretRef for GitHub connection   │
│     (@lee-haverford) into marketer's profile    │
│   • Bounce marketer's gateway (~3s downtime)    │
│                                                 │
│  ⚠ Marketer has 1 active Telegram session.      │
│     Applying will end it.                       │
│                                                 │
│  [Cancel]                          [Apply]      │
└─────────────────────────────────────────────────┘
```

Every grant change must spell out what physically moves on disk. The matrix is not checkboxes; it is filesystem mutation. Making that visible in the popover is the difference between "the matrix is a UI hint" and "the matrix is the policy."

## 9. Tools, Connections, and env injection

### 9.1 Tools tab (Phase 3)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Access › Tools                                       [+ New tool]   │
│ Tool                          │ Source         │ Risk  │ Granted     │
│ ───────────────────────────── │ ────────────── │ ───── │ ─────────── │
│ adapter_toolset.terminal      │ Hermes toolset │ ADMIN │ 3 / 8       │
│ adapter_toolset.file          │ Hermes toolset │ write │ 7 / 8       │
│ mcp.paperclip.list_issues     │ paperclip MCP  │ read  │ 8 / 8       │
│ mcp.github.create_pr      🔗  │ github MCP     │ write │ 2 / 8       │
│ mcp.github.read_secret    🔗  │ github MCP     │ ADMIN │ 0 / 8       │
└──────────────────────────────────────────────────────────────────────┘
🔗 = backed by a Connection (click → goes to Connection detail)
```

### 9.2 Connections tab (Phase 3 UI; Phase 1 data + OAuth flow)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Access › Connections                              [+ New connection]│
│ Provider │ Identity              │ Backs tools │ Used by │ Status    │
│ ──────── │ ───────────────────── │ ─────────── │ ─────── │ ────────  │
│ GitHub   │ @lee-haverford        │ 4 tools     │ 2 agents│ ● Active  │
│ Slack    │ Haverford workspace   │ 3 tools     │ 5 agents│ ● Active  │
└──────────────────────────────────────────────────────────────────────┘
```

Detail view shows scopes, refresh token storage location, tools backed, agents currently resolving, and gated `[Revoke]` (disabled while dependent grants exist).

**OAuth mechanics — important to understand:** the browser-based OAuth dance happens **once** at Connection setup. The provider returns both an access token (short-lived, hours) and a refresh token (long-lived, often months). Paperclip stores both in `/secrets`. When access tokens expire, Paperclip silently mints new ones using the refresh token — no user interaction. Re-authentication is only needed if (a) the refresh token expires (rare), (b) the user revokes at the provider, or (c) scopes change.

### 9.3 Connection-as-env-injection (the `gh` CLI case)

Not every tool is an MCP catalog entry. The `gh` binary is reached via the `terminal` toolset, not via MCP. To make `gh` work in a profile, that profile needs `GH_TOKEN` in its terminal env.

Connections support an "Inject as env in profiles" mapping independent of MCP catalog entries:

```yaml
# Connection: GitHub (@lee-haverford)
inject_as_env:
  - profile: marketer
    env_var: GH_TOKEN
    secret_ref: secret://gh-oauth-haverford
  - profile: coder
    env_var: GH_TOKEN
    secret_ref: secret://gh-oauth-haverford
```

profile-sync materializes this into the granted profiles' `config.yaml`:

```yaml
# <hermesHome>/profiles/marketer/config.yaml fragment
toolsets:
  terminal:
    env:
      GH_TOKEN: secret://gh-oauth-haverford
```

Researcher's `config.yaml` is untouched — no `GH_TOKEN` in env, `gh` calls fail with auth-required, token is *not on disk* in that profile.

One Connection backs both consumption paths (MCP server and CLI env injection). One OAuth, two ways agents can use GitHub.

## 10. Agent drawer (Phase 3)

Slide-in from any matrix row. Three stacked sections:

- **Status** — `managed: true | false` toggle, current preset (if any), last reconciliation timestamp.
- **Intended grants** — what Paperclip says this agent should have. Editable.
- **Actually projected** — what profile-sync last wrote to disk. Read-only. `[Reconcile now]` button.

When intended ≠ projected → amber banner: *"Drift detected: 1 grant pending projection since 2026-05-19 09:14. [Reconcile now]."* This is how you catch profile-sync silently falling behind.

## 11. Projection & isolation contract (Phase 1)

The security plumbing. `profile-sync.mjs` is the only component that mutates managed profile dirs; everything else writes to Paperclip's DB.

### 11.1 Invariants (apply to `managed: true` agents only)

In this order:

1. **Per-agent profile isolation.** Every managed `hermes_local` agent owns exactly one profile dir at `<hermesHome>/profiles/<agent-slug>/`. Never shared. No symlinks across profiles.
2. **Tool absence ≡ credential absence.** If managed agent A does not have a grant for `mcp.github.*`, A's profile contains zero GitHub MCP server config AND zero GitHub `secretRef` in its YAML. Runtime filtering is not enough.
3. **Reference-style credential projection.** OAuth tokens (and other long-lived secrets) are projected by reference, not by value. Profile YAML stores `secretRef: secret://github-oauth`. Tokens live only in Paperclip's `/secrets` store. Gateway resolves the reference at session start. Tokens never sit at rest in profile dirs.
4. **Connection refcount, not credential copy.** When profile-sync materializes a Connection-backed tool or env injection into a profile, it bumps the connection's per-profile refcount. Revocation decrements. The `secretRef` is removed from the profile YAML only when the refcount hits zero.
5. **Fail closed.** If profile-sync can't materialize a grant (network failure, missing secret, gateway won't bounce), the grant stays `Pending` and the agent's profile is NOT updated to "partially has it." Either fully provisioned or fully absent.
6. **Atomic YAML writes.** profile-sync writes to `config.yaml.next`, fsyncs, atomically renames over `config.yaml`, keeps `config.yaml.prev` for rollback.
7. **Gateway lifecycle.** Any change to a managed profile's `config.yaml` triggers a gateway bounce for that profile and only that profile. Bounce completion required before grant flips to `Projected`. On bounce failure, YAML is rolled back from `.prev` (see §14.5).
8. **Reconciliation sweep.** Periodic pass over managed agents only detects drift: anything in a managed profile dir that doesn't have a matching grant is removed; anything missing that has a grant is re-materialized. **Unmanaged profile dirs are skipped entirely.**

### 11.2 Grant state machine

```
   Edit cell ──► Pending ──► Projecting ──► Projected
                                │              │
                                ▼              ▼
                              Failed        (steady)
                            (retry/rollback)
```

Each matrix cell (Phase 3) carries a state dot: green=Projected, amber=Projecting, red=Failed, grey=Pending. Hover shows last sync timestamp + last error message. In Phase 1/2 the state is exposed via the governance MCP tools' return values.

### 11.3 What profile-sync writes

For a granted Hermes toolset with `render.hermes.toolset: 'file'`:

```yaml
toolsets:
  - file
```

For a granted MCP tool with `render.hermes.mcpServer: 'github', includeTool: 'create_pr'`:

```yaml
mcp:
  servers:
    github:
      command: gh-mcp-server   # from MCP server registration metadata
      include_tools:
        - create_pr
        - list_issues            # union of all granted github tools
      env:
        GITHUB_TOKEN: secret://gh-oauth   # resolved by gateway at session start
```

For a Connection env injection:

```yaml
toolsets:
  terminal:
    env:
      GH_TOKEN: secret://gh-oauth
```

Multiple grants to the same MCP server result in a single server block with the union of `include_tools`. Adding/removing a single tool updates `include_tools` and bounces the gateway — the server is not reinstalled.

**MCP server install metadata** (`command`, `args`, base `env`) lives on the MCP server registration in Paperclip, not on individual catalog entries — a catalog entry is *one tool inside an already-registered server*. Server registration is part of the Connection setup or the Tools tab's "Custom MCP server" flow.

## 12. Paperclip MCP governance tools (Phase 2 — the daily driver)

The conversational interface. Once these tools are exposed on the Paperclip MCP server, daily governance happens in chat / Telegram / via an admin agent — no UI clicking required.

### 12.1 Tool surface

| Tool | Purpose |
|---|---|
| `paperclip_list_grants(agentId)` | List current grants for an agent (intended + projected state) |
| `paperclip_grant_tool(agentId, toolKey, mode)` | Add or change a single grant |
| `paperclip_revoke_tool(agentId, toolKey)` | Set a grant to `off` |
| `paperclip_apply_preset(agentId, presetKey)` | Apply a named preset bundle (replaces or unions, per preset semantics) |
| `paperclip_set_managed(agentId, managed)` | Flip the managed flag |
| `paperclip_list_connections()` | List company Connections + their status |
| `paperclip_initiate_connection(provider)` | Return an OAuth URL for the human to click (the only step that requires a browser) |
| `paperclip_inject_connection_env(connectionId, profiles[], envVar)` | Set the "inject as env" mapping for a Connection |
| `paperclip_list_audit_events(filter)` | Query the audit log |

Each tool returns the current state of the affected agent (grants + projection status) so the admin agent can confirm to the user.

### 12.2 Daily workflows

**Day 1 — first OAuth (only browser moment):**

> Lee: `@admin connect github`
> Admin agent: calls `paperclip_initiate_connection('github')` → returns `https://github.com/login/oauth/authorize?...`
> Admin: "Click this URL to authorize: ..."
> Lee clicks → OAuth dance in browser → callback stores tokens in Paperclip `/secrets`
> Admin: confirms Connection is `Active`.

**Day 1 — wiring up Marketer and Coder:**

> Lee: `@admin inject github connection into Marketer and Coder profiles as GH_TOKEN`
> Admin: calls `paperclip_inject_connection_env('github', ['marketer', 'coder'], 'GH_TOKEN')` → profile-sync materializes → both gateways bounce
> Admin: "Done. Marketer and Coder can now use `gh`. Researcher is untouched."

**Day 2 — hire a new agent:**

> Lee: `@admin hire a Coder named Maya with default coder preset`
> Admin: `paperclip_create_agent({name: 'Maya', role: 'coder', metadata: {toolAccess: {managed: true}}})` then `paperclip_apply_preset('maya', 'coder-default')` → profile-sync provisions
> Admin: "Maya hired and provisioned with the Coder preset: terminal, file, web, paperclip MCP tools."

**Day 30 — revoke from one agent:**

> Lee: `@admin revoke github from Marketer`
> Admin: `paperclip_inject_connection_env('github', ['coder'], 'GH_TOKEN')` (drops marketer) AND `paperclip_revoke_tool('marketer', 'mcp.github.create_pr')` etc.
> profile-sync removes `GH_TOKEN` from marketer's config.yaml, bounces marketer's gateway. Token in Paperclip secrets is untouched — still valid for Coder.

### 12.3 Why this is the daily driver, not just convenience

Designing a coherent permissions policy across 30 agents and 50 tools requires a visual surface — the matrix (Phase 3). But day-to-day grant operations on a known model are faster as text. Both belong; they're complementary, not competing.

## 13. Edge case decisions

**1. OAuth token rotation.** Reference-style projection (§11.1.3) means rotation = update the secret in Paperclip; next session picks it up; zero profile-dir mutation. Failure mode: gateway can't resolve `secretRef` → tool returns auth-failed for that session; Connection flips to `Expired`.

**2. OAuth re-authentication.** Only triggered by (a) refresh token expiry (rare; provider-dependent), (b) user revokes at provider, or (c) scope change. Not part of normal rotation cycle.

**3. Agent termination.** On `agent.status → archived/terminated`: stop gateway, set all grants to `off` (with audit entries), decrement all Connection refcounts, move `<hermesHome>/profiles/<slug>/` to `<hermesHome>/profiles/.archived/<slug>-<ts>/`. Hard delete after 30 days. Lets you forensics-audit a terminated agent.

**4. Managed flag flipped false → true.** profile-sync runs a one-time materialization sweep: reads current grants for the agent, writes the projected YAML (overwriting any prior manual content in tool-access blocks), bounces the gateway. An audit event marks the takeover. The pre-takeover YAML is preserved as `<hermesHome>/profiles/<slug>/config.yaml.pre-managed` for 30 days.

**5. Managed flag flipped true → false.** profile-sync drops the agent from its scope. Current `config.yaml` is preserved as-is; the user takes ownership. An audit event is logged. Future grant changes in Paperclip are recorded but not projected. Re-flipping to `true` triggers another materialization sweep (which may overwrite manual changes since handoff).

**6. Connection revoke while grants exist.** `[Revoke]` button (or `paperclip_revoke_connection`) disabled / errors while dependent grants exist. A "revoke all dependent grants AND connection" affordance requires typed confirmation listing each affected agent. No silent cascade.

**7. Bulk preset apply on slow projection.** Each cell carries its own state; "Apply Researcher to 5 agents" enters ~15 grants in `Pending` in parallel. profile-sync processes parallel across profiles, sequential within a profile (per gateway bounce). User keeps editing — additional edits append to that agent's queue. Partial failures don't poison the batch.

**8. Gateway-bounce failure.** Three-tier escalation: `reload` (5s timeout) → `stop+start` (15s) → `SIGKILL+start` (30s). If all three fail, profile-sync **reverts the YAML to `.prev`**. Grant stays `Failed`; agent keeps the old correct state. Invariant preserved: profile YAML and gateway memory never diverge silently. Surfaced as red banner on agent drawer + audit log entry.

**9. profile-sync down.** "Pending" grant state IS the queue — lives in Paperclip's DB next to the grant row. profile-sync drains on recovery. Persistent yellow banner across the Access section: *"profile-sync hasn't checked in for 5 min — N changes queued."* Edits still allowed. Unmanaged agents are unaffected entirely.

**10. In-flight Telegram session when revoking.** Bounce immediately. Popover warning before applying: *"Marketer has N active sessions — applying will end them."* No silent grace period — the security boundary is the gateway and the gateway has to restart for revocation to take effect.

**11. OAuth provider revokes token externally.** Detected on next gateway session that fails to resolve `secretRef`. Connection enters `Expired`; all dependent grants flip to `Failed`. Connection detail shows red banner; matrix cells go red. `[Re-authenticate]` is the only fix.

**12. Adapter type changes from `hermes_local` → `claude_local`.** Hermes-shaped grants flag as `Inactive` (greyed in matrix). profile-sync tombstones the Hermes profile (managed agents only). If Claude-shaped catalog entries are added later, they populate cells; Hermes grants stay archived for audit trail.

**13. Same MCP server granted at different tool granularities.** profile-sync installs the server in the profile once with `include_tools` as the union of all granted tools from that server. Adding a third tool updates `include_tools` and bounces. Removing the last tool removes the server block AND decrements the backing Connection refcount.

**14. Hybrid company (managed + unmanaged agents).** Fully supported. profile-sync iterates managed agents only. Unmanaged agents are visible in Paperclip and can have grants recorded against them in the DB (for audit/preview purposes) but no projection happens until they're flipped to managed.

## 14. Audit log

Single chronological feed, three event classes:

- **Authoring events:** grant added/removed/changed, preset edited, connection added/revoked/re-authenticated, tool created/edited, managed flag flipped. Actor = human or admin agent.
- **Projection events:** profile-sync wrote `X` to `Y`'s config.yaml, gateway bounced (which tier succeeded), credential materialized/wiped, drift reconciled, materialization sweep on managed-flag flip. Actor = `profile-sync@<host>`.
- **Resolution events:** gateway resolved `secret://...` at session start. (Optional, can be high-volume — surface in detail view only.)

Filterable by agent / tool / connection / actor / phase. Projection events appear inline with authoring events — most "why does Marketer still have GitHub access?" investigations need both halves.

Phase 1 captures these events in Paperclip's existing activity feed. Phase 3 ships the filterable UI surface.

## 15. Presets editor (Phase 3 UI; Phase 1 data + seed)

```
Researcher preset                                  [Save]  [Delete]
─────────────────────────────────────────────────────────────────────
Tools in this preset:                          [+ Add tool]
  adapter_toolset.file        write    [×]
  adapter_toolset.web         read     [×]
  mcp.paperclip.list_issues   read     [×]
  mcp.paperclip.comment       write    [×]

Connection env injections:                     [+ Add injection]
  github     → GH_TOKEN                        [×]

Applied to: 2 agents (Marketer, Researcher-1)
ℹ Editing this preset does NOT retroactively re-apply to those agents.
  Use "Re-apply preset to current holders" to push changes.
```

Non-retroactive by default. Explicit "Re-apply" button (or `paperclip_apply_preset` re-invocation) avoids surprise grants when someone tweaks a preset. Presets can include Connection env injections so a single `paperclip_apply_preset` configures both MCP grants and CLI-style env vars.

Default presets (seeded by `seed-tool-access.mjs`):
- `agent-stack-hermes-default` — terminal, file, web, all paperclip MCP tools
- `agent-stack-researcher` — file (write), web (read), paperclip list+comment
- `agent-stack-manager` — same as default
- (extend with brand-specific presets at deploy time)

## 16. Division of responsibility — Paperclip vs template-agent

| Concern | Owner | Phase | Notes |
|---|---|---|---|
| Catalog data model, REST API | **Paperclip upstream** | 1 | PR #6242 |
| Render metadata schema (`render.hermes.{toolset, mcpServer, includeTool}`) | **Paperclip upstream** | 1 | PR #6243 |
| `metadata.toolAccess.managed` flag on agents | **Paperclip upstream** | 1 | Small schema addition to PR #6243 or follow-up |
| Connections data model + OAuth flows + `/secrets` store | **Paperclip upstream** | 1–2 | OAuth provider integrations grow over time |
| `inject_as_env` mapping on Connections | **Paperclip upstream** | 2 | Small addition |
| **Paperclip MCP governance tools (§12)** | **Paperclip upstream** | 2 | Bridge between catalog and conversational interface |
| Tool catalog UI (Matrix / Tools / Connections / Presets / Audit log) | **Paperclip upstream** | 3 | Deferred until scale demands |
| Default seed data for this stack (Hermes toolsets, Paperclip MCP tools, presets) | **template-agent** | 1 | [`paperclip/seed-tool-access.mjs`](../../../paperclip/seed-tool-access.mjs) |
| `profile-sync.mjs` — projection from grants to per-agent `config.yaml` | **template-agent** | 1 | Implements §11 invariants for managed agents only |
| Gateway bounce orchestration (three-tier escalation) | **template-agent** | 1 | Lives next to profile-sync |
| Drift reconciliation sweep | **template-agent** | 1 | Periodic cron + on-event |
| Per-profile credential resolution at gateway start | **Hermes upstream** | 1 | `secret://...` resolver against Paperclip `/secrets` API — may require upstream contribution |

## 17. Open questions for implementation

1. **Hermes `secret://` resolver.** Does upstream Hermes already support resolving `secret://<id>` references against an external secrets store at gateway start? If not, this is an upstream Hermes contribution gated on Paperclip PRs landing. **Phase 1 blocker.**
2. **Gateway reload command.** Does `hermes -p <profile> gateway reload` exist, or must we `stop+start` for every change? Affects three-tier bounce escalation latency.
3. **Managed flag location.** `agent.metadata.toolAccess.managed` vs a top-level `agent.toolAccessManaged` column. Schema decision for PR #6243 or follow-up.
4. **Concurrent grant editing.** Single-tenant Lee-Haverford setup probably doesn't need optimistic concurrency control on PATCH. Defer until multi-operator scenarios.
5. **Custom MCP server registration UX.** Do operators add custom MCP servers through the Tools tab "Custom" source, or via a separate Adapters/MCP-servers page? Current design assumes Tools tab; revisit if introspection (listing a custom server's tools) needs richer UX.

## 18. Non-goals

- Splitting Hermes toolsets into sub-tool granularity (would require forking upstream).
- Per-agent OAuth apps (one app per company, one identity per provider — refcount-isolated per profile).
- Time-bounded grants ("Marketer has GitHub access until Friday"). Defer.
- Cross-company tool sharing. Out of scope — catalog is company-scoped.
- Approval workflow for high-risk grants. Could layer on top via Paperclip's existing approvals system; not designed here.
- Automatic preset assignment based on `agent.role` without human/agent invoking `paperclip_apply_preset`. Defer until presets stabilize.
