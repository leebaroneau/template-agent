---
name: review
description: Agent-driven review of pending changes before requesting human review. Runs doctor, lints the diff against repo conventions, summarizes risk.
---

# Review

Use after staging changes, before opening / updating a PR.

## Steps

1. `git diff --stat` — print files touched.
2. `./scripts/doctor` — full local gate. Must pass before continuing.
3. For each touched file under `docs/`, confirm cross-links resolve (the doctor handles this; do not bypass).
4. Inspect `repo.harness.json` — if any platform/runtime/deploy assumption changed, the contract must reflect it.
5. Check no `.env` / secrets staged: `git diff --cached --name-only | grep -E '(^|/)\.env(\.|$)' && echo SECRET STAGED && exit 1`.
6. Summarize the change as: **What** (one sentence), **Why** (link to issue/plan), **Risk** (one of low/medium/high with reason), **Validated by** (which doctor step / preview URL).

## Failure remediation

- doctor fails on healthcheck/baked-CMD/compose contract → fix per the printed error string, then rerun.
- doctor fails on contract validation → update `repo.harness.json` to match reality, do NOT remove the check.
- Cross-link broken → either fix the link or remove the dangling reference.
