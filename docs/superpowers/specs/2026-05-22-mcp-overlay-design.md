# Brand overlay support for `mcp_servers` in `bootstrap-profiles.sh`

**Date:** 2026-05-22
**Status:** Draft (awaiting sign-off)
**Owner:** Lee Barone
**Implementation target repo:** `leebaroneau/template-agent`
**Companion repo (consumer):** `Genvest-Property/agent-genvest`

## Current state

`hermes-runtime/scripts/bootstrap-profiles.sh::sync_mcp_servers_from_template` reads only `$TEMPLATE_DIR/config.yaml` (baked into the image at `/opt/hermes-runtime/templates/`) and merges its `mcp_servers.*` entries into every profile's `config.yaml`. The merge is idempotent and non-destructive: an entry that already exists in a profile is never overwritten.

There is no documented or supported extension point for brand wrappers (e.g. `agent-genvest`) to *contribute* additional `mcp_servers` entries to the canonical template from outside the image. This forces brand wrappers into bad workarounds:

| Workaround | Problem |
|---|---|
| `configs:` mount replacing `/opt/hermes-runtime/templates/config.yaml` wholesale | Freezes a snapshot of upstream. New default MCPs added upstream stop reaching profiles until the snapshot is refreshed. |
| Fork `template-agent` | Diverges from upstream; every upstream update requires a manual merge. |
| `PROFILE_SYNC_TEMPLATE_DIR` env override pointing at a brand-specific dir | Same staleness problem as the wholesale `configs:` replacement. |
| Custom seed script in the brand wrapper's `docker-compose.yaml` (current `agent-genvest` approach) | Duplicates `bootstrap-profiles.sh`'s merge logic. Currently destructive — `sync_genvest_mcp_auth` overwrites Authorization headers on every redeploy, clobbering per-profile literal token customizations. |

The gap is systematic, not specific to `agent-genvest`. Any brand that needs a brand-specific MCP server will hit it. Today only `agent-genvest` has hit it (and worked around it badly). `agent-haverford` and `agent-alx` will hit it the instant they introduce their own MCP servers.

## Why

Provide a clean, documented extension point so brand wrappers can contribute additional `mcp_servers` entries to the canonical template without forking, snapshotting, or duplicating merge logic. Preserve the existing idempotent, non-destructive merge semantics at both layers (overlay → effective template, effective template → profile).

## Goals

- Brand wrappers can drop one or more YAML files into `$TEMPLATE_DIR/overlays/` (e.g. via Docker Compose `configs:`) and their `mcp_servers` entries are merged into every Hermes profile non-destructively.
- The canonical `$TEMPLATE_DIR/config.yaml` always wins on key collision with an overlay (overlays cannot redefine an upstream entry).
- Existing profile entries always win on key collision with either the canonical template or an overlay (profile customizations remain preserved, as today).
- Behavior is fully backward-compatible: if `$TEMPLATE_DIR/overlays/` does not exist or is empty, `bootstrap-profiles.sh` behaves identically to today.
- No new env vars required. `PROFILE_SYNC_TEMPLATE_DIR` (existing knob) continues to work — overlays live in that dir's `overlays/` subdir.
- `agent-genvest` can replace its destructive `runtime-seed` MCP logic with a single overlay file in a follow-up PR.

## Non-goals

- Override semantics. An overlay cannot replace or modify an entry that's already in the canonical template. Brands that need to disable a stock MCP must do so per-profile, or upstream the change.
- Overlay scope beyond `mcp_servers`. Toolsets, model defaults, platforms, etc. are out of scope for this design and stay handled by `profile-sync` or per-profile `config.yaml`. Can be revisited if a concrete need arises.
- Per-profile secret injection. Bearer tokens, API keys, etc. continue to be resolved at runtime by Hermes from per-profile `.env` files. An overlay declares the MCP server *structure*, including `${VAR}` references. Brand operators populate the env vars per profile.
- Removing `agent-genvest`'s broken seed logic. That's a separate companion PR in `agent-genvest` that depends on this one landing.

## Design

### Discovery

`bootstrap-profiles.sh` reads `$TEMPLATE_DIR/overlays/*.yaml` files at startup. Files are sorted alphabetically before processing. If the directory does not exist, processing is silently skipped (no warning — empty dir is the documented baseline state).

### Merge semantics (two layers, both strictly additive)

**Layer 1 — Overlay → effective template:**

For each overlay file in sorted order, for each key in its `mcp_servers` map, if the key is not already present in the effective template `mcp_servers` map, add it. Otherwise skip silently. This means:

- The canonical `$TEMPLATE_DIR/config.yaml` always wins over any overlay on the same key.
- Among overlays, the alphabetically-first file wins on collision.

**Layer 2 — Effective template → profile (unchanged from today):**

For each key in the effective template `mcp_servers` map, if the key is not already in the profile's `mcp_servers` map, add it. Otherwise skip silently.

### File layout

| Path | Purpose | Provided by |
|---|---|---|
| `/opt/hermes-runtime/templates/config.yaml` | Canonical Hermes template (existing) | template-agent image at build time |
| `/opt/hermes-runtime/templates/overlays/` | Brand overlay directory (new) | template-agent image at build time (empty `.gitkeep`) |
| `/opt/hermes-runtime/templates/overlays/<brand>.yaml` | Brand-specific overlay (new) | Brand wrapper's `docker-compose.yaml` via `configs:` |

### Brand wrapper integration

A brand wrapper provides one overlay file via Docker Compose `configs:`. The overlay must be mounted on **both** the `paperclip` and `hermes` services because `bootstrap-profiles.sh` runs in both containers (called from `paperclip/entrypoint.sh:75` and `paperclip/hermes-entrypoint.sh:18`, each behind the shared `flock /data/.locks/bootstrap-profiles.lock`). `$TEMPLATE_DIR` is baked into the image, not on the shared `/data` volume, so each container reads its own copy.

```yaml
configs:
  genvest_mcp_overlay:
    content: |
      mcp_servers:
        genvest:
          url: https://service-api.209.38.27.69.sslip.io/mcp
          headers:
            Authorization: "Bearer ${GENVEST_SERVICE_API_TOKEN}"
          timeout: 120

services:
  paperclip:
    configs:
      - source: genvest_mcp_overlay
        target: /opt/hermes-runtime/templates/overlays/genvest.yaml
  hermes:
    configs:
      - source: genvest_mcp_overlay
        target: /opt/hermes-runtime/templates/overlays/genvest.yaml
```

Per-profile bearer tokens continue to be supplied by each profile's `.env` (`/data/hermes/profiles/<slug>/.env`) — Hermes resolves `${GENVEST_SERVICE_API_TOKEN}` per-profile at runtime. No env-var-name mangling, no per-profile overlay files needed.

### Error handling

| Condition | Behavior |
|---|---|
| `overlays/` directory missing | Silently skip (documented baseline). |
| `overlays/` directory present but empty | Silently skip. |
| Overlay file missing `mcp_servers` top-level key | Skip that file silently. |
| Overlay file's `mcp_servers` is not a dict | Skip that file, emit one warning to stderr including the path. |
| Overlay file is malformed YAML | Skip that file, emit one warning to stderr, continue with remaining overlays. |
| Overlay file unreadable (permissions, etc.) | Skip that file, emit one warning to stderr, continue with remaining overlays. |

Bootstrap MUST NOT crash because of overlay errors. The canonical template path remains authoritative; overlays are a soft enhancement.

### Backward compatibility

If `$TEMPLATE_DIR/overlays/` does not exist or is empty (the state of every deployment today), `bootstrap-profiles.sh` behavior is identical to its current state. No env changes, no profile changes, no migration step.

### Idempotency

Re-running `bootstrap-profiles.sh` (which happens on every container start) does not introduce duplicate entries — the "if key not in" gate at both merge layers makes the operation idempotent.

## Implementation

Single-function modification in `hermes-runtime/scripts/bootstrap-profiles.sh::sync_mcp_servers_from_template`. The embedded Python heredoc gains a small pre-pass that walks `$TEMPLATE_DIR/overlays/*.yaml` in sorted order and merges each file's `mcp_servers` into the effective template dict (strictly additive). The rest of the function — including the profile merge and the file-write path — is unchanged.

Estimated change size: ~25 lines added inside the existing function.

A new `mkdir -p /opt/hermes-runtime/templates/overlays` (with a `.gitkeep`) is added to the image build (`Dockerfile`) so the directory always exists. Optional: a stock `overlays/README.md` documenting the contract.

## Testing

No existing test surface for `bootstrap-profiles.sh` (verified — only `.test.mjs` files exist under `paperclip/`, none cover the shell script). Add a new `hermes-runtime/scripts/bootstrap-profiles.test.sh` (bash, exercises the merge function in isolation by sourcing the script and invoking `sync_mcp_servers_from_template` against tmpdir fixtures) covering:

| Case | Expected behavior |
|---|---|
| No `overlays/` dir present | Identical to current behavior |
| `overlays/` present but empty | Identical to current behavior |
| Overlay with valid `mcp_servers.foo` | `foo` merged into every test profile |
| Overlay key collision with canonical template | Canonical wins; overlay entry skipped silently |
| Overlay A and overlay B both declare same `mcp_servers.foo` | `a.yaml` wins (alphabetic sort); `b.yaml` entry skipped silently |
| Overlay file with no `mcp_servers` key | File skipped silently, no error |
| Overlay file with non-dict `mcp_servers` | File skipped, one warning to stderr |
| Overlay with malformed YAML | File skipped, one warning to stderr; other overlays still merged |
| Re-running bootstrap with same overlays | Idempotent — no duplicate entries appended |
| Profile already contains the overlay's key | Profile entry preserved; overlay skipped |

**Manual integration check before merging:** build the template-agent image with a test overlay file baked in, exec `bootstrap-profiles.sh` against a fresh profile dir, confirm the overlay MCP appears in `/data/hermes/profiles/<test>/config.yaml`.

## Documentation

- Update `README.md` section on MCP server merging to document the overlay pattern, the `overlays/*.yaml` convention, and the strict-additive semantics.
- Add `overlays/README.md` in the image documenting the contract for brand wrappers reading from within the deployed container.

## Companion work (separate PR, separate repo)

After this lands and ships in a new `template-agent` image:

1. `Genvest-Property/agent-genvest` PR:
   - Add `runtime/genvest/hermes/overlays/genvest.yaml` containing only the `mcp_servers.genvest` block.
   - Wire it into `docker-compose.yaml` via `configs:` mounted at `/opt/hermes-runtime/templates/overlays/genvest.yaml` on **both** the `paperclip` and `hermes` services.
   - Delete `sync_genvest_mcp_auth`, `add_genvest_mcp_server`, and `genvest_token_variable_for_config` from `docker-compose.yaml`'s `runtime-seed` service.
   - Remove dead `notion:` MCP server references from `runtime/genvest/hermes/config.yaml` and `docker-compose.yaml` (`notion:` was added 2026-05-21 but is not wired to any profile and `HERMES_NOTION_API_KEY` is empty in production).
   - Remove unused `GENVEST_SERVICE_API_TOKEN_SALES`/`_CUSTOMER_SERVICE`/`_MARKETING`/`_FINANCE`/`_CEO` env vars from `.env.example` and `docker-compose.yaml` (the per-profile env-var indirection was never populated in Coolify; each profile's `.env` will continue to carry its own `GENVEST_SERVICE_API_TOKEN` value).
   - Bump pinned `TEMPLATE_AGENT_IMAGE` SHA to the new `template-agent` build that includes overlay support.

2. (Optional, separate) `Haverford-Brands/agent-haverford` and `alx-finance/agent-alx` can adopt the overlay pattern when they introduce brand-specific MCP servers — no changes required today since neither carries one.

## Rollback

This change is purely additive. Rollback = revert the PR. Existing deployments are unaffected because they don't ship overlay files. Brand wrappers that adopt overlays (only `agent-genvest` initially, in a follow-up PR) would need to roll back to their previous wrapper version simultaneously, OR delete their overlay file via the brand wrapper repo.

## Open questions

None at design time. All decisions captured above.
