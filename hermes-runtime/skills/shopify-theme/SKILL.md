---
name: shopify-theme
description: Push, pull, or develop Shopify themes using the Shopify CLI. Use when making theme changes that need to be deployed to a live or development store.
triggers:
  - "shopify theme"
  - "push to shopify"
  - "deploy theme"
  - "pull theme"
  - "preview theme"
  - "shopify dev"
  - "update the theme"
  - "push to store"
---

# Shopify Theme Operations

Use the `shopify` CLI to interact with Shopify themes. Auth is via `shopify auth login` (OAuth, stored on the volume). Each operation targets a specific store.

## Common commands

### Push local changes to a store
```bash
shopify theme push --store <store>.myshopify.com
```

### Pull live theme to local
```bash
shopify theme pull --store <store>.myshopify.com
```

### Start local dev server with hot reload
```bash
shopify theme dev --store <store>.myshopify.com
```

### Push to a specific theme (not the active one)
```bash
shopify theme push --store <store>.myshopify.com --theme <theme-id>
```

## Haverford store slugs

All stores follow the pattern `<brand>.myshopify.com`. Examples:
- `koenigmachinery.myshopify.com`
- `quatrasports.myshopify.com`
- `hardwarebox.myshopify.com`

Check the REPOS env var or the Haverford brands list for the full set.

## Workflow for a theme change

1. Clone or pull the repo: `gh repo clone Haverford-Brands/<store-repo>`
2. Make changes to Liquid/CSS/JS files
3. Preview: `shopify theme dev --store <store>.myshopify.com`
4. Push: `shopify theme push --store <store>.myshopify.com`
5. Commit changes to git and open a PR via `gh`

## Auth

Run `shopify auth login` once — credentials are stored at `~/.local/share/shopify` which is symlinked to `/data` so they survive redeployment.
