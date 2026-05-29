---
name: gsc-health-check
description: Weekly Google Search Console health probe. Fetches coverage errors, indexing issues, Core Web Vitals failures, and search performance delta. Ranks findings by revenue impact and creates a Paperclip issue when actionable problems exist.
triggers:
  - "GSC"
  - "Google Search Console"
  - "search console"
  - "indexing errors"
  - "coverage errors"
  - "site health check"
---

# GSC Health Check

Run this skill on a weekly cron schedule. It reads configured GSC properties, fetches current health data, ranks findings by revenue impact, writes a GBrain report, and creates a Paperclip issue when actionable problems are found.

## Required Environment Variables

The operator must supply these at runtime. They are never stored in the template.

```
GSC_SERVICE_ACCOUNT_JSON   Base64-encoded Google service account JSON with Search Console read scope
GSC_PROPERTY_URLS          Comma-separated list of Search Console property URLs to check
GSC_ISSUE_THRESHOLD        Minimum number of findings before creating a Paperclip issue (default: 1)
```

If any required variable is missing or empty, stop and write a single-line error report to `/data/agent-stack/reports/gsc/error-<date>.md` explaining which variable is missing. Do not proceed.

## Run Steps

### 1. Decode credentials

Decode `GSC_SERVICE_ACCOUNT_JSON` from base64 and write to a temp file. Use it for all API calls in this session. Delete it at the end of the run.

### 2. Fetch data for each property

For each URL in `GSC_PROPERTY_URLS`, call the Google Search Console APIs:

- **URL Inspection / Index Coverage API** — fetch pages with status `Excluded`, `Error`, or `Valid with warnings`. Limit to 50 most recent.
- **Search Analytics API** — fetch clicks, impressions, CTR, and average position for the last 7 days vs the prior 7 days. Group by page.
- **Core Web Vitals** — fetch CrUX field data if available via the `searchanalytics` endpoint. Flag pages with `SLOW` LCP, FID, or CLS.

### 3. Rank findings by revenue impact

Apply the 100m framework sequencing — technical errors first because they suppress rankings that conversion and content depend on:

| Priority | Category | Reason |
|---|---|---|
| 1 | Indexing errors (`Crawled - currently not indexed`, `Discovered - currently not indexed`, server errors) | Active ranking suppression — pages that should rank but don't |
| 2 | Core Web Vitals failures | Google ranking signal; also damages conversion |
| 3 | Significant traffic drops (>15% impressions week-on-week) | Revenue signal — investigate before optimising |
| 4 | Pages with high impressions but low CTR (<2%) | Quick-win title/meta fixes that improve existing rankings |
| 5 | `Valid with warnings` (canonical issues, noindex on otherwise good pages) | Structural debt, lower urgency |

Cap the findings list at 10. If there are more than 10, surface the highest-priority category in full and note how many lower-priority findings were omitted.

### 4. Write the GBrain report

Write a dated Markdown report to:

```
/data/agent-stack/reports/gsc/YYYY-MM-DD.md
```

Report structure:

```markdown
# GSC Health Check — YYYY-MM-DD

## Summary
<One sentence: overall health signal and most urgent finding>

## Findings

### Priority 1 — Indexing Errors
<Table: URL | Error type | First detected | Recommended fix>

### Priority 2 — Core Web Vitals
<Table: URL | Metric | Status | Page type>

### Priority 3 — Traffic Drops
<Table: URL | Impressions (prior) | Impressions (current) | Delta %>

### Priority 4 — Low CTR Opportunities
<Table: URL | Impressions | CTR | Current title | Suggested improvement>

### Priority 5 — Structural Warnings
<Table: URL | Warning type | Recommended fix>

## Properties Checked
<List of GSC_PROPERTY_URLS checked>

## Data Window
Last 7 days vs prior 7 days
```

If a section has no findings, write `None found.` and move on. Do not omit sections.

### 5. Create a Paperclip issue if findings exceed threshold

If the total number of findings across all priorities is >= `GSC_ISSUE_THRESHOLD` (default 1):

Call `paperclip_create_issue` with:

- **Title:** `Task: GSC health check — <date> — <N> findings across <M> properties`
- **Body:** Top 5 findings from the ranked list, each with: URL, category, recommended fix, and expected impact. Link to the full GBrain report path.
- **Label:** `type:task`

If `GSC_ISSUE_THRESHOLD` is set to `0`, always create an issue regardless of finding count.

### 6. Clean up

Delete the temp credentials file. Confirm deletion before exiting.

## What This Skill Does Not Do

- Does not make any changes to the sites being checked.
- Does not submit URLs for re-indexing (read-only).
- Does not access analytics platforms other than GSC.
- Does not store credentials anywhere except the temp file deleted at end of run.

## Cron Setup (Operator Reference)

Run once to register the weekly schedule on a Hermes profile:

```bash
hermes cron create "0 9 * * 1" "Weekly GSC health check" \
  --skill gsc-health-check \
  --profile default \
  --deliver slack
```

Trigger immediately to verify credentials and output before the first scheduled run:

```bash
hermes cron run <job_id>
```
