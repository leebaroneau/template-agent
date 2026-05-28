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
| lite | Needs analysis and critique, user can wait | Claude framing plus analytical pass plus Claude synthesis |
| full | High-stakes architecture, major spend, durable strategy, or correctness risk | Claude framing, deep analysis, independent red-team, Claude final verdict |

## Cognitive Nodes

| Node | Default Model | Job |
|---|---|---|
| Triage | Current runtime default | Decide whether council is justified |
| Strategy | Claude Sonnet 4.6; Opus 4.7 only for high-stakes ambiguous framing | Frame the real problem, decision criteria, constraints, and plan |
| Analytical | DeepSeek V4 Pro by default; use high reasoning effort when the provider supports it | Work through logic, tradeoffs, computations, and solution structure |
| Red-Team | Claude Sonnet 4.6 or Opus 4.7 depending risk | Find flaws, missing assumptions, operational risks, and failure modes |
| Orchestrator | Claude Sonnet 4.6 by default; Opus 4.7 for final verdict only when correctness matters more than cost | Produce the final answer |

## Opus Placement

Use Opus at the beginning when the core risk is solving the wrong problem.
Use Opus at the end when the core risk is accepting the wrong answer.
Use Opus at both ends only when the task is high-stakes and the user has not asked for a fast answer.

## Hermes Execution Pattern

Hermes profile chats default to Claude Haiku. Haiku performs only the Triage role. When council triggers, Haiku should call promoted one-shot Hermes runs with explicit model overrides rather than trying to be the final council brain.

Use only providers and model IDs that are already configured for the profile. Preferred promoted calls:

```bash
hermes chat -q "$PROMPT" --provider openrouter --model anthropic/claude-sonnet-4.6 --toolsets web --quiet --source tool
hermes chat -q "$PROMPT" --provider openrouter --model anthropic/claude-opus-4.7 --toolsets web --quiet --source tool
hermes chat -q "$PROMPT" --provider deepseek --model deepseek-v4-pro --toolsets web --quiet --source tool
```

If direct DeepSeek provider access is unavailable but OpenRouter is configured, use the OpenRouter DeepSeek V4 Pro slug verified on the machine. Do not guess a DeepSeek model slug in a live council run. Avoid `deepseek-chat` and `deepseek-reasoner` for new setups because DeepSeek marks those legacy names for deprecation on 2026-07-24.

## Final Answer Rules

- Return one cohesive answer, not a transcript.
- Mention council use only if useful for trust or cost transparency.
- Include uncertainty when sources, model availability, or live data are uncertain.
- Prefer one strong recommendation over a menu of options.
