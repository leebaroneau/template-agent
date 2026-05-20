# AGENTS.md

This repo is a blank Coolify deploy template for Paperclip, Hermes Agent, and GBrain.

Keep it client-neutral. Do not commit Paperclip instances, Hermes runtime profiles, GBrain data, API keys, client names, client domains, or Coolify deployment-specific values.

When changing the template, run:

```bash
npm test
docker compose --env-file .env.example config --services
```

When changing the image build, also run:

```bash
docker compose -f compose.yaml -f compose.build.yaml --env-file .env.example build
./scripts/audit-blank-image.sh template-agent:local
```
