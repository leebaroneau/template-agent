# EOS Paperclip Operating System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable EOS framework that helps Lee's Paperclip stack turn `$100M` opportunities into organized Rocks, issues, owners, scorecards, routines, and escalations.

**Architecture:** Create a shared framework under `00_resources/frameworks/eos-framework/` that holds source-backed doctrine, Paperclip operating interpretation, workflows, and templates. Keep runtime deployment separate: the later Paperclip/Hermes skill belongs in the template-agent repo and should consume this framework rather than duplicate it.

**Tech Stack:** Markdown framework library, local repo resource conventions, official EOS docs, Paperclip docs, existing `$100M` framework pages.

---

## File Structure

- Create `00_resources/frameworks/eos-framework/README.md` as the framework overview and folder contract.
- Create `00_resources/frameworks/eos-framework/agent.md` as the local operating guide for agents using this framework.
- Create `00_resources/frameworks/eos-framework/index.md` as the navigation entrypoint.
- Create `00_resources/frameworks/eos-framework/log.md` as the lifecycle log.
- Create `00_resources/frameworks/eos-framework/source-register.md` as the source register with capture dates.
- Create `00_resources/frameworks/eos-framework/source-notes/official-eos-sources.md` for concise official EOS source notes.
- Create `00_resources/frameworks/eos-framework/source-notes/paperclip-operating-surface.md` for Paperclip execution primitives.
- Create `00_resources/frameworks/eos-framework/source-notes/100m-integration-notes.md` for the `$100M` integration boundary.
- Create `00_resources/frameworks/eos-framework/wiki/index.md` for doctrine navigation.
- Create `00_resources/frameworks/eos-framework/wiki/eos-model.md` for the Six Key Components and operating interpretation.
- Create `00_resources/frameworks/eos-framework/wiki/ceo-operating-loop.md` for annual, quarterly, weekly, and daily cadence.
- Create `00_resources/frameworks/eos-framework/wiki/paperclip-operating-contract.md` for EOS-to-Paperclip rules.
- Create `00_resources/frameworks/eos-framework/wiki/workflows/100m-to-eos-rocks.md`.
- Create `00_resources/frameworks/eos-framework/wiki/workflows/weekly-level-10-for-paperclip.md`.
- Create `00_resources/frameworks/eos-framework/wiki/workflows/quarterly-rock-setting.md`.
- Create `00_resources/frameworks/eos-framework/wiki/workflows/scorecard-review.md`.
- Create `00_resources/frameworks/eos-framework/wiki/templates/vision-traction-organizer.md`.
- Create `00_resources/frameworks/eos-framework/wiki/templates/rocks.md`.
- Create `00_resources/frameworks/eos-framework/wiki/templates/scorecard.md`.
- Create `00_resources/frameworks/eos-framework/wiki/templates/issues-list.md`.
- Create `00_resources/frameworks/eos-framework/wiki/templates/level-10-agenda.md`.
- Create `00_resources/frameworks/eos-framework/wiki/templates/accountability-chart.md`.
- Modify `00_resources/frameworks/README.md` to link the new framework.

### Task 1: Create Framework Directories

**Files:**
- Create directories under `00_resources/frameworks/eos-framework/`

- [ ] **Step 1: Create the directory tree**

Run:

```bash
mkdir -p 00_resources/frameworks/eos-framework/source-notes
mkdir -p 00_resources/frameworks/eos-framework/wiki/workflows
mkdir -p 00_resources/frameworks/eos-framework/wiki/templates
```

- [ ] **Step 2: Verify the directories exist**

Run:

```bash
find 00_resources/frameworks/eos-framework -maxdepth 3 -type d | sort
```

Expected output includes:

```text
00_resources/frameworks/eos-framework
00_resources/frameworks/eos-framework/source-notes
00_resources/frameworks/eos-framework/wiki
00_resources/frameworks/eos-framework/wiki/templates
00_resources/frameworks/eos-framework/wiki/workflows
```

### Task 2: Add Root Framework Files

**Files:**
- Create `README.md`
- Create `agent.md`
- Create `index.md`
- Create `log.md`
- Create `source-register.md`

- [ ] **Step 1: Write root files**

Use `apply_patch` to add the five root files. The files must state:

- The framework purpose: `$100M` selects leverage, EOS runs execution discipline, Paperclip carries work.
- The folder contract: source notes and wiki pages, no large mirrored EOS copyrighted sources.
- The agent rules: read the source notes before applying workflows, keep company-specific execution in company scope, and use Paperclip primitives when translating to runtime.
- The source register with source URLs and captured date `2026-05-22`.
- The lifecycle log entry for initial creation.

- [ ] **Step 2: Verify root file coverage**

Run:

```bash
for file in README.md agent.md index.md log.md source-register.md; do test -f "00_resources/frameworks/eos-framework/$file" || exit 1; done
```

Expected: exit code `0`.

### Task 3: Add Source Notes

**Files:**
- Create `source-notes/official-eos-sources.md`
- Create `source-notes/paperclip-operating-surface.md`
- Create `source-notes/100m-integration-notes.md`

- [ ] **Step 1: Write source notes**

Use `apply_patch` to add three source-note files:

- `official-eos-sources.md` summarizes only source-backed EOS concepts and cites official EOS URLs.
- `paperclip-operating-surface.md` summarizes Paperclip's org chart, issues, routines, skills, approvals, and heartbeat contract using Paperclip docs plus the local GBrain Paperclip page.
- `100m-integration-notes.md` explains that the `$100M` opportunity workflow selects the leverage opportunity and EOS converts it into Rocks, metrics, and execution cadence.

- [ ] **Step 2: Verify source citation coverage**

Run:

```bash
rg -n "Source:|https://" 00_resources/frameworks/eos-framework/source-notes
```

Expected: every source-note file has at least one source URL or local source citation.

### Task 4: Add Doctrine Pages

**Files:**
- Create `wiki/index.md`
- Create `wiki/eos-model.md`
- Create `wiki/ceo-operating-loop.md`
- Create `wiki/paperclip-operating-contract.md`

- [ ] **Step 1: Write doctrine pages**

Use `apply_patch` to add the four wiki pages. They must define:

- The EOS model and how each component maps to Paperclip.
- The CEO operating loop from annual direction to quarterly Rocks to weekly Level 10 to daily issue execution.
- The Paperclip operating contract: goals, projects, issues, parent IDs, goal IDs, routines, org chart, escalation, and approvals.
- Navigation to all workflows and templates.

- [ ] **Step 2: Verify key terms exist**

Run:

```bash
rg -n "Vision|People|Data|Issues|Process|Traction|Rocks|Level 10|Scorecard|Paperclip|reportsTo|routine" 00_resources/frameworks/eos-framework/wiki
```

Expected: each doctrine page appears in the output.

### Task 5: Add Workflows

**Files:**
- Create `wiki/workflows/100m-to-eos-rocks.md`
- Create `wiki/workflows/weekly-level-10-for-paperclip.md`
- Create `wiki/workflows/quarterly-rock-setting.md`
- Create `wiki/workflows/scorecard-review.md`

- [ ] **Step 1: Write workflow pages**

Use `apply_patch` to add four workflow pages:

- `100m-to-eos-rocks.md`: converts a selected `$100M` opportunity into one Rock, owner, metric, issue tree, and learning date.
- `weekly-level-10-for-paperclip.md`: defines the Paperclip routine and issue flow for a weekly Level 10.
- `quarterly-rock-setting.md`: defines the quarterly selection, owner assignment, and issue-tree creation loop.
- `scorecard-review.md`: defines the weekly 5-15 metric review and issue creation rules when numbers are off track.

- [ ] **Step 2: Verify workflows reference Paperclip state changes**

Run:

```bash
rg -n "goal|project|issue|parent|owner|routine|metric|blocked|escalat" 00_resources/frameworks/eos-framework/wiki/workflows
```

Expected: each workflow appears in the output.

### Task 6: Add Templates

**Files:**
- Create `wiki/templates/vision-traction-organizer.md`
- Create `wiki/templates/rocks.md`
- Create `wiki/templates/scorecard.md`
- Create `wiki/templates/issues-list.md`
- Create `wiki/templates/level-10-agenda.md`
- Create `wiki/templates/accountability-chart.md`

- [ ] **Step 1: Write template pages**

Use `apply_patch` to add six templates with fillable sections. The templates must be practical for a Paperclip CEO or manager agent and must include ownership, evidence, metric, issue, and review fields where relevant.

- [ ] **Step 2: Verify templates avoid unsupported runtime claims**

Run:

```bash
rg -n "automatically|always creates|guarantees|secret|API key" 00_resources/frameworks/eos-framework/wiki/templates
```

Expected: no unsupported automation or secret-handling claims. Legitimate matches must be reviewed manually.

### Task 7: Update Framework Index

**Files:**
- Modify `00_resources/frameworks/README.md`

- [ ] **Step 1: Add the EOS framework to the framework table**

Use `apply_patch` to add:

```markdown
| [`eos-framework/`](eos-framework/) | EOS framework for Paperclip teams: turns `$100M` opportunities into Rocks, scorecards, issues, routines, and accountability. |
```

- [ ] **Step 2: Verify link exists**

Run:

```bash
rg -n "eos-framework|EOS framework" 00_resources/frameworks/README.md
```

Expected: the new table row appears.

### Task 8: Final Verification

**Files:**
- All new and modified files

- [ ] **Step 1: Verify file tree**

Run:

```bash
find 00_resources/frameworks/eos-framework -maxdepth 3 -type f | sort
```

Expected: all root, source-note, wiki, workflow, and template files are listed.

- [ ] **Step 2: Run placeholder scan**

Run:

```bash
rg -n "T[O]DO|T[B]D|PLACE[H]OLDER" 00_resources/frameworks/eos-framework docs/superpowers/specs/2026-05-22-eos-framework-design.md docs/superpowers/plans/2026-05-22-eos-framework.md
```

Expected: no matches.

- [ ] **Step 3: Verify source and integration terms**

Run:

```bash
rg -n "eosworldwide.com|docs.paperclip.ing|100m-framework|use-100m-framework|2026-05-22" 00_resources/frameworks/eos-framework
```

Expected: matches exist in source notes, source register, and framework overview files.

- [ ] **Step 4: Note git status limitation**

Run:

```bash
git status --short
```

Expected in this checkout: command may fail with `fatal: not a git repository`. If it fails, record that commits were not possible from this workspace.
