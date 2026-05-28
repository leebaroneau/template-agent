# EOS Paperclip Operating System Design

Date: 2026-05-22

## Goal

Create a reusable EOS framework that lets Lee's Paperclip stack use the existing `$100M` framework to choose the highest-leverage opportunities, then use EOS discipline to keep the agent team organized, accountable, and focused.

The boundary is deliberate:

- `$100M` answers: what is the highest-leverage opportunity?
- EOS answers: who owns it, what is the 90-day priority, how is progress measured, what is blocked, and what gets solved this week?
- Paperclip answers: which agent owns the issue, how does work flow through the org chart, which routine wakes the agent, and what needs board approval?

## Verified Context

The existing `$100M` framework already has a reusable framework shape under `00_resources/frameworks/100m-framework/`, plus a separate runtime skill pattern in `leebaroneau/00_repos/template-agent/hermes-runtime/skills/use-100m-framework/SKILL.md`.

Paperclip's current docs and local GBrain page make the runtime constraint clear: agents do not execute passive doctrine. They execute through org structure, assignments, issues, routines, skills, approvals, and heartbeats. That means EOS needs both a shared doctrine library and a later Paperclip/Hermes skill layer.

Official EOS guidance supports this split. EOS is organized around Vision, People, Data, Issues, Process, and Traction. Traction uses Rocks, Level 10 Meetings, Meeting Pulse, IDS, and Scorecards to create weekly and quarterly accountability.

## Recommended Shape

Create the shared framework now:

```text
00_resources/frameworks/eos-framework/
  README.md
  agent.md
  index.md
  log.md
  source-register.md
  source-notes/
    official-eos-sources.md
    paperclip-operating-surface.md
    100m-integration-notes.md
  wiki/
    index.md
    eos-model.md
    ceo-operating-loop.md
    paperclip-operating-contract.md
    workflows/
      100m-to-eos-rocks.md
      weekly-level-10-for-paperclip.md
      quarterly-rock-setting.md
      scorecard-review.md
    templates/
      vision-traction-organizer.md
      rocks.md
      scorecard.md
      issues-list.md
      level-10-agenda.md
      accountability-chart.md
```

Do not add `AGENTS.md`, `CLAUDE.md`, or `MEMORY.md` inside this individual framework folder. The repo-level rules say individual frameworks should manage their own context without extra scaffolding files. `agent.md` is the correct local operating guide.

## Framework Responsibilities

The framework should define a CEO operating model for agent-run teams:

- Translate one selected `$100M` opportunity into one quarterly company Rock.
- Convert that Rock into Paperclip goals, projects, parent issues, child issues, owners, and review cadence.
- Use the Accountability Chart as the design for Paperclip `reportsTo` lines and escalation paths.
- Use the Scorecard as the weekly metric set for leading indicators and execution health.
- Use the Issues List and IDS as the weekly mechanism for blockers, conflicts, and repeated failures.
- Use Level 10 as the recurring CEO or leadership routine, not as an ad hoc chat prompt.
- Preserve source-backed EOS doctrine separately from Lee's Paperclip-specific operating interpretation.

## Paperclip Mapping

| EOS concept | Paperclip primitive | Operating rule |
|---|---|---|
| Vision / V/TO | Company goal plus framework context | Keep the long-range direction stable enough for the CEO agent to prioritize. |
| 90-day Rock | Goal or project | Every active Rock needs one owner, one success metric, and a learning/review date. |
| To-do | Issue | To-dos become assigned Paperclip issues only when they require real follow-through. |
| Issues List | Backlog or issue comments | Problems are captured, prioritized, and solved through IDS instead of being buried in status text. |
| Scorecard | Weekly routine output | Track 5-15 leading indicators and create issues when numbers are off track. |
| Level 10 | Routine | Schedule the weekly review through Paperclip routines so it creates/wakes a real task. |
| Accountability Chart | Org chart / `reportsTo` | Delegation and blocker escalation follow the Paperclip reporting tree. |
| IDS | Issue resolution protocol | Identify the root issue, discuss only enough to choose a fix, then create/assign the solve action. |

## Later Runtime Skill

After the framework is reviewed, create a runtime skill in the template-agent owner repo, probably:

```text
leebaroneau/00_repos/template-agent/hermes-runtime/skills/use-eos-framework/SKILL.md
```

That skill should:

- Trigger when agents mention EOS, Rocks, Scorecard, Level 10, IDS, accountability, quarterly priorities, blockers, or team operating rhythm.
- Read the current Paperclip issue, parent issue, project, goal, comments, and agent role.
- If the task is strategic, apply `$100M` first to confirm the highest-leverage opportunity.
- Use EOS to convert the opportunity into Rocks, metrics, owners, issue trees, and routines.
- Instruct agents to update Paperclip state, not just write prose.
- Capture sanitized `eos-field-learning` proposals when a company-specific lesson should improve shared doctrine.
- Never edit shared framework doctrine directly from a company profile.

The runtime skill is intentionally separate because skills are company-scoped and agent-assigned in Paperclip. The shared framework remains client-neutral; the runtime skill is the deployment layer.

## Source Handling

Use concise source notes and links. Do not mirror large copyrighted EOS pages into this repo unless Lee explicitly provides source files or asks for a formal source import.

Initial sources:

- EOS overview: `https://www.eosworldwide.com/what-is-eos`
- Traction component: `https://www.eosworldwide.com/traction-component`
- Level 10 Meeting: `https://www.eosworldwide.com/level-10-meeting`
- EOS Scorecard: `https://www.eosworldwide.com/blog/the-eos-scorecard-how-to-measure-what-actually-drives-your-business`
- EOS Accountability Chart: `https://www.eosworldwide.com/blog/eos-accountability-chart-how-to-clarify-roles-and-create-real-accountability`
- Paperclip docs manifest: `https://docs.paperclip.ing/content.json`
- Local Paperclip concept: `00_resources/brain/concepts/paperclip.md`
- `$100M` opportunity workflow: `00_resources/frameworks/100m-framework/wiki/workflows/100m-opportunity-engine.md`
- Existing `$100M` runtime skill: `leebaroneau/00_repos/template-agent/hermes-runtime/skills/use-100m-framework/SKILL.md`

## Error Handling

- If an agent lacks the `$100M` framework context, it should mark the opportunity confidence low and create a framework-context gap instead of inventing the diagnosis.
- If there is no clear owner for a Rock, the output is not ready. Create an accountability issue for the CEO or board operator.
- If a Scorecard metric cannot be measured weekly, keep it out of the Scorecard and create an evidence-gathering issue.
- If a Level 10 produces discussion without assigned solve actions, it failed. Create follow-up issues with owners.
- If an issue crosses reporting lines and gets blocked, reassign or escalate through the manager chain instead of cancelling it.

## Verification

For the framework folder:

- `find 00_resources/frameworks/eos-framework -maxdepth 3 -type f | sort`
- `rg -n "T[O]DO|T[B]D|PLACE[H]OLDER" 00_resources/frameworks/eos-framework docs/superpowers/specs/2026-05-22-eos-framework-design.md`
- Manually confirm `00_resources/frameworks/README.md` links the new framework.
- Manually confirm source notes cite the source URL and capture date for each external source.

For the later runtime skill:

- Add guardrails in the template-agent repo proving the EOS skill exists and does not include client-specific data.
- Verify the skill tells agents to use Paperclip issues, goals, routines, parent IDs, goal IDs, and manager escalation.
- Verify the skill composes with `use-100m-framework` rather than replacing it.

## Self-Review

- The design keeps shared doctrine and runtime deployment separate.
- It uses current Paperclip primitives instead of inventing a parallel planning system.
- It preserves the `$100M` framework as the opportunity-selection layer.
- It uses EOS as the operating cadence and accountability layer.
- It avoids unnecessary framework-local scaffolding files.
- It names the later owner repo for the runtime skill without making that change in the control repo.
