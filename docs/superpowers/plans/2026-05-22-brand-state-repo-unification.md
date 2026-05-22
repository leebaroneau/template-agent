# Brand State Repo Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ALX and Genvest to the same deployment shape as Haverford: deployable code comes from `template-agent`, and each brand's `agent-<brand>` repo stores only nightly and pre-deploy state snapshots.

**Architecture:** Preserve existing repo history before conversion, take live `/data` backups before deployment changes, then wire host-side nightly backups and Coolify pre-deploy backups to the brand-owned state repos. Coolify should deploy ALX and Genvest from `leebaroneau/template-agent`, while `alx-finance/agent-alx` and `genvest/agent-genvest` hold snapshot directories. Hermes profile archives exclude reconstructible dependency/cache folders and nested historical profile backups so snapshots stay under GitHub's file-size limit while retaining current operating state.

**Tech Stack:** GitHub repos/deploy keys or token fallback, Coolify application API, Docker Compose deployments, host-side SSH, `scripts/host/nightly-backup.sh`, `paperclip/pre-deploy-backup.sh`.

---

### Task 1: Preserve Existing Repo History

**Files:**
- Remote-only: `alx-finance/agent-alx`
- Remote-only: `genvest/agent-genvest`

- [ ] **Step 1: Archive ALX repo history**

Run:

```bash
gh api repos/alx-finance/agent-alx/git/ref/heads/main --jq .object.sha
```

Create an archive branch from the returned SHA:

```bash
gh api -X POST repos/alx-finance/agent-alx/git/refs \
  -f ref=refs/heads/archive/pre-state-repo-2026-05-22 \
  -f sha=<ALX_MAIN_SHA>
```

Expected: GitHub returns a new `refs/heads/archive/pre-state-repo-2026-05-22` ref.

- [ ] **Step 2: Archive Genvest main and active wrapper branch**

Run:

```bash
gh api repos/genvest/agent-genvest/git/ref/heads/main --jq .object.sha
gh api repos/genvest/agent-genvest/git/ref/heads/task/4-stock-template-cutover-wrapper --jq .object.sha
```

Create archive branches from the returned SHAs:

```bash
gh api -X POST repos/genvest/agent-genvest/git/refs \
  -f ref=refs/heads/archive/pre-state-repo-main-2026-05-22 \
  -f sha=<GENVEST_MAIN_SHA>

gh api -X POST repos/genvest/agent-genvest/git/refs \
  -f ref=refs/heads/archive/pre-state-repo-wrapper-2026-05-22 \
  -f sha=<GENVEST_WRAPPER_SHA>
```

Expected: both archive refs exist before `main` is repurposed.

### Task 2: Take Live Backups Before Deployment Changes

**Files:**
- Remote droplet: `/root/agent-state-bootstrap/<brand>/<date>/`

- [ ] **Step 1: Create ALX bootstrap snapshot on the droplet**

Run:

```bash
ssh alxfinance-droplet 'BRAND=alx; APP=e10yiotda8wg5031nratyg76; DATE=$(date -u +%Y-%m-%d); OUT=/root/agent-state-bootstrap/$BRAND/$DATE; mkdir -p "$OUT"; PAPERCLIP=$(docker ps --filter "name=paperclip-$APP" --format "{{.Names}}" | head -1); HERMES=$(docker ps --filter "name=hermes-$APP" --format "{{.Names}}" | head -1); test -n "$PAPERCLIP"; test -n "$HERMES"; docker exec "$PAPERCLIP" bash -lc "paperclipai db:backup --dir /tmp >/dev/null 2>&1"; DB=$(docker exec "$PAPERCLIP" bash -lc "ls -1t /tmp/paperclip-*.sql.gz | head -1"); docker cp "$PAPERCLIP:$DB" "$OUT/paperclip-db.sql.gz"; docker exec "$HERMES" bash -lc "cd /data && tar czf /tmp/hermes-profiles.tar.gz hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks 2>/dev/null || true; tar czf /tmp/gbrain.tar.gz gbrain 2>/dev/null || true"; docker cp "$HERMES:/tmp/hermes-profiles.tar.gz" "$OUT/hermes-profiles.tar.gz"; docker cp "$HERMES:/tmp/gbrain.tar.gz" "$OUT/gbrain.tar.gz"; ls -lh "$OUT"'
```

Expected: three files exist: `paperclip-db.sql.gz`, `hermes-profiles.tar.gz`, `gbrain.tar.gz`.

- [ ] **Step 2: Create Genvest bootstrap snapshot on the droplet**

Run the same pattern with `BRAND=genvest`, `APP=otm4lzviqdp29yuhkafcghsb`, and `ssh genvest-droplet`.

Expected: three files exist under `/root/agent-state-bootstrap/genvest/<date>/`.

### Task 3: Convert Agent Repos To State-Only

**Files:**
- Remote GitHub repo: `alx-finance/agent-alx`
- Remote GitHub repo: `genvest/agent-genvest`

- [ ] **Step 1: Replace ALX main with state-only README plus snapshot**

Create a clean working clone, copy the ALX bootstrap snapshot into `<date>/`, commit with message `Initial state snapshot: <date> (alx)`, and push to `main`.

Expected: `alx-finance/agent-alx` `main` contains `README.md` plus a dated snapshot directory.

- [ ] **Step 2: Replace Genvest main through the pipeline issue branch**

Use branch `task/6-convert-to-state-repo`, commit the state-only README plus snapshot, open a PR with `Fixes #6`, and merge it after checks complete.

Expected: `genvest/agent-genvest` `main` contains `README.md` plus a dated snapshot directory; old wrapper history remains on archive branches.

### Task 4: Install Host-Side Nightly Backups

**Files:**
- Remote droplet: `/root/agent-state-backup/nightly-backup.sh`
- Remote droplet: `/root/agent-state-backup/backup.env`
- Remote droplet: `/root/.ssh/agent-<brand>-deploy`

- [ ] **Step 1: Generate or reuse per-brand deploy keys**

On each droplet, ensure `/root/.ssh/agent-<brand>-deploy` exists with mode `600`, and register its public half as a write-enabled deploy key on the matching state repo. If GitHub returns `Deploy keys are disabled for this repository`, store a GitHub token with push access in `/root/agent-state-backup/github-token` with mode `600` and use `AGENT_STATE_TOKEN_FILE` in `backup.env`.

Expected: the droplet can push to the brand state repo through either `github-agent-state` or the root-owned token fallback.

- [ ] **Step 2: Install `nightly-backup.sh` and `backup.env`**

Copy `scripts/host/nightly-backup.sh` from `template-agent` to `/root/agent-state-backup/nightly-backup.sh` on each droplet. Create `backup.env` with:

```bash
AGENT_STATE_REPO=<Org>/agent-<brand>
AGENT_STATE_BRAND=<brand>
AGENT_STATE_KEY=/root/.ssh/agent-<brand>-deploy
# Or, when deploy keys are disabled:
# AGENT_STATE_TOKEN_FILE=/root/agent-state-backup/github-token
AGENT_STATE_COMPOSE_FILTER=<coolify-app-uuid>
AGENT_STATE_RETENTION_DAYS=30
```

Expected: running `/root/agent-state-backup/nightly-backup.sh` commits and pushes a nightly snapshot.

### Task 5: Wire Coolify To Template-Agent And Pre-Deploy Backups

**Files:**
- Coolify application: ALX `e10yiotda8wg5031nratyg76`
- Coolify application: Genvest `otm4lzviqdp29yuhkafcghsb`

- [ ] **Step 1: Switch deploy source to `template-agent` where needed**

Set Genvest Coolify source to `leebaroneau/template-agent` and use the standard compose file. ALX is already on the template source path and should be audited rather than rebuilt from a brand wrapper.

Expected: both apps deploy from template-owned compose and image configuration.

- [ ] **Step 2: Add Coolify backup env vars**

For each app, set runtime env vars:

```bash
AGENT_STATE_REPO=<Org>/agent-<brand>
AGENT_STATE_BRAND=<brand>
AGENT_STATE_DEPLOY_KEY=<base64 private key from the droplet>
```

Expected: new containers install `/home/node/.ssh/agent-state-deploy` at startup.

- [ ] **Step 3: Bootstrap pre-deploy backup**

Deploy once without the pre-deploy hook if the old container does not have `/opt/paperclip/pre-deploy-backup.sh`. After the new container is running, set:

```bash
pre_deployment_command=bash /opt/paperclip/pre-deploy-backup.sh
pre_deployment_command_container=paperclip
```

Deploy a second time.

Expected: `agent-state-pre-deploy` commits a pre-deploy snapshot to the brand state repo.

### Task 6: Verify Compliance

**Files:**
- GitHub repos: `alx-finance/agent-alx`, `genvest/agent-genvest`
- Remote droplets: ALX and Genvest
- Coolify apps: ALX and Genvest

- [ ] **Step 1: Verify repo commits**

Run:

```bash
gh api repos/alx-finance/agent-alx/commits --jq '[.[] | {author:.commit.author.name, message:.commit.message, date:.commit.author.date}] | .[0:5]'
gh api repos/genvest/agent-genvest/commits --jq '[.[] | {author:.commit.author.name, message:.commit.message, date:.commit.author.date}] | .[0:5]'
```

Expected: each repo has at least one nightly-style commit and one pre-deploy commit.

- [ ] **Step 2: Verify host and Coolify configuration**

Run the compliance checks from `docs/deployment-standard.md` for both brands.

Expected: all mandatory checklist items pass.
