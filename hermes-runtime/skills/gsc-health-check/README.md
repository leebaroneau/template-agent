# GSC Health Check Skill

Weekly Google Search Console health probe for Hermes profiles. Ranks indexing errors, Core Web Vitals failures, and traffic drops by revenue impact, then creates a Paperclip issue with a ranked fix list.

## Prerequisites

1. A Google Cloud service account with **Search Console API (read-only)** scope
2. The property URLs added to that service account in [Google Search Console](https://search.google.com/search-console) → Settings → Users and permissions
3. Hermes running with `paperclip_create_issue` available (requires `PAPERCLIP_API_KEY` and `PAPERCLIP_DEFAULT_COMPANY_ID`)

## Setup

### 1. Create and encode the service account

```bash
# Download the service account JSON from Google Cloud Console, then:
base64 -i service-account.json | tr -d '\n'
# Copy the output — this is your GSC_SERVICE_ACCOUNT_JSON value
```

### 2. Set env vars on the deployment

Add to your org's `.env` (not `.env.example` — never commit credentials):

```env
GSC_SERVICE_ACCOUNT_JSON=<base64-encoded JSON>
GSC_PROPERTY_URLS=https://example.com,https://www.example.com
GSC_ISSUE_THRESHOLD=1
```

Redeploy so Hermes picks up the new vars.

### 3. Register the cron job

SSH into the deployment or use the Hermes terminal, then:

```bash
hermes cron create "0 9 * * 1" "Weekly GSC health check" \
  --skill gsc-health-check \
  --profile default \
  --deliver slack
```

Adjust `--profile` to the profile that has Paperclip MCP access. Adjust `--deliver` to your notification channel (`slack`, `discord`, `email`, or `all`).

### 4. Verify before first scheduled run

```bash
hermes cron list                     # note the job_id
hermes cron run <job_id>             # trigger immediately
```

Check `/data/agent-stack/reports/gsc/` for the output report.

## Delivery

Each run writes a dated Markdown report to `/data/agent-stack/reports/gsc/YYYY-MM-DD.md` and (when findings exist) creates a Paperclip issue with the top findings ranked by revenue impact.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `GSC_SERVICE_ACCOUNT_JSON missing` in error report | Env var not set or not injected | Redeploy after setting the var |
| `403 Forbidden` from GSC API | Service account not added to the property | Add it in Search Console → Settings → Users |
| `paperclip_create_issue` fails | `PAPERCLIP_API_KEY` or `PAPERCLIP_DEFAULT_COMPANY_ID` not set | Set both vars and redeploy |
| Empty findings every week | Properties have no errors (good) or wrong property URLs | Verify URLs match exactly what's in Search Console |
