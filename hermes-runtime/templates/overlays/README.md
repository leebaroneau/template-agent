# Brand `mcp_servers` overlays

Drop YAML files in this directory to contribute additional `mcp_servers` entries to every Hermes profile. `bootstrap-profiles.sh` reads `*.yaml` in this directory (sorted alphabetically) on every container start and merges each file's `mcp_servers.*` into the effective template before merging that into each profile's `config.yaml`.

## Semantics

- **Strictly additive at both layers.** An overlay cannot redefine a key that's already present in the canonical `../config.yaml`, and the effective template cannot override a key that's already in a profile's `config.yaml`.
- **Order:** overlays are processed in alphabetical filename order; the first to declare a given key wins among overlays.
- **Scope:** only the `mcp_servers` top-level key. Other keys in overlay files are ignored.
- **Errors are soft.** Malformed YAML, missing `mcp_servers` key, or non-dict `mcp_servers` value cause a single stderr warning and the overlay is skipped. Bootstrap never crashes because of overlay errors.

## Example overlay file

```yaml
mcp_servers:
  example:
    url: https://example.com/mcp
    headers:
      Authorization: "Bearer ${EXAMPLE_API_KEY}"
    timeout: 120
```

Brand operators populate `${EXAMPLE_API_KEY}` per-profile via each profile's `.env` at `/data/hermes/profiles/<slug>/.env`. Hermes resolves `${VAR}` references at runtime per-profile.

## Brand wrapper integration

A brand wrapper provides one overlay file via Docker Compose `configs:`, mounted on **both** the `paperclip` and `hermes` services (bootstrap-profiles.sh runs in both, behind the shared `flock /data/.locks/bootstrap-profiles.lock`):

```yaml
configs:
  brand_mcp_overlay:
    content: |
      mcp_servers:
        example:
          url: https://example.com/mcp
          ...

services:
  paperclip:
    configs:
      - source: brand_mcp_overlay
        target: /opt/hermes-runtime/templates/overlays/brand.yaml
  hermes:
    configs:
      - source: brand_mcp_overlay
        target: /opt/hermes-runtime/templates/overlays/brand.yaml
```
