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
4. If `lite`, run analytical and promoted Claude synthesis passes.
5. If `full`, run strategy, analytical, red-team, and final synthesis passes.
6. Return only the final cohesive answer.

## Model Routing

Read `references/protocol.md` before invoking promoted model runs.

Default route:

| Tier | Route |
|---|---|
| none | Current Claude Haiku chat |
| fast | Claude Sonnet 4.6 one-shot |
| lite | Claude Sonnet 4.6 framing + configured DeepSeek reasoning model + Claude Sonnet 4.6 synthesis |
| full | Claude Opus/Sonnet framing + configured DeepSeek deep-reasoning model + Claude red-team + Claude final |

## Hermes Notes

Use `hermes chat -q` with `--provider`, `--model`, `--quiet`, and `--source tool` for promoted calls. Keep prompts compact and pass only the context each node needs.

Never run gateway lifecycle commands. This skill is about reasoning escalation only.

## Output

Give the user the final answer directly. Do not paste raw node outputs. If latency or cost influenced the route, say so briefly.
