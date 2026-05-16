# Learning Protocol Design

## Goal

Add a task-scoped learning loop to the Paperclip Hermes GBrain template and live Coolify deployment without turning the stack into a background crawler.

## Architecture

The template ships a neutral `LEARNING_PROTOCOL.md` beside the existing shared operating protocol files. At container startup, the Paperclip entrypoint mirrors the protocol into the shared `/data` volume and the default Hermes profile. Profile bootstrap and profile sync copy it into each role-specific Hermes profile home.

Agents receive a short capabilities pointer to read the shared protocol. The protocol tells them to use their role-specific `GBRAIN_HOME`, inspect only relevant `/data/instances` files, update `/data/agent-stack/important-information-index.md` when they discover durable pointers, and write concise learned-summary pages with `gbrain put`.

## Scope

- Keep `hermes-runtime/templates/config.yaml` as `{}`.
- Do not wire GBrain MCP into the blank config.
- Do not crawl all `/data`.
- Do not ingest secrets or large runtime databases.
- Use the existing `gbrain` CLI available in the container.
- Apply the runtime files to the current live Coolify `paperclip` container volume after the template is updated.

## Runtime Paths

```text
/data/agent-stack/learning-protocol.md
/data/hermes/LEARNING_PROTOCOL.md
/data/hermes/profiles/<company-role>/LEARNING_PROTOCOL.md
```

## Verification

- Tests prove seeded and profile-synced agents get a learning protocol pointer without duplicates.
- Tests prove profile homes receive `LEARNING_PROTOCOL.md`.
- Shell checks prove the blank template still has an empty Hermes config and no client-specific settings.
- Live checks prove the current Coolify volume has the shared learning protocol file and default Hermes copy.
