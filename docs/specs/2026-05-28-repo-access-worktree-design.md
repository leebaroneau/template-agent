# Repo Access & Worktree System Design

**Date:** 2026-05-28
**Status:** Approved for implementation

## Problem

Template-agent had no declarative, agent-driven way to manage which repos each Hermes profile can access. Repo access was manually set (`REPOS=` in profile `.env` files), bare repos were manually cloned, and in-progress worktree work was not backed up. The `hermes-repos` volume was separate from the backed-up `paperclip-data` volume, meaning worktree work was silently lost on volume wipe.

## Goals

1. Agent can bootstrap repo access from scratch — no operator involvement
2. Changes take effect immediately (not nightly)
3. New repos in the GitHub org are auto-cloned (non-archived only)
4. Profile access is explicitly controlled via YAML
5. In-progress worktree work survives volume wipes
6. Single volume — simpler ops, simpler backup

---

## Architecture

### Single volume

Remove the `hermes-repos` volume. All data — profile state, config, and repos — lives under the single `paperclip-data` volume at `/data/`:

```
/data/                               (paperclip-data volume — backed up)
├── hermes/
│   └── profiles/                    profile state, memory, auth
├── agent-stack/
│   └── repo-access.yml              repo + access config (backed up)
└── repos/
    ├── bare/                        bare git clones (EXCLUDED from backup — reconstructible)
    └── worktrees/                   working directories (INCLUDED in backup)
        ├── haverford-cto/
        │   └── service-Auth-Gate/   active worktree, branch: bug/42-fix-auth
        └── haverford-backend/
            └── service-Auth-Gate/   concurrent worktree, branch: task/99-add-endpoint
```

**Why bare + worktrees:**
A bare repo holds only git objects (no checked-out files). Multiple worktrees attach to the same bare repo, each on a different branch simultaneously. Two profiles can work on the same repo at the same time without conflict. Worktrees only contain working files — not git history — so they are small to back up.

### compose.yaml changes

```yaml
hermes:
  environment:
    HERMES_REPOS_ROOT: /data/repos    # was /opt/repos
  volumes:
    - paperclip-data:/data            # repos now under /data/repos/
    # hermes-repos volume removed

volumes:
  paperclip-data:                     # only volume needed
  # hermes-repos: removed
```

---

## repo-access.yml

Lives at `/data/agent-stack/repo-access.yml`. Optional — if absent, the repo system is disabled and entrypoint skips silently.

### Schema

```yaml
github:
  org: my-github-org
  auto_clone: true            # clone all non-archived org repos automatically
                              # defaults to false if omitted

repo_groups:                  # named groups of repos — stable, rarely change
  platform:
    - service-Auth-Gate
    - service-Haverford-Dev-API
    - template-docker
    - OtherOrg/cross-org-repo # full owner/repo for cross-org repos
  services:
    - service-cin7Klaviyo
    - app-Gateway
  storefronts:
    - Haverford.com.au
    - Catnets.com.au

profiles:                     # maps Hermes profile name → group access
  haverford-cto:
    - group: platform
      level: rw               # written to REPOS= (worktree creation allowed)
    - group: services
      level: ro               # bare clone readable, no worktree creation
  haverford-backend:
    - group: platform
      level: ro
    - group: services
      level: rw
```

**Access levels:**
- `rw` — repo written to profile's `REPOS=`; `hermes-worktree add` allowed
- `ro` — repo NOT written to `REPOS=`; bare clone exists but worktree creation blocked

**`auto_clone: true`:** on every `reload-repo-access` run, queries `GET /orgs/{org}/repos?type=all` via `GH_TOKEN`, filters `archived == false`, clones any repo not already present in `bare/`. Explicit `repo_groups` entries still work — auto-clone is additive.

---

## `reload-repo-access` command

New script at `hermes-runtime/scripts/reload-repo-access.sh`, symlinked to `/usr/local/bin/reload-repo-access` (same pattern as `hermes-worktree`). Runs inside the container as the `node` user.

### Sequence

```
1. Validate /data/agent-stack/repo-access.yml exists + valid YAML
   → exit with clear error if not
2. If auto_clone: true → query GitHub org API, clone non-archived repos not yet in bare/
3. setup-repos-from-yaml.sh — clone repos listed in repo_groups not yet in bare/
4. sync-repos-local.sh — write REPOS= into all matching profile .env files
5. Print summary: repos cloned, profiles updated, profiles skipped
```

Idempotent — safe to run multiple times.

### Agent interface (SOUL)

```bash
# Create or edit /data/agent-stack/repo-access.yml, then apply:
reload-repo-access

# Check active worktrees:
hermes-worktree list
```

The example schema is baked into the image at `/opt/hermes-runtime/templates/repo-access.yml.example`. Agent reads this when bootstrapping from scratch.

---

## Nightly backup changes

Extend the `hermes-profiles.tar.gz` tar in `scripts/host/nightly-backup.sh`:

```bash
tar czf /tmp/hermes-profiles.tar.gz \
  --exclude="hermes/profiles/*/profile-backups" \
  --exclude="hermes/profiles/*/python-packages" \
  --exclude="hermes/profiles/*/bin" \
  --exclude="hermes/profiles/*/lsp" \
  --exclude="hermes/profiles/*/cache" \
  --exclude="hermes/profiles/*/audio_cache" \
  --exclude="*/__pycache__" \
  hermes/profiles hermes/SOUL.md hermes/auth.json hermes/.env hermes/cron hermes/hooks \
  $(test -f agent-stack/repo-access.yml && echo agent-stack/repo-access.yml || true) \
  $(test -d repos/worktrees && echo repos/worktrees || true)
  # repos/bare/ intentionally excluded — reconstructible via reload-repo-access
```

Non-fatal if files absent — new deployments without a file yet don't break backup.

---

## End-to-end workflow

### ① First deployment (brand new stack)

```
Operator deploys via Coolify → container starts → hermes-entrypoint:
  → bootstrap-profiles.sh — creates profiles, installs skills
  → checks /data/agent-stack/repo-access.yml → absent → skips silently
  → gateway starts, profiles online

Agent receives first task:
  → reads /opt/hermes-runtime/templates/repo-access.yml.example
  → creates /data/agent-stack/repo-access.yml
  → runs reload-repo-access
      → auto_clone queries GitHub org API → clones all non-archived repos
      → writes REPOS= into all profiles
  → repo system live, no operator involvement needed
```

### ② Day-to-day agent task

```
Agent (haverford-cto) receives issue: "Fix auth bug in service-Auth-Gate"

1. WORKTREE=$(hermes-worktree add $PROFILE_NAME service-Auth-Gate bug/42-fix-auth)
   → access check: service-Auth-Gate in REPOS= → granted
   → creates /data/repos/worktrees/haverford-cto/service-Auth-Gate/ on branch bug/42-fix-auth

2. cd "$WORKTREE" → do the work → git add → git commit → git push

3. gh pr create --title "Bug: fix auth" --body "Fixes #42"

4. hermes-worktree remove $PROFILE_NAME service-Auth-Gate
```

**Concurrent work, same repo — no conflict:**
```
/data/repos/bare/service-Auth-Gate.git     (shared object store)
  ↳ worktrees/haverford-cto/service-Auth-Gate/      branch: bug/42-fix-auth
  ↳ worktrees/haverford-backend/service-Auth-Gate/  branch: task/99-add-endpoint
```

### ③ Adding access mid-deployment

```
Agent edits /data/agent-stack/repo-access.yml
  → adds repo to group or grants profile access
Agent runs reload-repo-access
  → clones new bare repo if needed
  → updates REPOS= in affected profiles
  → takes effect immediately, no restart
```

### ④ New profile created by profile-sync

```
profile-sync creates haverford-reliability → bootstrap sweep runs
  → profile dir + skills created

On next reload-repo-access (agent-triggered or container restart):
  → sync-repos-local.sh finds haverford-reliability in profiles section
  → writes REPOS= into haverford-reliability/.env
```

### ⑤ Container redeploy

```
New container starts → hermes-entrypoint:
  → bootstrap-profiles.sh (idempotent)
  → /data/agent-stack/repo-access.yml exists → runs reload-repo-access
      → bare repos already present → skips clones
      → REPOS= already correct → idempotent writes
  → gateway starts → full operation restored
```

### ⑥ Volume wipe / disaster recovery

```
Volume wiped → everything in /data/ lost

Restore from nightly backup:
  → hermes-profiles.tar.gz restored → profiles back
  → agent-stack/repo-access.yml restored
  → repos/worktrees/ restored (in-progress work recovered)

Next container start:
  → entrypoint finds repo-access.yml → runs reload-repo-access
  → bare repos re-cloned from GitHub (auto_clone + explicit entries)
  → REPOS= rewritten into all profiles
  → back to full operation
```

### ⑦ Haverford migration (existing deployment)

```
Current state:
  → bare repos already in /opt/repos/bare/ (hermes-repos volume)
  → haverford-cto: REPOS= set manually
  → haverford-storefront: REPOS= set manually
  → all other profiles: REPOS= empty

Migration:
1. Update compose.yaml: HERMES_REPOS_ROOT=/data/repos, remove hermes-repos volume
   → Coolify redeploy moves repo root; bare/ is empty on first start
   → entrypoint runs reload-repo-access → re-clones all repos (auto_clone + YAML)
   → REPOS= written into all profiles

2. Agent creates /data/agent-stack/repo-access.yml
   mapping all existing profiles and repo groups

3. Run reload-repo-access → verify hermes-worktree list

4. Confirm nightly backup includes repo-access.yml and repos/worktrees/

5. Old hermes-repos volume can be deleted after verification
```

---

## Error handling

| Scenario | Behaviour |
|---|---|
| `repo-access.yml` absent at startup | Entrypoint skips silently — repo system disabled, not an error |
| `repo-access.yml` absent when agent runs `reload-repo-access` | Exit 1: "No repo-access.yml at /data/agent-stack/repo-access.yml" |
| Invalid YAML | Validation exits before touching anything — error with line number |
| `auto_clone: true` but no `GH_TOKEN` | Warning: "auto_clone requires GH_TOKEN — skipping org query"; explicit entries still processed |
| GitHub API rate limit during auto-clone | Warning per repo, continues — partial clone on this run, complete on next |
| Repo already cloned | `setup-repos-from-yaml.sh` skips (idempotent) |
| Profile `.env` missing (profile-sync not run yet) | `sync-repos-local.sh` skips that profile — picks up on next run |
| Archived repo in org with `auto_clone: true` | Filtered out via API `archived == false` — never cloned |
| Agent accesses repo not in `REPOS=` | `hermes-worktree` exits: "Profile X does not have access to Y" |

---

## Files changed in template-agent

| File | Change |
|---|---|
| `compose.yaml` | `HERMES_REPOS_ROOT=/data/repos`, remove `hermes-repos` volume |
| `hermes-runtime/scripts/reload-repo-access.sh` | NEW — wraps validate + setup + sync + summary |
| `hermes-runtime/scripts/setup-repos-from-yaml.sh` | Add `auto_clone` org query + archived filter |
| `paperclip/Dockerfile` | Symlink `reload-repo-access` to `/usr/local/bin/` |
| `paperclip/hermes-entrypoint.sh` | Update `REPO_ACCESS_CONFIG` default path reference |
| `hermes-runtime/templates/SOUL.default.md` | Add `reload-repo-access` to Repo Work section |
| `hermes-runtime/templates/repo-access.yml.example` | Move to image; update path + add `auto_clone` to schema |
| `scripts/host/nightly-backup.sh` | Include `agent-stack/repo-access.yml` + `repos/worktrees/` in tar |
| `config/repo-access.yml.example` | Keep as operator reference; update header comment |

---

## Known constraints

- Worktrees with uncommitted changes are included in nightly backup. Changes made between backups and a volume wipe are lost. Agents should commit and push at natural checkpoints, not only at PR time.
- Bare repos are not backed up — always reconstructible via `reload-repo-access`. Large orgs with many repos may take time to re-clone after a wipe.
- `auto_clone` requires `GH_TOKEN` with `repo` scope (read) on the org.
