---
name: shopify-app
description: Develop, build, and deploy Shopify embedded apps using the Shopify CLI. Use for app-cope and any other Shopify App Framework app (App Bridge, Polaris, React Router, session storage, extensions).
triggers:
  - "shopify app"
  - "embedded app"
  - "app-cope"
  - "deploy the app"
  - "shopify extension"
  - "app bridge"
  - "polaris app"
  - "shopify app dev"
---

# Shopify App Development

Use the `shopify` CLI to develop and deploy embedded Shopify apps. Haverford's embedded apps use `@shopify/app-bridge-react` + `@shopify/shopify-app-react-router` + Prisma session storage.

## Common commands

### Local dev (with Shopify tunnel)
```bash
shopify app dev
```
Opens a Shopify tunnel and connects the app to a development store. Requires a Partners account and dev store configured.

### Build
```bash
shopify app build
```

### Deploy app config and extensions
```bash
shopify app deploy
```
Pushes app configuration and any extensions (UI, Functions, Theme App Extensions) to the Partner Dashboard.

### Scaffold a new extension
```bash
shopify app generate extension
```

### Show app config
```bash
shopify app info
```

## Haverford embedded apps

| Repo | Purpose |
|------|---------|
| `app-cope` | Shopify embedded app — App Bridge + React Router + Prisma sessions |
| `app-Product-Editor` | Product editor for bulk price changes |
| `app-Shopify-Sales` | Sales pipeline app |
| `app-Ads-Engine` | Ads management |
| `app-Gateway` | Gateway / routing app |

## Workflow for a change

1. Clone: `gh repo clone Haverford-Brands/<app-repo>`
2. Install deps: `npm install`
3. Dev: `shopify app dev` (needs dev store + Partners auth)
4. Build: `shopify app build`
5. Deploy: `shopify app deploy`
6. Commit and PR: `gh pr create`

## Auth

`shopify auth login` (OAuth) — stored on `/data` volume, persists across redeployment. Same session covers both `shopify app` and `shopify theme` commands.

## Key difference from shopify-theme

`shopify theme` operates on storefront Liquid/CSS/JS files. `shopify app` operates on embedded app code (React, Node, Prisma, extensions). Different repos, different deployment targets.
