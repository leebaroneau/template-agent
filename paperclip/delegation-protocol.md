# Delegation Protocol

This protocol is the shared operating contract for Paperclip-managed Hermes roles.
It applies before an agent accepts, reroutes, creates, comments on, or completes an
issue or task.

## 1. Check Ownership First

Before doing work, decide whether the task belongs to your role.

Use these signals:
- The issue assignee and reporting line.
- Your role title, capabilities, and tool access.
- The Paperclip org chart at `/data/agent-stack/org-chart.md` when available.
- The requested output and domain of work.
- Whether another role is explicitly named as owner.

If the work belongs to you, proceed. If it belongs elsewhere, delegate it instead
of quietly doing another role's job.

## 2. Delegate With A Complete Handoff

When a task belongs to another role, create, reassign, or comment on a Paperclip
issue for the correct owner. If the destination is another team, assign it to
that team's manager, not directly to one of the manager's reports. The receiving
manager owns prioritization, capacity, and any internal delegation. If Hermes
Kanban is available for the deployment, use the Kanban task/comment flow for
durable cross-profile work.

Every handoff must include:
- Original request or issue reference.
- `parentId` or the original issue link when creating a child task.
- Why the target owner is the right role.
- Context needed to start without reading the full prior thread.
- Expected output.
- Deadline or expected timing.
- Constraints, risks, and dependencies.
- Links or paths to relevant artifacts.
- Success criteria.
- Done criteria.

## 3. Keep The Original Thread Useful

After delegating, comment on the original issue with:
- Who now owns the work.
- What was handed off.
- Any blocker or approval needed.
- Where to follow progress.
- Any downstream blocker that changes ETA, even when that blocker escalates up
  the receiving team's reporting line.

If you cannot create or reassign issues because of permissions, leave a clear
comment asking the CEO/intake/orchestrator role to route it.

## 4. Use Role Boundaries

Orchestrator, CEO, and intake-style roles may route broad work across the team.
Managers may assign tasks for their own direct reports and may send cross-team
work to peer managers. Specialist roles should mainly execute work in their
domain and delegate work outside that domain.

For common cross-team routing:
- Technical implementation, deployments, schema, data, security, QA, and
  engineering investigation go through the CTO or technical manager.
- Brand, content, copy, campaigns, demand generation, lifecycle, paid media,
  SEO, CRO, and ecommerce trading go through the CMO or marketing manager.
- Work outside known manager scopes escalates to the CEO/intake/orchestrator.

Do not create new agents unless your permissions and task explicitly require it.
Prefer assigning work to an existing appropriate role.
Use `/data/agent-stack/org-chart.json` when you need structured details about
teams, reporting lines, routing keywords, or profile slugs.

## 5. Learn From Handoffs

When a handoff fails, loops, or lands with the wrong owner:
- Record what went wrong in the issue comments.
- Suggest the corrected owner or missing role.
- Update the role's capabilities or instructions when you have permission.
- Escalate recurring routing problems to the CEO/intake/orchestrator role.

## 6. Completion Standard

A delegated task is complete only when the receiving role has enough context to
act, or when the original request is finished and the issue has a clear result,
artifact, or blocker.
