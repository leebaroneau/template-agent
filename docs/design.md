# Blank Template Design

## Goal

Provide a GitHub-cloneable Paperclip + Hermes + GBrain template that can be deployed for a new client in Coolify without carrying any existing client state.

## Shape

- The source repo stores only the deploy recipe, scripts, tests, and neutral templates.
- The Docker image installs Paperclip, Hermes Agent, GBrain, runtime entrypoints, and profile sync.
- Runtime state lives in the Coolify volume mounted at `/data`.
- `paperclip` and `hermes` are separate Compose services using the same image and shared volume.
- Paperclip is the source of truth for agent records, org structure, issues, and
  delegation instructions. Hermes receives a mirrored protocol file so agents
  launched from profile homes still have the same operating contract.

## Blankness Rules

- No Paperclip instances are committed.
- No Hermes profiles are committed except neutral templates under `hermes-runtime/templates`.
- The default Hermes `config.yaml` is an empty YAML map; runtime/client settings should be added per client after deploy.
- No GBrain homes or PGLite stores are committed.
- No client domains, names, tokens, or Coolify deployment values are committed.
- The Dockerfile removes build-time Hermes bootstrap state and leaves `/data` empty in the final image.
- The committed delegation protocol is client-neutral. At runtime the entrypoint
  copies it to `/data/agent-stack/delegation-protocol.md` and
  `/data/hermes/DELEGATION_PROTOCOL.md`; synced profiles get
  `DELEGATION_PROTOCOL.md` as a fallback copy.
- The committed learning protocol is client-neutral. At runtime the entrypoint
  copies it to `/data/agent-stack/learning-protocol.md` and
  `/data/hermes/LEARNING_PROTOCOL.md`; synced profiles get
  `LEARNING_PROTOCOL.md` as a fallback copy.
- Runtime org mirrors are generated only from the live Paperclip API and written
  to `/data/agent-stack/org-chart.md` and `/data/agent-stack/org-chart.json`.

## Delegation Protocol Flow

1. The Paperclip container starts on the VM and installs the shared protocol into
   the mounted `/data` volume.
2. Seeded and profile-synced `hermes_local` agents receive a capabilities pointer
   to `/data/agent-stack/delegation-protocol.md` and
   `/data/agent-stack/org-chart.md`.
3. Each Hermes profile home receives `DELEGATION_PROTOCOL.md` for runs where the
   shared file path is unavailable.
4. `profile-sync` periodically mirrors active Paperclip companies and agents into
   the shared org chart files so delegation can follow the current Paperclip org.
5. Active agents with direct reports receive `canAssignTasks` so manager roles
   can route work to their teams and peer managers without a CEO round trip.
6. Active agents receive a `Capability Discovery` clause that makes role scope,
   cross-team manager routing, and escalation behavior explicit.
7. Agents use Paperclip issues as the primary handoff surface, with Hermes Kanban
   as the durable cross-profile fallback when a deployment enables it.

## Learning Protocol Flow

1. The Paperclip container starts on the VM and installs the shared learning
   protocol into the mounted `/data` volume.
2. Seeded and profile-synced `hermes_local` agents receive a capabilities pointer
   to `/data/agent-stack/learning-protocol.md`.
3. Each Hermes profile home receives `LEARNING_PROTOCOL.md` for runs where the
   shared file path is unavailable.
4. Agents use `gbrain search`, `gbrain query`, and `gbrain put` against their
   role-specific `GBRAIN_HOME`.
5. Agents inspect only relevant `/data/instances` files and use
   `/data/agent-stack/important-information-index.md` for broad pointers.
6. No automatic crawler runs. Durable learned summaries are created at task end
   only when the task produced reusable context.

## Verification

Run:

```bash
npm test
docker compose --env-file .env.example config --services
docker compose --env-file .env.example build
./scripts/audit-blank-image.sh paperclip-hermes-gbrain:blank
```

The image audit checks both image metadata/history and `/data` contents.
