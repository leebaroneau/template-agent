---
name: pipeline-workflow
description: Use BEFORE opening any PR in a repo that has pipeline-core installed (any repo with `.github/pipeline-config.yml` or `.github/workflows/pipeline-*.yml`). Enforces the issue-first sequence so `pipeline/branch-name`, `pipeline/issue-link`, and `pipeline/merge-gate` checks all go green.
triggers:
  - "open a PR"
  - "start a feature"
  - "fix a bug"
  - "create a branch"
  - "make changes to"
  - "ship a fix"
---

# Pipeline Core PR Workflow

**Before editing files, opening PRs, creating branches, or committing — follow this sequence.**

## When this applies

A repo is governed by pipeline-core if ANY of these is true:
- `.github/pipeline-config.yml` exists
- `.github/workflows/pipeline-*.yml` files exist

Check with:
```bash
gh api repos/<owner>/<repo>/contents/.github/pipeline-config.yml --silent && echo "pipeline-core repo"
```

## The 5-step sequence

### 1. Create the issue FIRST

```bash
gh issue create \
  --repo <owner>/<repo> \
  --title "<Prefix>: <concise title>" \
  --label "type:<label>" \
  --body "<what + why>"
```

| type: label | Title prefix | Use for |
|---|---|---|
| `type:bug` | `Bug:` | Something works wrong now |
| `type:story` | `Feature request:` | User-facing feature |
| `type:task` | `Task:` | Refactor, docs, deps, infra |
| `type:spike` | `Spike:` | Time-boxed investigation |
| `type:experiment` | `Experiment:` | Hypothesis test |
| `type:epic` | `Epic:` | Tracks multiple sub-issues |

Capture the issue number from the output — you need it for the branch name.

### 2. Branch as `<type>/<#>-<slug>`

Valid branch name regex: `^(bug|story|task|spike|experiment|epic)/[0-9]+-[a-z0-9-]+$`

```bash
git checkout -b task/42-fix-thing
```

Pass: `bug/16-fix-login`, `task/103-bump-node`, `story/77-add-filter`
Fail: `feature/add-x` (wrong type), `task/fix-thing` (no number), `chore/thing` (invalid)

### 3. Do the work

Standard git. Commit messages don't need a special format.

### 4. Open the PR with `Fixes #<N>` in the body

```bash
git push origin <branch>

gh pr create \
  --title "<matches the issue title>" \
  --body "Fixes #<issue-number>

## Summary
<what changed and why>

## Test plan
- [ ] <how to verify>"
```

`Fixes #N` satisfies `pipeline/issue-link` AND auto-closes the issue on merge.

### 5. CI statuses that fire automatically

- `pipeline/branch-name` ✓ — branch matches the regex
- `pipeline/issue-link` ✓ — PR body contains `Fixes #N`
- `pipeline/merge-gate` ✓ — aggregates the above

## Bundling multiple fixes in one PR

Open both issues first, then use multiple `Fixes` lines. Branch name uses the primary issue:

```
Fixes #16
Fixes #17
```

## Never

- Create a branch before opening the issue
- Use `feature/`, `fix/`, `chore/` prefix — these fail `pipeline/branch-name`
- Merge with red `pipeline/*` statuses
