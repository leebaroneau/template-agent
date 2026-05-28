# Haverford Profile Repo Access Management — Role-Group YAML

**Date:** 2026-05-26
**Status:** Approved for implementation
**Scope:** Haverford CTO team (7 profiles) — CEO/CMO added in a follow-up
**Related spec:** [2026-05-25-hermes-worktree-system-design.md](./2026-05-25-hermes-worktree-system-design.md)

---

## Problem

The `hermes-worktree` system enforces repo access per-profile via a `REPOS=` line in
each profile's `.env`. That works at small scale. At the Haverford scale — 9+ profiles,
51 repos — managing `REPOS=` by hand across profiles means:

- Each access change requires finding and editing the correct `.env` inside the volume
- No audit trail: there's no single file that says "who has access to what"
- Drift: profiles accumulate stale or missing repo entries over time
- Onboarding a new profile means copying access from another by hand

---

## Solution: Role-Group YAML

A single file, `config/repo-access.yml`, in `haverford-brands/00_resources/`, is the
source of truth for every profile's repo access. It maps profiles to named repo groups
at `rw` or `ro` level.

A companion script, `scripts/sync-repo-access.sh`, reads the YAML and writes `REPOS=`
into each profile's `.env` on the live volume. Run it once after any access change.
No container restart needed.

```
haverford-brands/00_resources/
  config/
    repo-access.yml          ← humans edit this; checked into lee-dashboard
  scripts/
    sync-repo-access.sh      ← run on the droplet after editing the YAML
```

The `hermes-worktree` tool is unchanged — it still reads `REPOS=` from the profile
`.env`. The YAML is purely a management layer that writes those values.

---

## Repo Groups

Groups are stable collections of repos with similar ownership. Repos are added to a
group when they're onboarded; group membership rarely changes.

### `core-platform`

Internal infrastructure: the agent stack itself, core services, org-level config.

```
agent-haverford
service-Haverford-Dev-API
service-Auth-Gate
template-docker
.github
```

### `apps`

User-facing applications and Shopify integrations.

```
app-Ads-Engine
app-Gateway
app-Product-Editor
app-Shopify-Sales
app-cope
Shopify-Apps
```

### `services`

Backend integrations, jobs, and internal tools (not public-facing).

```
service-cin7Klaviyo
service-cin7shopify-pickupordersync
service-copeapi
job-discount-code-scheduler
quote.koenigmachinery.com.au
quote.koenigmachinery.com.au-webhooks
sales.koenigmachinery.com.au
```

### `storefronts`

All brand storefront repos (Shopify themes, static sites, headless frontends).

```
Aussiegrazers.com.au
bmsaustralia.com.au
Catnets.co.nz
Catnets.co.uk
Catnets.com.au
Catnets.sg
Catnetting.com
Flux3dp.com.au
Gohorse.com.au
Gutzbusta.co.nz
Gutzbusta.co.uk
Gutzbusta.com
Gutzbusta.com.au
haverford-b2b
Hardwarebox.co.nz
Hardwarebox.com.au
Haverford.co.nz
Haverford.com.au
Justprotools.com.au
Koenigmachinery.com.au
Koenigmachinery.com.au-Wordpress
Mucheln.co.uk
Quatranetting.com.au
Quatrasports.com.au
Ropecentral.com.au
Shadematters.com.au
Xtool.koenigmachinery.com.au
```

### `tools`

Internal tooling and marketing operations repos.

```
hwb-image-generator
Marketing-Ops
newsletter-qa
price-tool
```

---

## Profile Access Map — CTO Team (Phase 1)

`rw` = profile may call `hermes-worktree add` (create branches and push).
`ro` = profile may read the bare clone (fetch, log, show) but cannot create worktrees.
`—`  = no access configured.

| Profile | core-platform | apps | services | storefronts | tools |
|---|---|---|---|---|---|
| `haverford-cto` | **rw** | ro | ro | ro | ro |
| `haverford-backend` | ro | **rw** | **rw** | — | ro |
| `haverford-storefront` | — | **rw** | ro | **rw** | ro |
| `haverford-qa` | ro | ro | ro | ro | ro |
| `haverford-release` | **rw** | ro | ro | ro | ro |
| `haverford-reliability` | ro | ro | ro | — | — |
| `haverford-seo` | — | — | — | **rw** | ro |

`haverford-ceo` and `haverford-cmo` are out of scope for phase 1 and will be added
to the YAML once the CTO team is running.

---

## `config/repo-access.yml` Schema

```yaml
# Repo groups — stable collections of related repos.
# Add new repos here when onboarding them.
repo_groups:
  core-platform:
    - agent-haverford
    - service-Haverford-Dev-API
    - service-Auth-Gate
    - template-docker
    - .github

  apps:
    - app-Ads-Engine
    - app-Gateway
    - app-Product-Editor
    - app-Shopify-Sales
    - app-cope
    - Shopify-Apps

  services:
    - service-cin7Klaviyo
    - service-cin7shopify-pickupordersync
    - service-copeapi
    - job-discount-code-scheduler
    - quote.koenigmachinery.com.au
    - quote.koenigmachinery.com.au-webhooks
    - sales.koenigmachinery.com.au

  storefronts:
    - Aussiegrazers.com.au
    - bmsaustralia.com.au
    - Catnets.co.nz
    - Catnets.co.uk
    - Catnets.com.au
    - Catnets.sg
    - Catnetting.com
    - Flux3dp.com.au
    - Gohorse.com.au
    - Gutzbusta.co.nz
    - Gutzbusta.co.uk
    - Gutzbusta.com
    - Gutzbusta.com.au
    - haverford-b2b
    - Hardwarebox.co.nz
    - Hardwarebox.com.au
    - Haverford.co.nz
    - Haverford.com.au
    - Justprotools.com.au
    - Koenigmachinery.com.au
    - Koenigmachinery.com.au-Wordpress
    - Mucheln.co.uk
    - Quatranetting.com.au
    - Quatrasports.com.au
    - Ropecentral.com.au
    - Shadematters.com.au
    - Xtool.koenigmachinery.com.au

  tools:
    - hwb-image-generator
    - Marketing-Ops
    - newsletter-qa
    - price-tool

# Profile access map.
# Each entry under a profile is a group name + access level.
# rw  → written to REPOS= in the profile's .env (hermes-worktree add allowed)
# ro  → not written (bare clone readable, worktree creation blocked)
# Omitted groups → no access
profiles:
  haverford-cto:
    - group: core-platform
      level: rw
    - group: apps
      level: ro
    - group: services
      level: ro
    - group: storefronts
      level: ro
    - group: tools
      level: ro

  haverford-backend:
    - group: core-platform
      level: ro
    - group: apps
      level: rw
    - group: services
      level: rw
    - group: tools
      level: ro

  haverford-storefront:
    - group: apps
      level: rw
    - group: services
      level: ro
    - group: storefronts
      level: rw
    - group: tools
      level: ro

  haverford-qa:
    - group: core-platform
      level: ro
    - group: apps
      level: ro
    - group: services
      level: ro
    - group: storefronts
      level: ro
    - group: tools
      level: ro

  haverford-release:
    - group: core-platform
      level: rw
    - group: apps
      level: ro
    - group: services
      level: ro
    - group: storefronts
      level: ro
    - group: tools
      level: ro

  haverford-reliability:
    - group: core-platform
      level: ro
    - group: apps
      level: ro
    - group: services
      level: ro

  haverford-seo:
    - group: storefronts
      level: rw
    - group: tools
      level: ro
```

---

## `sync-repo-access.sh` Design

Runs on the droplet (not inside the container). Reads `repo-access.yml`, computes a
`REPOS=` value (comma-separated `rw` repos) for each profile, and updates the profile's
`.env` via `docker exec -u node`.

### Execution flow

```
1. Resolve YAML file path (default: script dir/../config/repo-access.yml)
2. For each profile in YAML:
   a. Build repo list: collect all repos from groups where level=rw
   b. Format: REPOS=repo1,repo2,repo3
   c. Determine .env path inside container:
        default profile  → $HERMES_DATA_ROOT/.env
        named profile    → $HERMES_DATA_ROOT/profiles/<name>/.env
   d. docker exec -u node $CONTAINER bash -c:
        "if grep -q '^REPOS=' <env_file>; then
           sed -i 's/^REPOS=.*/REPOS=<value>/' <env_file>
         else
           echo 'REPOS=<value>' >> <env_file>
         fi"
3. Print summary: profiles updated, repos per profile
```

### YAML parsing

Uses Python 3 (`python3 -c`) with the standard `yaml` module (available in
`python3-yaml` / `pyyaml`). Falls back to `yq` if PyYAML is not installed.

### Idempotency

Safe to re-run. Replaces the `REPOS=` line if it exists; appends if not. Running twice
with the same YAML produces the same result.

### `ro` access

`ro` entries are not written to `REPOS=`. Read access to bare clones is already
implicit — `hermes-worktree fetch`, `list`, and `sync` do not check `REPOS=`, so any
profile can read any bare clone that exists. `hermes-worktree add` (which creates a
branch and implies a push) requires `REPOS=`.

---

## Adding Repos and Profiles

### New repo in an existing group

Edit `repo-access.yml` → add repo to the relevant group under `repo_groups:`.
Re-run `sync-repo-access.sh`. Re-run `setup-hermes-repos.sh Haverford-Brands/<new-repo>`
to clone it into the bare volume.

### New group

Add to `repo_groups:`. Update any profiles that need access. Re-run sync.

### New profile (e.g. `haverford-ceo`)

Add the profile block to `profiles:`. Re-run `sync-repo-access.sh`. The profile
must already exist on the volume (created by `bootstrap-profiles.sh` on container
start).

### Revoking access

Remove the group entry from the profile or change `level: rw` to `level: ro`.
Re-run sync. The REPOS= value in the profile `.env` is overwritten immediately —
no restart needed.

---

## What `setup-hermes-repos.sh` Still Does

`setup-hermes-repos.sh` handles the bare clone lifecycle (clone, fetch, directory
structure). It is not replaced by this system — it's complementary:

| Script | Responsibility |
|---|---|
| `setup-hermes-repos.sh` | Clone repos into `/opt/repos/bare/` on the volume |
| `sync-repo-access.sh` | Write `REPOS=` into each profile's `.env` |

Run `setup-hermes-repos.sh` when adding a new repo (bare clone).
Run `sync-repo-access.sh` when changing access (updates `.env` only).

---

## Future: `REPOS_READ=` Explicit Read Control

Phase 1 leaves bare clone read access open — any profile can fetch/browse any cloned
repo. If explicit read-gating is needed later (e.g. `haverford-seo` should not be
able to read `core-platform` source), a `REPOS_READ=` key can be added to
`hermes-worktree` and the sync script extended to write it. That is out of scope
for phase 1.

---

## Rollout

### Prerequisites

- `hermes-worktree` system deployed (template-agent:latest image with worktree binary
  and `PROFILE_NAME` injection — see [2026-05-25-hermes-worktree-system-design.md])
- `hermes-repos` volume exists on the Coolify stack
- All CTO-team profiles exist in the Coolify Hermes container

### Steps

1. Create `haverford-brands/00_resources/config/repo-access.yml` (see schema above)
2. Create `haverford-brands/00_resources/scripts/sync-repo-access.sh`
3. Run `setup-hermes-repos.sh` with all Haverford-Brands repos to populate bare clones
4. Run `sync-repo-access.sh` to write `REPOS=` for each CTO team profile
5. Verify:

```bash
# Check a profile's REPOS= was written
docker exec -u node hermes grep REPOS /data/hermes/profiles/haverford-backend/.env
# → REPOS=app-Ads-Engine,app-Gateway,app-Product-Editor,...

# Check hermes-worktree respects it
docker exec -u node hermes hermes-worktree add haverford-backend service-Haverford-Dev-API feature/test
# → ERROR: Profile 'haverford-backend' does not have access to 'service-Haverford-Dev-API'

docker exec -u node hermes hermes-worktree add haverford-backend app-Gateway feature/test
# → Worktree ready: /opt/repos/worktrees/haverford-backend/app-Gateway
```

---

## What This Does NOT Do

- Does not change the `hermes-worktree` binary — it continues to read `REPOS=` as-is
- Does not restrict read access to bare clones (fetch/log/show remain open)
- Does not manage which repos are cloned — that's `setup-hermes-repos.sh`
- Does not restart or redeploy the container — `.env` changes take effect immediately
