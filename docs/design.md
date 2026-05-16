# Blank Template Design

## Goal

Provide a GitHub-cloneable Paperclip + Hermes + GBrain template that can be deployed for a new client in Coolify without carrying any existing client state.

## Shape

- The source repo stores only the deploy recipe, scripts, tests, and neutral templates.
- The Docker image installs Paperclip, Hermes Agent, GBrain, runtime entrypoints, and profile sync.
- Runtime state lives in the Coolify volume mounted at `/data`.
- `paperclip` and `hermes` are separate Compose services using the same image and shared volume.

## Blankness Rules

- No Paperclip instances are committed.
- No Hermes profiles are committed except neutral templates under `hermes-runtime/templates`.
- The default Hermes `config.yaml` is an empty YAML map; runtime/client settings should be added per client after deploy.
- No GBrain homes or PGLite stores are committed.
- No client domains, names, tokens, or Coolify deployment values are committed.
- The Dockerfile removes build-time Hermes bootstrap state and leaves `/data` empty in the final image.

## Verification

Run:

```bash
npm test
docker compose --env-file .env.example config --services
docker compose --env-file .env.example build
./scripts/audit-blank-image.sh paperclip-hermes-gbrain:blank
```

The image audit checks both image metadata/history and `/data` contents.
