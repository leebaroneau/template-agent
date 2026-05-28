# Hermes GBrain Paperclip Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fresh, reproducible Hermes + GBrain + Paperclip stack that can be deployed as a new Coolify Docker Compose app without touching the existing manual Hermes container at `hermes.leebarone.dev`.

**Architecture:** One Paperclip container orchestrates work. One Hermes runtime container owns Hermes Agent, GBrain, role profiles, and a single profile-aware HTTP bridge. Paperclip agents use the built-in `http` adapter to call the bridge with `payloadTemplate.profile`. The bridge runs Hermes with `HERMES_HOME=/opt/data/hermes/profiles/<profile>` and `GBRAIN_HOME=/opt/data/gbrain/<profile>`, giving each role isolated Hermes and GBrain state inside the same runtime container.

**Tech Stack:** Docker Compose, Coolify, Node.js 22, Paperclip `paperclipai@2026.513.0`, Hermes Agent installer from `NousResearch/hermes-agent`, GBrain from `garrytan/gbrain`, Bun, Express-free Node HTTP bridge, PGLite-backed GBrain homes. Build args pin the exact Paperclip version and upstream Hermes/GBrain refs so a working deployment can be rebuilt from the same inputs.

---

## Non-Negotiables

- [ ] Do not restart, rebuild, delete, redeploy, or replace the existing `hermes` container.
- [ ] Do not call Coolify deploy/restart/delete against the existing Hermes app or routing stub.
- [ ] Use a fresh Compose project name and fresh Docker volumes for this stack.
- [ ] Keep Paperclip and Hermes in separate containers.
- [ ] Use one bridge for the whole Hermes runtime container, not one bridge per profile.
- [ ] Keep profile isolation at the environment and data-directory level: no role should write into the default Hermes profile.
- [ ] Confirm with Lee before any command that will create or deploy a new Coolify app.

---

## Phase 1: Align Existing Docs

- [ ] Update `00_resources/agent-stack/docs/design.md`.
  - Replace the older "one stack = one agent service + one brain service" design with the agreed "one Paperclip + one Hermes runtime + one profile-aware bridge" design.
  - State that one-container-per-role is intentionally deferred.
  - State that the existing `leebarone/paperclip-hermes-gbrain-data/` host folder (formerly `leebarone/hermes/` until 2026-05-19) is not part of this deployment.
  - State that GBrain isolation is per `GBRAIN_HOME`, not per separate brain container.

- [ ] Add `00_resources/agent-stack/README.md`.
  - Include the mental model:
    ```text
    paperclip
      -> http adapter
      -> hermes-runtime:8787/run
      -> profile-aware bridge
      -> HERMES_HOME=/opt/data/hermes/profiles/<role>
      -> GBRAIN_HOME=/opt/data/gbrain/<role>
    ```
  - Include local start, local stop, local logs, bridge health, and Paperclip URL commands.
  - Include a warning that `hermes.leebarone.dev` remains the existing manual container until Lee explicitly chooses to migrate traffic.

- [ ] Add `00_resources/agent-stack/.env.example`.
  - Required keys:
    ```bash
    COMPOSE_PROJECT_NAME=agent-stack
    PAPERCLIP_PORT=3100
    HERMES_BRIDGE_PORT=8787
    HERMES_BRIDGE_TOKEN=change-me-local-only
    HERMES_PROFILES=planner,coder,reviewer,operator
    PAPERCLIP_VERSION=2026.513.0
    HERMES_AGENT_REF=main
    GBRAIN_REF=master
    PAPERCLIP_TELEMETRY_DISABLED=1
    OPENAI_API_KEY=
    ANTHROPIC_API_KEY=
    OPENROUTER_API_KEY=
    ```
  - Leave provider keys empty in the committed example.
  - After the first successful smoke test, replace `HERMES_AGENT_REF` and `GBRAIN_REF` in the real deployment env with commit SHAs from:
    ```bash
    git ls-remote https://github.com/NousResearch/hermes-agent.git main
    git ls-remote https://github.com/garrytan/gbrain.git master
    ```

---

## Phase 2: Compose Scaffold

- [ ] Add `00_resources/agent-stack/compose.yaml`.
  - Define service `paperclip`.
    - Build from `./paperclip/Dockerfile`.
    - Pass build arg:
      ```yaml
      PAPERCLIP_VERSION: ${PAPERCLIP_VERSION:-2026.513.0}
      ```
    - Publish `${PAPERCLIP_PORT:-3100}:3100`.
    - Mount named volume `paperclip-data:/data`.
    - Set:
      ```yaml
      PAPERCLIP_HOME: /data
      PAPERCLIP_TELEMETRY_DISABLED: "1"
      PAPERCLIP_BIND: lan
      PORT: "3100"
      ```
    - Depend on `hermes-runtime` health.
  - Define service `hermes-runtime`.
    - Build from `./hermes-runtime/Dockerfile`.
    - Pass build args:
      ```yaml
      HERMES_AGENT_REF: ${HERMES_AGENT_REF:-main}
      GBRAIN_REF: ${GBRAIN_REF:-master}
      ```
    - Do not publish bridge port by default; use `expose: ["8787"]`.
    - Mount named volume `hermes-runtime-data:/opt/data`.
    - Set:
      ```yaml
      HERMES_DATA_ROOT: /opt/data/hermes
      GBRAIN_DATA_ROOT: /opt/data/gbrain
      HERMES_BRIDGE_HOST: 0.0.0.0
      HERMES_BRIDGE_PORT: "8787"
      HERMES_BRIDGE_TOKEN: ${HERMES_BRIDGE_TOKEN}
      HERMES_PROFILES: ${HERMES_PROFILES:-planner,coder,reviewer,operator}
      ```
    - Pass provider API keys through from `.env`.
    - Add healthcheck:
      ```bash
      node /opt/hermes-runtime/bridge/healthcheck.mjs
      ```
  - Define named volumes:
    ```yaml
    volumes:
      paperclip-data:
      hermes-runtime-data:
    ```

- [ ] Add `00_resources/agent-stack/scripts/validate-env.sh`.
  - Fail when `HERMES_BRIDGE_TOKEN` is empty or equals `change-me-local-only` outside local mode.
  - Print a warning when no LLM provider key is set.
  - Print the exact Compose project name and service names.

- [ ] Add `00_resources/agent-stack/scripts/local-up.sh`.
  - Run:
    ```bash
    docker compose --env-file .env up -d --build
    ```
  - Print:
    ```text
    Paperclip: http://localhost:${PAPERCLIP_PORT:-3100}
    Bridge health: docker compose exec hermes-runtime node /opt/hermes-runtime/bridge/healthcheck.mjs
    ```

- [ ] Add `00_resources/agent-stack/scripts/local-down.sh`.
  - Run:
    ```bash
    docker compose --env-file .env down
    ```
  - Do not remove volumes.

- [ ] Add `00_resources/agent-stack/scripts/local-logs.sh`.
  - Run:
    ```bash
    docker compose --env-file .env logs -f --tail=200 "$@"
    ```

---

## Phase 3: Hermes Runtime Image

- [ ] Add `00_resources/agent-stack/hermes-runtime/Dockerfile`.
  - Base image: `node:22-bookworm-slim`.
  - Declare build args:
    ```dockerfile
    ARG HERMES_AGENT_REF=main
    ARG GBRAIN_REF=master
    ```
  - Install OS packages:
    ```bash
    ca-certificates curl git jq ripgrep ffmpeg bash python3 python3-venv python3-pip build-essential tini
    ```
  - Install Bun using the official install script and symlink `bun` into `/usr/local/bin`.
  - Install Hermes Agent with the documented installer:
    ```bash
    curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_AGENT_REF}/scripts/install.sh" | bash -s -- --skip-browser
    ```
  - Pin the installed Hermes checkout to the same ref:
    ```bash
    cd /root/.hermes/hermes-agent
    git fetch --depth 1 origin "${HERMES_AGENT_REF}"
    git checkout FETCH_HEAD
    ./venv/bin/python -m pip install -e ".[all]" || ./venv/bin/python -m pip install -e .
    ```
  - Symlink the installed Hermes launcher:
    ```bash
    ln -sf /root/.local/bin/hermes /usr/local/bin/hermes
    ```
  - Clone GBrain into `/opt/gbrain` from `https://github.com/garrytan/gbrain.git`.
  - Pin the GBrain checkout:
    ```bash
    cd /opt/gbrain
    git fetch --depth 1 origin "${GBRAIN_REF}"
    git checkout FETCH_HEAD
    ```
  - Run:
    ```bash
    cd /opt/gbrain && bun install && bun link
    ```
  - Copy bridge source into `/opt/hermes-runtime/bridge`.
  - Copy profile templates into `/opt/hermes-runtime/templates`.
  - Entrypoint:
    ```bash
    /usr/bin/tini -- /opt/hermes-runtime/entrypoint.sh
    ```

- [ ] Add `00_resources/agent-stack/hermes-runtime/entrypoint.sh`.
  - Run `/opt/hermes-runtime/scripts/bootstrap-profiles.sh`.
  - Verify:
    ```bash
    hermes --version
    gbrain --version
    ```
  - Start bridge:
    ```bash
    exec node /opt/hermes-runtime/bridge/src/server.mjs
    ```

- [ ] Add `00_resources/agent-stack/hermes-runtime/scripts/bootstrap-profiles.sh`.
  - Split `HERMES_PROFILES` on commas.
  - For each profile:
    - Create `/opt/data/hermes/profiles/<profile>`.
    - Create `/opt/data/gbrain/<profile>`.
    - If no Hermes config exists, copy `templates/config.yaml` to the profile.
    - If no `SOUL.md` exists, copy `templates/SOUL.<profile>.md` when present, otherwise `templates/SOUL.default.md`.
    - If no `.env` exists, write provider keys inherited from container env.
    - Run:
      ```bash
      GBRAIN_HOME=/opt/data/gbrain/<profile> gbrain init --pglite
      ```
      only when `/opt/data/gbrain/<profile>/.gbrain/config.json` does not exist.
  - Never create or use `/opt/data/hermes/default` as an active role.

- [ ] Add profile templates.
  - `00_resources/agent-stack/hermes-runtime/templates/config.yaml`
  - `00_resources/agent-stack/hermes-runtime/templates/SOUL.default.md`
  - `00_resources/agent-stack/hermes-runtime/templates/SOUL.planner.md`
  - `00_resources/agent-stack/hermes-runtime/templates/SOUL.coder.md`
  - `00_resources/agent-stack/hermes-runtime/templates/SOUL.reviewer.md`
  - `00_resources/agent-stack/hermes-runtime/templates/SOUL.operator.md`

---

## Phase 4: Profile-Aware Bridge, Test First

- [ ] Add bridge package files.
  - `00_resources/agent-stack/hermes-runtime/bridge/package.json`
  - `00_resources/agent-stack/hermes-runtime/bridge/src/config.mjs`
  - `00_resources/agent-stack/hermes-runtime/bridge/src/server.mjs`
  - `00_resources/agent-stack/hermes-runtime/bridge/src/run-hermes.mjs`
  - `00_resources/agent-stack/hermes-runtime/bridge/healthcheck.mjs`
  - `00_resources/agent-stack/hermes-runtime/bridge/test/server.test.mjs`
  - `00_resources/agent-stack/hermes-runtime/bridge/test/run-hermes.test.mjs`

- [ ] Write failing bridge tests first using Node's built-in test runner.
  - Command:
    ```bash
    cd 00_resources/agent-stack/hermes-runtime/bridge && node --test
    ```
  - Required tests:
    - `GET /health` returns `200` with `{ ok: true, profiles: [...] }`.
    - `POST /run` returns `401` when `HERMES_BRIDGE_TOKEN` is set and the bearer token is missing.
    - `POST /run` returns `400` for a profile not listed in `HERMES_PROFILES`.
    - `POST /run` passes `HERMES_HOME=/opt/data/hermes/profiles/coder` to the Hermes child process for `profile=coder`.
    - `POST /run` passes `GBRAIN_HOME=/opt/data/gbrain/coder` to the Hermes child process for `profile=coder`.
    - `POST /run` returns `504` with `timedOut=true` when the child exceeds `timeoutMs`.

- [ ] Implement `config.mjs`.
  - Parse:
    ```js
    HERMES_DATA_ROOT
    GBRAIN_DATA_ROOT
    HERMES_BRIDGE_HOST
    HERMES_BRIDGE_PORT
    HERMES_BRIDGE_TOKEN
    HERMES_PROFILES
    HERMES_BIN
    ```
  - Normalize profiles to lowercase slugs matching `/^[a-z0-9_-]+$/`.
  - Default `HERMES_BIN` to `hermes`.

- [ ] Implement `run-hermes.mjs`.
  - Input:
    ```js
    {
      profile,
      prompt,
      context,
      runId,
      timeoutMs
    }
    ```
  - Derive prompt from `prompt` when present, otherwise from Paperclip `context`.
  - Spawn:
    ```bash
    hermes chat -q "$PROMPT" --source tool --yolo
    ```
  - Set child env:
    ```bash
    HERMES_HOME=/opt/data/hermes/profiles/<profile>
    GBRAIN_HOME=/opt/data/gbrain/<profile>
    PAPERCLIP_RUN_ID=<runId>
    ```
  - Capture stdout and stderr with a 1 MB cap each.
  - Return `{ exitCode, signal, timedOut, stdout, stderr }`.

- [ ] Implement `server.mjs`.
  - `GET /health`
    - Return profiles, bridge version, and whether `hermes` and `gbrain` are on PATH.
  - `HEAD /run`
    - Return `204` so Paperclip's HTTP adapter environment probe can succeed.
  - `POST /run`
    - Validate bearer token when `HERMES_BRIDGE_TOKEN` is set.
    - Accept Paperclip HTTP adapter body:
      ```json
      {
        "profile": "coder",
        "agentId": "paperclip-agent-id",
        "runId": "paperclip-run-id",
        "context": {}
      }
      ```
    - Also accept direct debug body:
      ```json
      {
        "profile": "coder",
        "prompt": "Say hello",
        "timeoutMs": 300000
      }
      ```
    - Return JSON with the Hermes run result.

- [ ] Implement `healthcheck.mjs`.
  - GET `http://127.0.0.1:${HERMES_BRIDGE_PORT:-8787}/health`.
  - Exit `0` only when `ok === true`.

---

## Phase 5: Paperclip Container and Agent Seeding

- [ ] Add `00_resources/agent-stack/paperclip/Dockerfile`.
  - Base image: `node:22-bookworm-slim`.
  - Declare build arg:
    ```dockerfile
    ARG PAPERCLIP_VERSION=2026.513.0
    ```
  - Install OS packages:
    ```bash
    ca-certificates curl git bash tini
    ```
  - Install Paperclip:
    ```bash
    npm install -g "paperclipai@${PAPERCLIP_VERSION}"
    ```
  - Copy `entrypoint.sh`.
  - Entrypoint:
    ```bash
    /usr/bin/tini -- /opt/paperclip/entrypoint.sh
    ```

- [ ] Add `00_resources/agent-stack/paperclip/entrypoint.sh`.
  - Ensure `/data` exists.
  - Export:
    ```bash
    PAPERCLIP_HOME=/data
    PAPERCLIP_TELEMETRY_DISABLED=1
    ```
  - If `/data/.onboarded` does not exist, run:
    ```bash
    paperclipai onboard --yes --bind lan --data-dir /data
    touch /data/.onboarded
    ```
  - Start:
    ```bash
    exec paperclipai run --data-dir /data --bind "${PAPERCLIP_BIND:-lan}"
    ```

- [ ] Add `00_resources/agent-stack/paperclip/seed-agents.mjs`.
  - Read `PAPERCLIP_API_BASE`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `HERMES_BRIDGE_URL`, and `HERMES_BRIDGE_TOKEN`.
  - Create or update four Paperclip agents with `POST /api/companies/:companyId/agents` and `PATCH /api/agents/:id`.
  - Agent configs:
    ```json
    {
      "adapterType": "http",
      "adapterConfig": {
        "url": "http://hermes-runtime:8787/run",
        "method": "POST",
        "timeoutMs": 1800000,
        "headers": {
          "authorization": "Bearer <HERMES_BRIDGE_TOKEN>"
        },
        "payloadTemplate": {
          "profile": "coder"
        }
      },
      "runtimeConfig": {
        "heartbeat": {
          "enabled": false,
          "wakeOnDemand": true
        }
      }
    }
    ```
  - Create roles:
    - `planner` -> profile `planner`
    - `coder` -> profile `coder`
    - `reviewer` -> profile `reviewer`
    - `operator` -> profile `operator`
  - Print a table with agent name, profile, adapter type, and agent id.

- [ ] Document the Paperclip HTTP adapter tradeoff in `README.md`.
  - Paperclip's built-in `http` adapter sends `agentId`, `runId`, and `context` to the bridge.
  - The adapter records HTTP success/failure, not streaming Hermes stdout.
  - Detailed Hermes logs are available from `docker compose logs hermes-runtime`.
  - Later upgrade path: replace the HTTP adapter with a custom Paperclip adapter/plugin when first-class run-log streaming is worth the extra maintenance.

---

## Phase 6: Local Verification on Colima

- [ ] From `00_resources/agent-stack`, create a real `.env` from `.env.example`.
  - Set a non-default `HERMES_BRIDGE_TOKEN`.
  - Set at least one provider key.

- [ ] Validate Compose config.
  ```bash
  docker compose --env-file .env config >/tmp/agent-stack-compose.rendered.yaml
  ```
  - Expected: command exits `0`.

- [ ] Run bridge unit tests.
  ```bash
  cd 00_resources/agent-stack/hermes-runtime/bridge && node --test
  ```
  - Expected: all tests pass.

- [ ] Build images.
  ```bash
  cd 00_resources/agent-stack && docker compose --env-file .env build
  ```
  - Expected: `paperclip` and `hermes-runtime` images build.

- [ ] Start local stack.
  ```bash
  cd 00_resources/agent-stack && docker compose --env-file .env up -d
  ```
  - Expected: both services become healthy.

- [ ] Check bridge health from inside Compose.
  ```bash
  cd 00_resources/agent-stack
  docker compose --env-file .env exec hermes-runtime node /opt/hermes-runtime/bridge/healthcheck.mjs
  ```
  - Expected: exit `0`.

- [ ] Check profiles exist.
  ```bash
  cd 00_resources/agent-stack
  docker compose --env-file .env exec hermes-runtime bash -lc 'for p in planner coder reviewer operator; do test -d "/opt/data/hermes/profiles/$p" && test -d "/opt/data/gbrain/$p"; done'
  ```
  - Expected: exit `0`.

- [ ] Run a direct bridge smoke test.
  ```bash
  cd 00_resources/agent-stack
  TOKEN="$(grep '^HERMES_BRIDGE_TOKEN=' .env | cut -d= -f2-)"
  docker compose --env-file .env exec hermes-runtime bash -lc \
    "curl -fsS -H 'authorization: Bearer $TOKEN' -H 'content-type: application/json' \
      -d '{\"profile\":\"coder\",\"prompt\":\"Reply with the exact text: bridge-ok\",\"timeoutMs\":300000}' \
      http://127.0.0.1:8787/run"
  ```
  - Expected: JSON response contains `"exitCode":0` and stdout includes `bridge-ok`.

- [ ] Open Paperclip locally.
  - URL:
    ```text
    http://localhost:3100
    ```
  - Expected: Paperclip UI loads.

- [ ] Seed Paperclip agents after creating a Paperclip API key.
  ```bash
  cd 00_resources/agent-stack
  node paperclip/seed-agents.mjs
  ```
  - Expected: planner, coder, reviewer, and operator agents exist with `adapterType=http`.

- [ ] Trigger a Paperclip wakeup for the `coder` agent.
  - Use either the Paperclip UI or:
    ```bash
    paperclipai heartbeat run --agent-id <coder-agent-id> --api-base http://localhost:3100 --api-key "$PAPERCLIP_API_KEY"
    ```
  - Expected: Hermes runtime receives a `POST /run` for profile `coder`.

---

## Phase 7: New Coolify Deployment

- [ ] Before any Coolify action, show Lee the exact action and wait for confirmation.
  - Acceptable action: create a new Docker Compose app for `00_resources/agent-stack`.
  - Not acceptable: deploy, restart, rebuild, delete, or edit the existing Hermes Coolify stub/app.

- [ ] Create a new Coolify project/app named `agent-stack` or `paperclip-hermes-gbrain`.
  - Source path: `00_resources/agent-stack`.
  - Compose file: `compose.yaml`.
  - Environment: copy real `.env` values into Coolify secrets/env.
  - Public URL should point to Paperclip, not the bridge.
  - Do not expose `hermes-runtime:8787` publicly.

- [ ] Deploy the new Coolify app.
  - Expected services:
    - `paperclip`
    - `hermes-runtime`
  - Expected internal network:
    - `paperclip` can reach `http://hermes-runtime:8787/run`.

- [ ] Verify Coolify app health.
  - Paperclip public URL returns UI.
  - Hermes bridge healthcheck passes inside the runtime container.
  - `docker logs` or Coolify logs show no repeated restart loop.

- [ ] Seed agents against the Coolify Paperclip instance.
  - Use `paperclip/seed-agents.mjs` with:
    ```bash
    PAPERCLIP_API_BASE=https://<new-paperclip-domain>
    PAPERCLIP_API_KEY=<paperclip-api-key>
    PAPERCLIP_COMPANY_ID=<company-id>
    HERMES_BRIDGE_URL=http://hermes-runtime:8787/run
    HERMES_BRIDGE_TOKEN=<token-from-coolify-env>
    ```

- [ ] Run one Paperclip-to-Hermes smoke test in Coolify.
  - Trigger the `coder` agent.
  - Confirm Hermes bridge logs show `profile=coder`.
  - Confirm no traffic touches the existing manual Hermes container.

---

## Phase 8: Upgrade and Maintenance Path

- [ ] Add `00_resources/agent-stack/docs/runbook.md`.
  - Include start, stop, logs, healthcheck, backup, restore, and upgrade commands.

- [ ] Add `00_resources/agent-stack/docs/upgrades.md`.
  - Hermes upgrade:
    ```bash
    docker compose build --no-cache hermes-runtime
    docker compose up -d hermes-runtime
    ```
  - GBrain upgrade:
    - Change the GBrain ref in the Dockerfile or build arg.
    - Rebuild `hermes-runtime`.
    - Run `gbrain doctor --json` once per profile.
  - Paperclip upgrade:
    - Change `paperclipai@2026.513.0` in `paperclip/Dockerfile`.
    - Rebuild `paperclip`.
  - Bridge upgrade:
    - Run `node --test` before rebuild.
  - Volume backup before upgrade:
    ```bash
    docker run --rm -v agent-stack_hermes-runtime-data:/data -v "$PWD/backups:/backups" alpine \
      tar czf /backups/hermes-runtime-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
    docker run --rm -v agent-stack_paperclip-data:/data -v "$PWD/backups:/backups" alpine \
      tar czf /backups/paperclip-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
    ```

- [ ] Add an upgrade smoke test checklist.
  - `docker compose config` passes.
  - Bridge tests pass.
  - Bridge health passes.
  - All profiles have Hermes and GBrain directories.
  - One Paperclip wakeup reaches the expected profile.

---

## Acceptance Criteria

- [ ] `00_resources/agent-stack/docs/design.md` reflects the profile-aware bridge architecture.
- [ ] The fresh stack starts locally with `docker compose --env-file .env up -d --build`.
- [ ] Paperclip runs in its own container at `http://localhost:3100`.
- [ ] Hermes + GBrain run in one separate runtime container.
- [ ] The bridge is single-instance and profile-aware.
- [ ] Each role has isolated Hermes state under `/opt/data/hermes/profiles/<role>`.
- [ ] Each role has isolated GBrain state under `/opt/data/gbrain/<role>`.
- [ ] Paperclip agents use `adapterType=http` and `payloadTemplate.profile`.
- [ ] The bridge rejects unknown profiles.
- [ ] The bridge rejects unauthorized requests when `HERMES_BRIDGE_TOKEN` is set.
- [ ] The new Coolify deployment is a separate app and does not affect `hermes.leebarone.dev`.
- [ ] Upgrade docs explain how to upgrade Paperclip, Hermes, GBrain, and the bridge independently.

---

## Known V1 Tradeoff

Paperclip's built-in `http` adapter is the maintainable first integration point because it already sends `agentId`, `runId`, and `context` to the bridge. It does not stream Hermes stdout back into Paperclip run logs. V1 stores detailed logs in the Hermes runtime container logs. If Paperclip run-log visibility becomes important, the next step is a small custom Paperclip adapter or plugin that posts to the same bridge and forwards stdout/stderr into Paperclip's run log stream.
