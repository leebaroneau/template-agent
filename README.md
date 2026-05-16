# Paperclip Hermes GBrain

Blank Coolify-ready template for running Paperclip with Hermes Agent and GBrain.

This repo is intentionally client-neutral. It should contain the deploy recipe only. Paperclip projects, Hermes profiles, GBrain stores, API keys, and client data are created at runtime inside the Coolify volume mounted at `/data`.

## Services

- `paperclip` runs Paperclip on port `3100`.
- `hermes` runs the Hermes dashboard on port `9119`.
- Both services share the `paperclip-data` volume at `/data`.

## Local Smoke Test

```bash
cp .env.example .env
./scripts/local-up.sh
```

Then open:

- Paperclip: `http://localhost:3100`
- Hermes: `http://localhost:9119`

Stop it with:

```bash
./scripts/local-down.sh
```

## Coolify Setup

1. Create a new Docker Compose app in Coolify from this GitHub repo.
2. Set the public domains you want to use, usually:
   - `paperclip.<client-domain>`
   - `hermes.<client-domain>`
3. Generate starter environment values:

```bash
./scripts/coolify-env.sh client.example.com
```

4. Paste the generated values into Coolify and replace the example domain with the real client domain.
5. Deploy.

For Coolify, make sure these values are not left as examples:

- `PAPERCLIP_PUBLIC_URL`
- `PAPERCLIP_ALLOWED_HOSTNAMES`
- `PAPERCLIP_HOSTNAME`
- `HERMES_HOSTNAME`

## Blank Image Audit

After a local build, audit the image before publishing or reusing it:

```bash
docker compose --env-file .env.example build
./scripts/audit-blank-image.sh paperclip-hermes-gbrain:blank
```

The audit fails if the image contains runtime state under `/data`, Lee/client deployment markers, Coolify build metadata, or token-looking secrets in image metadata.

## Runtime Data

The Dockerfile deliberately cleans `/data` during build. Runtime data appears only after a container starts with the `paperclip-data` volume mounted.

The default Hermes config is intentionally empty. The template only bootstraps neutral profile files, installs GBrain skills into Hermes profiles, and creates a separate GBrain home for each synced role.

Profile sync is available in the `paperclip` container. Enable it with `PROFILE_SYNC_ENABLED=1` and a `PAPERCLIP_PROFILE_SYNC_API_KEY` when you want Paperclip roles to be patched to their own Hermes profile and GBrain home.

To reset a local test install:

```bash
docker compose --env-file .env.example down -v
```

Do not commit generated runtime folders such as `data/`, `instances/`, `hermes/`, or `gbrain/`.
