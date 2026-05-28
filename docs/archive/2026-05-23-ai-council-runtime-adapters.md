# AI Council Runtime Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cost- and latency-aware AI Council protocol across Hermes profiles, Claude Code, and Codex without using Hermes `moa`.

**Architecture:** One shared protocol defines when to escalate, which cognitive node runs, and how model cost/latency affects routing. Hermes gets the source-controlled implementation in `template-agent`; Claude Code and Codex get thin local skill adapters that reuse the same behavior but map it to their own available tools. Hermes chat defaults remain Claude Haiku; Haiku only triages, and higher-cost Claude/DeepSeek calls are made only when the council gate triggers.

**Tech Stack:** Hermes Agent skills, Hermes `chat -q` per-run model overrides, `template-agent` profile templates, Claude Code skills, Codex/agents skills, Node test runner.

---

## Design Decisions

- Do not enable or call Hermes `moa` / `mixture_of_agents`.
- Hermes default chat model is Claude Haiku for all normal profile conversations.
- Claude Haiku is a triage/router in Hermes. It should not be the final synthesizer for council-grade work.
- Council escalation is explicit and bounded by latency tier:
  - `none`: answer in the current model.
  - `fast`: one promoted Claude pass only.
  - `lite`: Claude framing/synthesis plus DeepSeek analytical pass.
  - `full`: Claude Opus or Sonnet framing, DeepSeek max-depth analysis, independent red-team, promoted Claude synthesis.
- Claude Code and Codex use the same decision tree but different execution mechanisms:
  - Claude Code can use its native model selector or shell out to Hermes CLI when available.
  - Codex can use local subagents when available, or shell out to Hermes CLI when available.
  - If no second-model runner is available, both fall back to an internal simulated council and must label it as simulated in working notes, not in the final answer.

## File Structure

- Modify: `00_repos/template-agent/hermes-runtime/templates/SOUL.default.md`
  - Adds a short council trigger rule that tells Haiku when to use the skill.
- Create: `00_repos/template-agent/hermes-runtime/skills/ai-council/SKILL.md`
  - Hermes-specific skill that uses the shared protocol and Hermes CLI model overrides.
- Create: `00_repos/template-agent/hermes-runtime/skills/ai-council/references/protocol.md`
  - Canonical council gates, roles, model matrix, and output rules.
- Modify: `00_repos/template-agent/scripts/runtime-self-management-guardrail.test.mjs`
  - Asserts the SOUL runtime self-management guard still exists after the SOUL edit.
- Create: `00_repos/template-agent/scripts/ai-council-skill.test.mjs`
  - Validates skill frontmatter, no `moa`, Haiku triage language, and latency gates.
- Modify: `00_repos/template-agent/package.json`
  - Adds the new Node test file to the existing `npm test` coverage automatically if using the current glob, or explicitly if the glob changes.
- Create: `/Users/leebaroneau/.claude/skills/ai-council/SKILL.md`
  - Claude Code local skill adapter.
- Create: `/Users/leebaroneau/.agents/skills/ai-council/SKILL.md`
  - Codex/agents local skill adapter.
- Create: `/Users/leebaroneau/.codex/skills/ai-council/SKILL.md`
  - Codex-local mirror when the current Codex installation searches `.codex/skills` directly.

---

### Task 1: Template-Agent Pipeline Preflight

**Files:**
- Read: `00_repos/template-agent/AGENTS.md`
- Read: `00_repos/template-agent/.github/pipeline-config.yml`
- Create branch in: `00_repos/template-agent`

- [ ] **Step 1: Confirm owner repo and clean state**

Run:

```bash
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent status --short --branch
```

Expected: branch and local changes are visible. Do not overwrite unrelated user changes.

- [ ] **Step 2: Create a GitHub issue in `template-agent`**

Run from `00_repos/template-agent` after confirming GitHub auth:

```bash
gh issue create \
  --repo leebaroneau/template-agent \
  --title "Feature request: add AI Council skill adapters" \
  --label "type:feature" \
  --body "Add a cost- and latency-aware AI Council skill for Hermes profiles plus local Claude/Codex fallback adapters. Hermes chat defaults stay on Claude Haiku; council escalation uses promoted Claude and DeepSeek only when warranted."
```

Expected: GitHub returns a new issue number.

- [ ] **Step 3: Create the pipeline branch**

Replace `123` with the returned issue number.

```bash
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent switch -c story/123-ai-council-skill-adapters
```

Expected: current branch is `story/123-ai-council-skill-adapters`.

---

### Task 2: Add Hermes AI Council Skill

**Files:**
- Create: `00_repos/template-agent/hermes-runtime/skills/ai-council/SKILL.md`
- Create: `00_repos/template-agent/hermes-runtime/skills/ai-council/references/protocol.md`

- [ ] **Step 1: Create the skill directory**

Run:

```bash
mkdir -p /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent/hermes-runtime/skills/ai-council/references
```

Expected: directory exists.

- [ ] **Step 2: Write `references/protocol.md`**

Use this content exactly, adjusting model slugs only after a live `hermes chat --provider openrouter --model <slug> -q "ping"` smoke confirms a better current slug:

```markdown
# AI Council Protocol

## Purpose

Use this protocol when a request is too complex, high-risk, or ambiguous for a single cheap default model, but does not justify Hermes `moa`.

The default response path is still single-model. Council escalation is a cost that must be earned.

## Hard Rules

- Do not use `moa` or `mixture_of_agents`.
- Do not reveal raw council debate unless the user explicitly asks for working notes.
- Do not use expensive or slow models for simple factual answers, small edits, or ordinary chat.
- Treat latency as a first-class constraint. If the user needs an answer now, use the cheapest path that can answer safely.
- If the user says "think properly", "red team this", "architecture", "high stakes", "major decision", "expensive", "legal", "financial", "strategy", or "I can wait", consider escalation.

## Latency Tiers

| Tier | Use When | Max Shape |
|---|---|---|
| none | Simple or low-risk | Current model only |
| fast | Needs better judgment but answer should feel interactive | One promoted Claude pass |
| lite | Needs analysis and critique, user can wait | Claude framing plus DeepSeek analysis plus Claude synthesis |
| full | High-stakes architecture, major spend, durable strategy, or correctness risk | Claude framing, DeepSeek deep analysis, independent red-team, Claude final verdict |

## Cognitive Nodes

| Node | Default Model | Job |
|---|---|---|
| Triage | Current runtime default | Decide whether council is justified |
| Strategy | Claude Sonnet 4.6; Opus 4.7 only for high-stakes ambiguous framing | Frame the real problem, decision criteria, constraints, and plan |
| Analytical | DeepSeek V4 Pro High by default; DeepSeek V4 Pro Max for deep work | Work through logic, tradeoffs, computations, and solution structure |
| Red-Team | Claude Sonnet 4.6 or Opus 4.7 depending risk | Find flaws, missing assumptions, operational risks, and failure modes |
| Orchestrator | Claude Sonnet 4.6 by default; Opus 4.7 for final verdict only when correctness matters more than cost | Produce the final answer |

## Opus Placement

Use Opus at the beginning when the core risk is solving the wrong problem.
Use Opus at the end when the core risk is accepting the wrong answer.
Use Opus at both ends only when the task is high-stakes and the user has not asked for a fast answer.

## Hermes Execution Pattern

Hermes profile chats default to Claude Haiku. Haiku performs only the Triage role. When council triggers, Haiku should call promoted one-shot Hermes runs with explicit model overrides rather than trying to be the final council brain.

Recommended promoted calls:

```bash
hermes chat -q "$PROMPT" --provider openrouter --model anthropic/claude-sonnet-4.6 --toolsets web --quiet --source tool
hermes chat -q "$PROMPT" --provider deepseek --model deepseek-v4-pro --toolsets web --quiet --source tool
```

If direct DeepSeek provider access is unavailable but OpenRouter is configured, use the OpenRouter DeepSeek V4 Pro slug verified on the machine.

## Final Answer Rules

- Return one cohesive answer, not a transcript.
- Mention council use only if useful for trust or cost transparency.
- Include uncertainty when sources, model availability, or live data are uncertain.
- Prefer one strong recommendation over a menu of options.
```

- [ ] **Step 3: Write Hermes `SKILL.md`**

Use this content:

```markdown
---
name: ai-council
description: Use when a Hermes profile receives a high-complexity, high-risk, ambiguous, strategic, or deep-reasoning request that may justify escalation beyond the default cheap chat model.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [reasoning, council, model-routing, cost-control, latency]
    related_skills: [using-paperclip]
---

# AI Council

## Overview

Use this skill to decide whether a request should stay on the default cheap model or be escalated into a small model council. This stack does not use Hermes `moa`; it uses explicit, bounded model calls only when the task earns the cost.

Hermes profile chats default to Claude Haiku. Haiku is the triage/router. It should not act as the final council synthesizer for complex work.

## When to Use

Use this skill when the request involves:

- multi-step strategy or architecture
- major spend, durable decisions, or business risk
- complex logic, quantitative reasoning, or tradeoff analysis
- explicit red-team / critique / "think hard" language
- requests where a bad answer would create meaningful operational rework

Do not use it for routine questions, small edits, simple summaries, or tasks where the user needs the fastest possible reply.

## Procedure

1. Classify latency: `none`, `fast`, `lite`, or `full`.
2. If `none`, answer in the current chat model.
3. If `fast`, run one promoted Claude pass and synthesize.
4. If `lite`, run DeepSeek analysis and promoted Claude synthesis.
5. If `full`, run strategy, analytical, red-team, and final synthesis passes.
6. Return only the final cohesive answer.

## Model Routing

Read `references/protocol.md` before invoking promoted model runs.

Default route:

| Tier | Route |
|---|---|
| none | Current Claude Haiku chat |
| fast | Claude Sonnet 4.6 one-shot |
| lite | Claude Sonnet 4.6 framing + DeepSeek V4 Pro High analysis + Claude Sonnet 4.6 synthesis |
| full | Claude Opus/Sonnet framing + DeepSeek V4 Pro Max analysis + Claude red-team + Claude final |

## Hermes Notes

Use `hermes chat -q` with `--provider`, `--model`, `--quiet`, and `--source tool` for promoted calls. Keep prompts compact and pass only the context each node needs.

Never run gateway lifecycle commands. This skill is about reasoning escalation only.

## Output

Give the user the final answer directly. Do not paste raw node outputs. If latency or cost influenced the route, say so briefly.
```

- [ ] **Step 4: Commit skill files**

Run:

```bash
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent add hermes-runtime/skills/ai-council
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent commit -m "feat: add Hermes AI Council skill"
```

Expected: commit succeeds on the story branch.

---

### Task 3: Add SOUL Trigger Without Breaking Safety Guardrail

**Files:**
- Modify: `00_repos/template-agent/hermes-runtime/templates/SOUL.default.md`
- Modify: `00_repos/template-agent/scripts/runtime-self-management-guardrail.test.mjs`

- [ ] **Step 1: Insert the trigger block after the opening paragraph**

Patch `SOUL.default.md` by adding:

```markdown
## Cognitive Expansion Boundary

Default Hermes chats run on Claude Haiku for cost and latency control. Use Haiku for ordinary conversation, routing, and low-risk work.

When a request is high-complexity, high-risk, strategically ambiguous, expensive to get wrong, or explicitly asks for deeper thinking, load the `ai-council` skill before answering. Do not use Hermes `moa`. Escalate only as far as the latency and risk justify.
```

Expected: the existing `## Runtime Self-Management Boundaries` block remains unchanged.

- [ ] **Step 2: Extend guardrail test**

Add assertions to `scripts/runtime-self-management-guardrail.test.mjs`:

```js
test('SOUL.default.md carries the AI Council trigger without enabling moa', async () => {
  const md = await file('hermes-runtime/templates/SOUL.default.md');
  assert.match(md, /## Cognitive Expansion Boundary/);
  assert.match(md, /Claude Haiku/);
  assert.match(md, /ai-council/);
  assert.match(md, /Do not use Hermes `moa`/);
});
```

- [ ] **Step 3: Run targeted test**

Run:

```bash
npm --prefix /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent test -- scripts/runtime-self-management-guardrail.test.mjs
```

Expected: Node test runner passes the guardrail file. If the package script does not support passing a file, run:

```bash
node --test /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent/scripts/runtime-self-management-guardrail.test.mjs
```

- [ ] **Step 4: Commit SOUL trigger**

Run:

```bash
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent add hermes-runtime/templates/SOUL.default.md scripts/runtime-self-management-guardrail.test.mjs
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent commit -m "feat: add AI Council soul trigger"
```

---

### Task 4: Add Skill Validation Test

**Files:**
- Create: `00_repos/template-agent/scripts/ai-council-skill.test.mjs`

- [ ] **Step 1: Write test file**

Create `scripts/ai-council-skill.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function file(path) {
  return readFile(join(repoRoot, path), 'utf8');
}

test('ai-council skill has valid frontmatter and no moa dependency', async () => {
  const md = await file('hermes-runtime/skills/ai-council/SKILL.md');
  assert.match(md, /^---\n/);
  assert.match(md, /\nname: ai-council\n/);
  assert.match(md, /\ndescription: Use when a Hermes profile receives/);
  assert.match(md, /\n---\n\n# AI Council/);
  assert.match(md, /Claude Haiku/);
  assert.match(md, /references\/protocol\.md/);
  assert.doesNotMatch(md, /mixture_of_agents/);
});

test('ai-council protocol defines cost and latency gates', async () => {
  const md = await file('hermes-runtime/skills/ai-council/references/protocol.md');
  assert.match(md, /Do not use `moa` or `mixture_of_agents`/);
  assert.match(md, /Latency Tiers/);
  assert.match(md, /\| none \|/);
  assert.match(md, /\| fast \|/);
  assert.match(md, /\| lite \|/);
  assert.match(md, /\| full \|/);
  assert.match(md, /Opus at the beginning/);
  assert.match(md, /Opus at the end/);
});
```

- [ ] **Step 2: Run the validation test**

Run:

```bash
node --test /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent/scripts/ai-council-skill.test.mjs
```

Expected: both tests pass.

- [ ] **Step 3: Run full template-agent tests**

Run:

```bash
npm --prefix /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent test
```

Expected: full suite passes.

- [ ] **Step 4: Commit tests**

Run:

```bash
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent add scripts/ai-council-skill.test.mjs
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent commit -m "test: cover AI Council skill contract"
```

---

### Task 5: Install Claude Code Local Adapter

**Files:**
- Create: `/Users/leebaroneau/.claude/skills/ai-council/SKILL.md`

- [ ] **Step 1: Create directory**

Run:

```bash
mkdir -p /Users/leebaroneau/.claude/skills/ai-council
```

- [ ] **Step 2: Write Claude Code adapter**

Create `/Users/leebaroneau/.claude/skills/ai-council/SKILL.md`:

```markdown
---
name: ai-council
description: Use when a Claude Code session faces a high-complexity, high-risk, ambiguous, strategic, or deep-reasoning request that may justify escalation beyond the current model.
---

# AI Council

## Overview

Use this skill to decide whether to answer normally or run a bounded council pass. Do not use Hermes `moa`.

## Decision Gate

Stay single-model for ordinary code edits, simple explanations, small bug fixes, and urgent answers.

Escalate when the request involves architecture, high-stakes strategy, major spend, deep debugging, red-team review, or "think hard" language.

## Claude Code Routing

- Current model handles triage.
- For fast escalation, use Claude Sonnet if available.
- For high-stakes framing or final adjudication, use Opus if available and latency is acceptable.
- If Hermes CLI is available, use `hermes chat -q` with explicit model overrides for DeepSeek analytical passes.
- If no external model runner is available, simulate the council internally: Strategy, Analytical, Red-Team, Final. Keep the simulation compact.

## Latency Tiers

| Tier | Route |
|---|---|
| none | Current Claude Code model |
| fast | Claude-only promoted reasoning |
| lite | Claude framing plus DeepSeek via Hermes CLI when available |
| full | Opus/Sonnet framing, DeepSeek analysis, Claude red-team, Claude final |

## Output Rules

Return the final answer, not raw debate. Mention uncertainty and source gaps plainly. Prefer one strong recommendation.
```

- [ ] **Step 3: Validate file exists**

Run:

```bash
test -f /Users/leebaroneau/.claude/skills/ai-council/SKILL.md
```

Expected: exit code 0.

---

### Task 6: Install Codex Local Adapter

**Files:**
- Create: `/Users/leebaroneau/.agents/skills/ai-council/SKILL.md`
- Create or mirror: `/Users/leebaroneau/.codex/skills/ai-council/SKILL.md`

- [ ] **Step 1: Create directories**

Run:

```bash
mkdir -p /Users/leebaroneau/.agents/skills/ai-council /Users/leebaroneau/.codex/skills/ai-council
```

- [ ] **Step 2: Write Codex adapter to both skill roots**

Use the same content for both paths:

```markdown
---
name: ai-council
description: Use when a Codex session faces a high-complexity, high-risk, ambiguous, strategic, or deep-reasoning request that may justify escalation beyond the current model.
---

# AI Council

## Overview

Use this skill to decide whether to answer normally or run a bounded council pass. Do not use Hermes `moa`.

## Decision Gate

Stay single-model for ordinary code edits, small test fixes, routine explanations, and urgent answers.

Escalate when the request involves architecture, high-stakes strategy, major spend, deep debugging, red-team review, or "think hard" language.

## Codex Routing

- Current Codex model handles triage and normal work.
- If subagents are available, use one fresh subagent for analysis and one for red-team only when the task justifies latency.
- If Hermes CLI is available, use `hermes chat -q` with explicit model overrides for Claude or DeepSeek passes.
- If no external model runner is available, simulate the council internally: Strategy, Analytical, Red-Team, Final. Keep the simulation compact and do not pretend another model was actually called.

## Latency Tiers

| Tier | Route |
|---|---|
| none | Current Codex model |
| fast | Internal critique or one subagent |
| lite | DeepSeek/Claude via Hermes CLI when available, otherwise internal council |
| full | Opus/Sonnet framing, DeepSeek analysis, Claude/Codex red-team, final synthesis |

## Output Rules

Return the final answer, not raw debate. Mention uncertainty and source gaps plainly. Prefer one strong recommendation.
```

- [ ] **Step 3: Validate files exist**

Run:

```bash
test -f /Users/leebaroneau/.agents/skills/ai-council/SKILL.md
test -f /Users/leebaroneau/.codex/skills/ai-council/SKILL.md
```

Expected: both commands exit 0.

---

### Task 7: Verify Runtime Behavior With Pressure Prompts

**Files:**
- No new source files.
- Use installed skills and Hermes template tests.

- [ ] **Step 1: Verify simple prompt does not trigger council**

Prompt:

```text
What does git status show?
```

Expected behavior: answer or run the direct command. No council escalation.

- [ ] **Step 2: Verify ambiguous strategy prompt triggers framing**

Prompt:

```text
We need to decide whether to rebuild our agent orchestration stack around Hermes profiles or keep the current Paperclip adapter shape. Think properly, include risks and cost.
```

Expected behavior: uses AI Council decision gate; at minimum, produces strategy framing before final answer.

- [ ] **Step 3: Verify latency suppresses deep council**

Prompt:

```text
Answer fast: should I use the full council for a simple README wording tweak?
```

Expected behavior: says no and answers directly.

- [ ] **Step 4: Verify no MOA references in local skills**

Run:

```bash
rg -n "mixture_of_agents|\\bmoa\\b" \
  /Users/leebaroneau/.claude/skills/ai-council \
  /Users/leebaroneau/.agents/skills/ai-council \
  /Users/leebaroneau/.codex/skills/ai-council \
  /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent/hermes-runtime/skills/ai-council
```

Expected: references only appear in explicit "do not use" language.

---

### Task 8: Pull Request

**Files:**
- Read: `00_repos/template-agent/.github/PULL_REQUEST_TEMPLATE.md`
- Read: `00_repos/template-agent/CONTRIBUTING.md`
- Read: `00_repos/template-agent/.github/workflows/pr.yml`

- [ ] **Step 1: Confirm tests pass**

Run:

```bash
npm --prefix /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent test
```

Expected: full suite passes.

- [ ] **Step 2: Push branch**

Run:

```bash
git -C /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent push -u origin HEAD
```

Expected: branch pushed.

- [ ] **Step 3: Open PR**

Use the template-agent PR template and include `Fixes #123`, replacing `123` with the created issue number.

Run:

```bash
gh pr create \
  --repo leebaroneau/template-agent \
  --title "Feature request: add AI Council skill adapters" \
  --body-file /tmp/ai-council-pr-body.md
```

Expected: PR opens and Pipeline Core checks can associate the branch with the issue.

---

## Self-Review

- Spec coverage: Hermes, Claude Code, Codex, no-MOA, Haiku default, latency, cost, Opus placement, and verification are covered.
- Placeholder scan: no task depends on an unspecified file path.
- Type consistency: all skill names use `ai-council`; all Hermes template paths point to `00_repos/template-agent`.
- Known implementation risk: exact DeepSeek V4 model slug may differ by provider. The plan requires a live smoke before changing the recommended slug from the protocol default.

