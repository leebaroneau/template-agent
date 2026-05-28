---
created: "2026-05-17"
title: "Agent Stack Seed Knowledge Design"
type: spec
tags: [agent-stack, paperclip, hermes-agent, gbrain, seed-knowledge]
---

# Agent Stack Seed Knowledge Design

## Goal

Create a clean, versioned seed-knowledge pack for the Paperclip + Hermes + GBrain stack without depending on the currently deleted `00_resources/agent-stack` runtime files.

The seed pack gives every Hermes role the same operating baseline, then layers role-specific instructions on top. Notion remains the editable source for rough planning, but runtime learning should come from curated markdown imported into each role's GBrain.

## Recommendation

Use this flow:

```text
Notion/raw docs
  -> curated seed markdown in repo
  -> gbrain import --no-embed into each GBRAIN_HOME
  -> Hermes SOUL/profile rules reference the imported contract
  -> Paperclip agents route work to Hermes profiles
```

This avoids the failure mode where Hermes is simply pointed at a Notion page and asked to infer lasting behavior from loose prose. Behavioral rules need to be explicit, testable, and versioned.

## Scope

This first pass creates only the seed pack and importer. It does not restore, rewrite, or depend on the deleted Docker, Paperclip, or Hermes runtime files currently shown in git status.

Included:

- Base operating model for Paperclip, Hermes, and GBrain.
- Delegation and handoff contract.
- Role matrix for planner, coder, reviewer, and operator.
- Tool and source registry.
- Evaluation checklist.
- Per-role overlays.
- Local/import script for per-profile GBrain seeding.

Deferred:

- Rewiring Hermes `SOUL.md` templates.
- Paperclip agent creation/update scripts.
- Docker Compose runtime integration.
- Automated Notion-to-seed extraction.

## Architecture

The seed pack lives at `00_resources/agent-stack/seed/`.

Base docs are imported into every profile's GBrain. Role overlays are imported only into the matching profile. A role can therefore retrieve the common operating contract plus its own narrower responsibilities.

The importer is intentionally filesystem-oriented:

- It copies selected markdown into a temporary import tree.
- It runs `GBRAIN_HOME=<profile-home> gbrain import <tree> --no-embed`.
- It leaves the source markdown untouched.
- It does not require OpenAI embeddings.

## Success Criteria

- A human can review the seed pack directly in the repo.
- A Hermes profile can be seeded with one command.
- The seed includes explicit delegation behavior, not just background description.
- The seed can be extended from Notion without making Notion the runtime memory layer.
- The change is isolated from unrelated deleted files.

## Sources

- `~/brain/concepts/paperclip.md`
- `~/brain/concepts/hermes-agent.md`
- `~/brain/concepts/gbrain.md`
- `MEMORY.md`, section "Paperclip/Hermes delegation needs explicit operating rules"
- `docs/superpowers/plans/2026-05-15-hermes-gbrain-paperclip-bridge.md`
