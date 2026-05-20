# Learning Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a task-scoped learning loop protocol to the template and live Coolify deployment.

**Architecture:** Reuse the existing shared protocol pattern: bake a neutral protocol file into the image, mirror it into `/data/agent-stack` and `/data/hermes`, copy it to role profile homes, and add an idempotent capabilities pointer for seeded and synced Paperclip agents. Keep Hermes config blank and rely on the existing role-specific `GBRAIN_HOME` plus `gbrain` CLI.

**Tech Stack:** Bash entrypoints, Node.js profile-sync/seed scripts, Node test runner, Docker Compose, GBrain CLI.

---

### Task 1: Add Learning Protocol Tests

**Files:**
- Modify: `paperclip/profile-sync.test.mjs`
- Modify: `paperclip/seed-agents.test.mjs`

- [ ] **Step 1: Write failing profile-sync tests**

Add assertions that `buildManagedAgentPayload` appends one `Learning Protocol` pointer and `ensureProfileHomes` creates `LEARNING_PROTOCOL.md`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test paperclip/profile-sync.test.mjs`
Expected: FAIL because learning protocol constants and file copy are not implemented.

### Task 2: Implement Template Learning Protocol

**Files:**
- Create: `hermes-runtime/templates/LEARNING_PROTOCOL.md`
- Create: `paperclip/learning-protocol.md`
- Modify: `paperclip/profile-sync.mjs`
- Modify: `paperclip/seed-agents.mjs`
- Modify: `hermes-runtime/scripts/bootstrap-profiles.sh`
- Modify: `paperclip/entrypoint.sh`
- Modify: `paperclip/Dockerfile`

- [ ] **Step 1: Add protocol files**

Create neutral Markdown protocols describing the task-scoped learning loop and relevant runtime paths.

- [ ] **Step 2: Copy protocol into runtime locations**

Mirror the shared file to `/data/agent-stack/learning-protocol.md`, `/data/hermes/LEARNING_PROTOCOL.md`, and profile homes.

- [ ] **Step 3: Add idempotent capabilities pointer**

Seeded and synced agents receive a single pointer to the shared protocol and fallback profile copy.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass.

### Task 3: Docs And Live Deployment

**Files:**
- Modify: `README.md`
- Modify: `docs/design.md`

- [ ] **Step 1: Document the protocol**

Add the learning protocol paths, what agents should write to GBrain, and what they must avoid.

- [ ] **Step 2: Build and audit image**

Run:

```bash
docker compose --env-file .env.example build
./scripts/audit-blank-image.sh template-agent:local
```

Expected: build succeeds and audit passes.

- [ ] **Step 3: Hot-patch live Coolify volume**

Copy the protocol into the running Paperclip container volume and run profile bootstrap/profile sync once if needed.

- [ ] **Step 4: Verify live paths**

Run container checks for:

```text
/data/agent-stack/learning-protocol.md
/data/hermes/LEARNING_PROTOCOL.md
```

Expected: both files exist in the live shared volume.
