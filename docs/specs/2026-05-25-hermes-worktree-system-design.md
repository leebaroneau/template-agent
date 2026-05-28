# Hermes Multi-Profile Git Worktree System — Design Spec

**Date:** 2026-05-25
**Status:** Approved for implementation
**Scope:** template-agent (phase 1) → agent-haverford (phase 2)

---

## Problem

Hermes profiles need to develop on GitHub repos without duplicating repo data per
profile. Multiple profiles must be able to work on the same repo simultaneously on
independent branches, access must be grantable to an existing profile at any time
without a container restart, and humans SSHing in should be able to use the same
system alongside LLM profiles.

### Why not Hermes' built-in `-w` worktree mode?

Hermes Agent has a native `-w` flag that creates worktrees under `.worktrees/` in
the current directory. It is not used here for two reasons: (1) it creates one
worktree per Hermes invocation scoped to a single session, with no concept of
profile-level access governance — any profile can touch any repo; (2) it does not
support a shared bare-clone model, so each profile would clone the full repo
history independently, defeating the goal of a single copy per repo on the host.
This system is additive — it does not disable or replace `-w` for other uses.

---

## Solution overview

Three additions to `template-agent`, one extension to `bootstrap-profiles.sh`, and
a new Docker volume per deployment. The worktree tool (`hermes-worktree`) is a
generic shell binary baked into the image. Repo access is controlled per-profile via
a `REPOS=` line in each profile's own `.env` file — the same file that already holds
API keys and is already backed up nightly.

```
Image (template-agent:latest)
  /usr/local/bin/hermes-worktree          ← shell binary, on PATH for all profiles
  /opt/hermes-runtime/skills/git-worktree/
    SKILL.md                              ← agent-stack skill, auto-symlinked by bootstrap
  /opt/hermes-runtime/scripts/
    hermes-worktree.sh                    ← source (symlinked to /usr/local/bin)
    bootstrap-profiles.sh                 ← extended: writes PROFILE_NAME to each profile .env

Volumes (per deployment)
  data-volume → /data (or /opt/data)      ← existing: Hermes state, profile .env files
  hermes-repos → /opt/repos              ← new: bare clones + worktree directories

Per-profile .env  (lives in data volume, backed up nightly)
  PROFILE_NAME=coder                      ← written once by bootstrap, never changes
  REPOS=haverford-dev-api,pipeline-core   ← updated at any time, no restart needed
  ANTHROPIC_API_KEY=...                   ← existing keys, unchanged
```

---

## Volume architecture

Two volumes, two concerns. Never mix them.

| Volume | Mount point | Contains | Backed up? |
|--------|-------------|----------|------------|
| `paperclip-data` (existing) | `/data` | Profile state: config.yaml, SOUL.md, .env, memories, GBrain | Yes — nightly via Hermes state sync |
| `hermes-repos` (new) | `/opt/repos` | Bare git clones + worktree directories | No — all content recoverable from GitHub |

The repos volume is mounted read-write on the `hermes` service only. It does not
need to be backed up because every file in it is a git checkout of a GitHub repo.

### Directory layout inside `/opt/repos`

```
/opt/repos/
  bare/
    haverford-dev-api.git/    ← bare clone (git history, single copy)
    pipeline-core.git/
    template-agent.git/
  worktrees/
    default/
      haverford-dev-api/      ← regular git working tree (branch: feature/my-fix)
    coder/
      haverford-dev-api/      ← separate working tree (branch: feature/fix-auth)
    reviewer/
      pipeline-core/          ← separate working tree (branch: review/pr-47)
```

Worktrees are ephemeral — created at task start, removed after a PR is opened.
Bare clones are permanent for as long as the repo is in active use.

### Configurable paths

Both volumes use env vars so the same image works in compose (template-agent) and
standalone docker run (agent-haverford):

| Env var | Default | Used in |
|---------|---------|---------|
| `HERMES_DATA_ROOT` | `/data/hermes` (template-agent compose), `/opt/data/hermes` (agent-haverford) | Finding profile `.env` files |
| `HERMES_REPOS_ROOT` | `/opt/repos` | All worktree operations |

`hermes-worktree` reads both from the environment, so no code changes are needed
when deploying on a new host with different mount points.

---

## Per-profile `.env` — access model

Each Hermes profile has its own `.env` file:

- `default` profile → `${HERMES_DATA_ROOT}/.env`
- named profile → `${HERMES_DATA_ROOT}/profiles/<name>/.env`

Two keys are relevant to the worktree system:

```bash
# Written once by bootstrap-profiles.sh at profile creation time. Never changes.
PROFILE_NAME=coder

# Updated any time to grant/revoke repo access. No restart needed.
REPOS=haverford-dev-api,pipeline-core
```

### Access rules

- `REPOS=` unset or empty → profile has no repo access. `hermes-worktree add` exits
  with a clear error: `"Profile 'coder' has no repo access. Add REPOS= to
  /data/hermes/profiles/coder/.env"`
- `REPOS=repo1,repo2` → profile may create worktrees only for listed repos
- Repo not in list → denied: `"Profile 'coder' does not have access to 'pipeline-core'"`

This is **tool-level enforcement**, not OS-level. LLM profiles running autonomously
go through `hermes-worktree` and are bound by these rules. Humans SSH-ing in as
root or the container user can access any directory directly — the enforcement
is governance for autonomous agents, not a security boundary for humans.

### Granting access to an existing profile

No restart. No image rebuild. Just update the file.

> **User flag by deployment:**
> - `template-agent` (compose, `node:22-bookworm-slim` base) → `-u node`
> - `agent-haverford` (standalone docker run, custom image with `hermes` user) → `-u hermes`
> Examples below use `-u node` for the template-agent context.

```bash
# From the droplet, grant coder access to a new repo:
docker exec -u node hermes bash -c \
  "sed -i 's/^REPOS=.*/REPOS=haverford-dev-api,pipeline-core,new-repo/' \
   ${HERMES_DATA_ROOT}/profiles/coder/.env"

# Or append if REPOS= doesn't exist yet:
docker exec -u node hermes bash -c \
  "echo 'REPOS=new-repo' >> ${HERMES_DATA_ROOT}/profiles/coder/.env"
```

The change takes effect on the next `hermes-worktree` call. The updated `.env` is
backed up on the next nightly sync to `agent-haverford-data`.

---

## `hermes-worktree` — command reference

Binary at `/usr/local/bin/hermes-worktree`. Source at
`hermes-runtime/scripts/hermes-worktree.sh`.

```
hermes-worktree add    <profile> <repo> <branch>   Create an isolated working tree
hermes-worktree remove <profile> <repo>            Remove after PR is opened
hermes-worktree list                               Show all active worktrees (all repos)
hermes-worktree fetch  <repo>                      Fetch latest from upstream
hermes-worktree sync   <repo>                      Fetch + rebase active worktrees
```

### `add` — full execution path

```
1. Resolve profile .env path from HERMES_DATA_ROOT + profile arg
2. Read REPOS= from profile .env → deny if unset or repo not in list
3. Check bare clone exists at HERMES_REPOS_ROOT/bare/<repo>.git → deny if missing
4. git fetch --all --prune on the bare clone (get latest)
5. Worktree path = HERMES_REPOS_ROOT/worktrees/<profile>/<repo>
   └── already exists, same branch → reuse (idempotent, print path)
   └── already exists, different branch → deny (must remove first)
   └── doesn't exist → git worktree add -b <branch> from origin/main (or master)
6. Print the worktree path on stdout
   └── LLM agents capture this and cd into it
   └── Humans use it to open in VSCode
```

Branches `main`, `master`, `develop`, `HEAD` are blocked — the tool forces feature
branch discipline.

### Profile self-reference

`PROFILE_NAME` is set in the profile's `.env` and is in the environment when Hermes
runs the profile. The `git-worktree` skill instructs the agent to always pass
`$PROFILE_NAME` as the first argument. The agent never hardcodes its own name.

```bash
# What the LLM agent runs (PROFILE_NAME=coder in its env):
hermes-worktree add $PROFILE_NAME haverford-dev-api feature/fix-auth
# Resolves to:
hermes-worktree add coder haverford-dev-api feature/fix-auth
```

---

## `git-worktree` skill — agent-stack skill

Location: `hermes-runtime/skills/git-worktree/SKILL.md`

`bootstrap-profiles.sh` already symlinks every skill in
`/opt/hermes-runtime/skills/` into all profiles via `install_agent_stack_skills`.
This skill reaches every existing and future profile automatically on container
restart — no manual installation per profile.

The skill covers:
- When to use `hermes-worktree` (any time code work touches a repo)
- The full `add → work → push → PR → remove` lifecycle
- Branch naming conventions (`feature/`, `fix/`, `task/`, `spike/`) as generic
  defaults — repos governed by pipeline-core require `<type>/<#>-<slug>` with a
  GitHub issue number prefix (e.g. `feature/42-fix-auth`); the skill instructs
  agents to check `AGENTS.md` in the target repo before naming the branch
- What to do when access is denied (stop, surface the exact error to the user)
- How to check active worktrees with `hermes-worktree list`
- The `$PROFILE_NAME` self-reference pattern
- That `gh pr create` (not manual git push alone) is the expected PR mechanism,
  and that pipeline-core repos require an issue to exist before the PR is opened

---

## `bootstrap-profiles.sh` — extension

One addition: after creating or loading a profile, write `PROFILE_NAME=<name>` to
the profile's `.env` if the key is not already present.

```bash
# After write_env_file "$profile_home/.env":
if ! grep -q "^PROFILE_NAME=" "$profile_home/.env" 2>/dev/null; then
  echo "PROFILE_NAME=$profile" >> "$profile_home/.env"
fi
```

This runs on every container start. Existing profiles that predate this change get
`PROFILE_NAME` injected on next restart — no manual intervention needed.

---

## `compose.yaml` — changes (template-agent)

### New volume

```yaml
volumes:
  paperclip-data:
  hermes-repos:          # ← add this
```

### New env vars on hermes service

```yaml
hermes:
  environment:
    HERMES_REPOS_ROOT: /opt/repos
    HERMES_REPOS: ${HERMES_REPOS:-}   # comma-separated list for setup-hermes-repos
  volumes:
    - paperclip-data:/data
    - hermes-repos:/opt/repos          # ← add this
```

`HERMES_REPOS` is empty by default in the template. Brand agents (agent-haverford,
agent-genvest, etc.) set it in their own `.env` or compose override.

---

## `Dockerfile` — changes

Two additions to the final `RUN` block:

```dockerfile
# After chmod +x /opt/hermes-runtime/scripts/*.sh:
&& ln -sf /opt/hermes-runtime/scripts/hermes-worktree.sh /usr/local/bin/hermes-worktree \
&& mkdir -p /opt/repos/bare /opt/repos/worktrees
```

The `mkdir` creates the directory structure inside the image layer so the volume
mount point exists even before `setup-hermes-repos.sh` runs.

---

## `setup-hermes-repos.sh` — initialisation (agent-haverford)

Runs **once** on the droplet after the first `start-hermes-droplet.sh`. Does not
run on every start — it's a one-time provisioner. Idempotent: re-running fetches
latest without re-cloning.

Responsibilities:
1. Create `hermes-repos` volume if missing
2. Clone each repo in `HERMES_REPOS` as a bare clone into `/opt/repos/bare/`
3. For each profile in `HERMES_PROFILES`, write `PROFILE_NAME=<profile>` into the
   profile `.env` if not present (bootstrap may not have run yet on first call)

It does **not** pre-create worktree directories — these are created lazily by
`hermes-worktree add`.

---

## Rollout sequence

### Phase 1 — template-agent

1. Add `hermes-runtime/scripts/hermes-worktree.sh`
2. Add `hermes-runtime/skills/git-worktree/SKILL.md`
3. Extend `bootstrap-profiles.sh` with `PROFILE_NAME` injection
4. Update `Dockerfile` — symlink + mkdir
5. Update `compose.yaml` — `hermes-repos` volume + `HERMES_REPOS_ROOT` env
6. Run `npm test` and `docker compose --env-file .env.example config --services`
7. Run `./scripts/audit-blank-image.sh` against local build
8. Open PR → merge → new `template-agent:latest` published

### Phase 2 — agent-haverford

1. Update `start-hermes-droplet.sh` — already done (hermes-repos volume mount)
2. Remove `hermes-worktree.sh` from `haverford-brands/00_resources/scripts/` — it
   now lives in the image
3. Update `hermes-env-snapshot.env` on the droplet — add `HERMES_REPOS` and
   `HERMES_REPOS_ROOT`
4. Rebuild agent-haverford image from new `template-agent:latest`
5. Run `start-hermes-droplet.sh` on the droplet
6. Run `setup-hermes-repos.sh` — initial bare clones + PROFILE_NAME injection
7. Verify with `docker exec -u node hermes hermes-worktree list`

### Adding repos or profiles in future

**New repo for an existing profile** (no restart, no rebuild):
```bash
docker exec -u node hermes bash -c \
  "sed -i 's/REPOS=.*/&,new-repo/' ${HERMES_DATA_ROOT}/profiles/coder/.env"
docker exec -u hermes hermes \
  hermes-worktree fetch new-repo   # or re-run setup-hermes-repos.sh new-org/new-repo
```

**New profile** (restart required to run bootstrap, then no rebuild):
```bash
# 1. Add profile name to HERMES_PROFILES in env file
# 2. Restart container — bootstrap creates the profile, injects PROFILE_NAME
# 3. Add REPOS= to the new profile's .env (no further restart needed)
```

**New brand agent** (e.g., agent-genvest):
- Builds from `template-agent:latest` — gets `hermes-worktree` binary and skill for free
- Sets `HERMES_REPOS` in its own env file
- Runs `setup-hermes-repos.sh` once after first deploy

---

## Verification

After Phase 2 deploy:

```bash
# 1. Binary is on PATH
docker exec -u hermes hermes which hermes-worktree
# → /usr/local/bin/hermes-worktree

# 2. PROFILE_NAME injected into default profile
docker exec -u node hermes grep PROFILE_NAME ${HERMES_DATA_ROOT}/.env
# → PROFILE_NAME=default

# 3. Bare clones present
docker exec -u node hermes ls /opt/repos/bare/
# → haverford-dev-api.git  pipeline-core.git  ...

# 4. Access denied when REPOS= not set
docker exec -u node hermes hermes-worktree add default test-repo feature/x
# → ERROR: Profile 'default' has no repo access. Add REPOS= to ...

# 5. Grant access + create worktree
docker exec -u node hermes bash -c \
  "echo 'REPOS=haverford-dev-api' >> ${HERMES_DATA_ROOT}/.env"
docker exec -u hermes hermes \
  hermes-worktree add default haverford-dev-api feature/verify-setup
# → Worktree ready: /opt/repos/worktrees/default/haverford-dev-api

# 6. List shows it
docker exec -u node hermes hermes-worktree list
# → haverford-dev-api:
# →   /opt/repos/worktrees/default/haverford-dev-api  [feature/verify-setup]

# 7. Cleanup
docker exec -u hermes hermes \
  hermes-worktree remove default haverford-dev-api
# → Worktree removed.

# 8. git-worktree skill visible in a profile's skills directory
docker exec -u node hermes ls ${HERMES_DATA_ROOT}/skills/agent-stack/
# → git-worktree  gbrain  use-100m-framework  ...
```

---

## What this does NOT do

- No OS-level filesystem permissions — enforcement is at the tool layer only
- No automatic worktree creation on profile start — worktrees are task-scoped and ephemeral
- No per-repo branch restrictions — any branch name is valid as long as it's not a protected base branch
- No sync of the repos volume to the nightly backup — repos are recoverable from GitHub
