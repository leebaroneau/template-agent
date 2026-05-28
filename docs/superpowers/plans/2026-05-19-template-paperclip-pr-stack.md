# Template Paperclip PR Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the template branch test Paperclip PR1-3 behavior directly and remove template-side overlap now owned by Paperclip.

**Architecture:** Keep the template branch as a draft-PR test surface. Build Paperclip from the PR3 branch during template testing, remove the Hermes defaults patch that PR1 replaces, and make profile-sync adopt Paperclip `metadata.runtimeIdentity.hermesHome` when present while retaining fallback behavior for older builds.

**Tech Stack:** Dockerfile, Bash entrypoint, Node.js profile-sync tests/scripts, README docs, Docker Compose validation.

---

### Task 1: Add Regression Tests

**Files:**
- Modify: `paperclip/profile-sync.test.mjs`
- Modify: `scripts/test-blank-template.sh`

- [x] Add a profile-sync test where a `hermes_local` agent has `metadata.runtimeIdentity.hermesHome`, proving the patch payload preserves that home and only adds `GBRAIN_HOME`/`PAPERCLIP_API_URL`.
- [x] Add a blank-template shell assertion that `patch-paperclip-hermes-defaults` is no longer copied or run.
- [x] Run `node --test paperclip/profile-sync.test.mjs` and `./scripts/test-blank-template.sh`; expect the new checks to fail before implementation.

### Task 2: Remove PR1-Owned Patch

**Files:**
- Modify: `paperclip/entrypoint.sh`
- Modify: `paperclip/Dockerfile`
- Delete: `paperclip/patch-paperclip-hermes-defaults.mjs`
- Delete: `paperclip/patch-paperclip-hermes-defaults.test.mjs`

- [x] Remove the env export/patch calls from the entrypoint.
- [x] Remove the Dockerfile copy for the deleted patch file.
- [x] Delete the patch and its test.
- [x] Run `node --test paperclip/*.test.mjs`; expect no imports of the deleted patch remain.

### Task 3: Adopt Paperclip Runtime Identity in Profile Sync

**Files:**
- Modify: `paperclip/profile-sync.mjs`
- Modify: `paperclip/profile-sync.test.mjs`

- [x] Add a helper that reads `agent.metadata.runtimeIdentity.hermesHome` and uses it as the Hermes home when present.
- [x] Keep profile slug fallback from `runtimeIdentity.profileSlug`, `agentStackProfileSlug`, or Hermes profile metadata.
- [x] Preserve template-managed `GBRAIN_HOME`, `PAPERCLIP_API_URL`, capabilities, org chart, and manifest behavior.
- [x] Run `node --test paperclip/profile-sync.test.mjs`; expect the new and existing tests to pass.

### Task 4: Document PR Branch Testing and Remaining Patches

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.env.coolify.example`
- Modify: `scripts/coolify-env.sh`

- [x] Document that this branch is for testing against Paperclip PR1-3 and uses the PR3 branch/commit until Paperclip publishes a release.
- [x] Remove obsolete README patch table/test references to `patch-paperclip-hermes-defaults`.
- [x] Keep the remaining patch table limited to behavior not owned by PR1-3.
- [x] Add env values showing the test branch assumption without leaking deployment secrets.

### Task 5: Verify, Review, Commit, Push, PR

**Files:** all changed files.

- [x] Run `npm test`.
- [x] Run `docker compose --env-file .env.example config --services`.
- [x] Run Docker/image checks when Dockerfile changes.
- [x] Send final diff to Claude review and fix blocking feedback.
- [ ] Commit and push `feat/tool-access-governance-template`.
- [ ] Open or update a draft PR for template testing.
