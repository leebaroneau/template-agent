# git-worktree skill

Use this skill any time you need to read or modify code in a GitHub repo.

## When to use

- Before writing or editing any code in a repo
- Before running repo-specific tests or commands
- When asked to investigate, fix, or add something in a codebase

## Your profile name

Your profile name is available as `$PROFILE_NAME` in your environment.
Always pass it as the first argument to `hermes-worktree`. Never hardcode it.

## Full lifecycle

### 1. Start a task — create a worktree

```bash
# Check your access first
hermes-worktree list

# Create the worktree — prints the path on stdout
WORKTREE=$(hermes-worktree add $PROFILE_NAME <repo> <branch>)
cd "$WORKTREE"
```

### 2. Name your branch correctly

Generic defaults:
- `feature/<short-description>` — new functionality
- `fix/<short-description>` — bug fix
- `task/<short-description>` — chore or refactor
- `spike/<short-description>` — investigation

**Pipeline-core governed repos** (any repo with `.github/pipeline-config.yml`):
Branch names MUST include the GitHub issue number: `<type>/<issue-number>-<slug>`
Example: `feature/42-add-rate-limiting`
You must open the GitHub issue BEFORE creating the branch. Check `AGENTS.md` in
the repo for the exact convention before naming anything.

### 3. Do the work

Work normally in the worktree — it is a standard git checkout.
`git status`, `git add`, `git commit`, `git push` all work as expected.

### 4. Open the PR

```bash
# Push your branch
git push origin <branch>

# Open the PR with gh CLI — always use Fixes #<issue> for pipeline-core repos
gh pr create --title "<title>" --body "Fixes #<issue-number>"
```

### 5. Clean up — remove the worktree

```bash
hermes-worktree remove $PROFILE_NAME <repo>
```

The branch continues to exist in the bare clone until the PR merges.
Remove it after merge: `git -C /opt/repos/bare/<repo>.git branch -d <branch>`

## If access is denied

```
ERROR: Profile 'coder' has no repo access. Add REPOS=<repo> to .../.env
```

Stop immediately. Report the exact error message to the user.
Do not attempt to work around the restriction. The user must grant access.

## Checking what's active

```bash
hermes-worktree list
```

Shows all profiles' active worktrees across all repos. Use this before starting
work to see if another profile is already on a branch in the same repo.

## Never

- Do not use `hermes -w` for multi-profile shared repo work (no access governance)
- Do not create a worktree on `main`, `master`, `develop`, or `HEAD`
- Do not leave worktrees open after the PR is merged
- Do not skip the `hermes-worktree add` step and work directly in the bare clone
