# Remove GBrain from template-agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all GBrain tooling, env vars, skill wiring, and init logic from the template-agent image — leaving agents relying solely on Hermes' native memory system (`memory` tool, `session_search`, `skill_manage`).

**Architecture:** 10 files modified, 2 files deleted, 1 file rewritten. Build: strip the gbrain clone from Dockerfile. Runtime: remove GBRAIN_* env vars from entrypoints and compose. Logic: strip gbrain home setup from profile-sync.mjs and bootstrap-profiles.sh. Templates: replace GBrain references in SOUL.md and LEARNING_PROTOCOL.md with session_search. Tests: remove gbrain fixtures and assertions.

**Tech Stack:** Bash (entrypoints, bootstrap), Node.js ESM (profile-sync.mjs, seed-agents.mjs), YAML (config, compose), Markdown (templates), Node test runner (profile-sync.test.mjs)

---

## Important: pipeline-core Workflow

This repo is governed by pipeline-core. Every change requires: **issue → branch → PR**. Do not skip the issue step.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `paperclip/Dockerfile` | Modify | Remove `ARG GBRAIN_REF`, `ENV GBRAIN_*`, gbrain clone RUN block, `COPY gbrain-wrapper.sh`, `chmod +x gbrain` |
| `paperclip/gbrain-wrapper.sh` | **Delete** | Entire file |
| `hermes-runtime/skills/gbrain/` | **Delete** | Entire directory |
| `paperclip/hermes-entrypoint.sh` | Modify | Remove `GBRAIN_DATA_ROOT`, `GBRAIN_HOME` exports and mkdir |
| `paperclip/entrypoint.sh` | Modify | Remove `GBRAIN_DATA_ROOT`, `GBRAIN_HOME`, `gbrain --version`, gbrain env in profile-sync launch |
| `paperclip/profile-sync.mjs` | Modify | Remove `GBRAIN_TEMPLATE_PATHS`, `cloneDefaultGbrainTemplate`, gbrain params from `buildManagedAgentPayload`/`ensureProfileHomes`/`retireProfileHomes`/`reconcileAgents` |
| `paperclip/seed-agents.mjs` | Modify | Remove `GBRAIN_HOME` from role env, remove GBrain sentence from `LEARNING_PROTOCOL_POINTER` |
| `hermes-runtime/scripts/bootstrap-profiles.sh` | Modify | Remove `GBRAIN_DATA_ROOT`, `install_gbrain_skills()`, gbrain home setup, gbrain init |
| `compose.yaml` | Modify | Remove `GBRAIN_DATA_ROOT` and `GBRAIN_HOME` from both services |
| `.env.example` | Modify | Remove `GBRAIN_REF`, change `PROFILE_SYNC_DEFAULT_COMPANY_SKILLS` |
| `.env.coolify.example` | Modify | Same as `.env.example` |
| `hermes-runtime/templates/SOUL.default.md` | Modify | Remove "Durable knowledge: GBrain." from Identity |
| `hermes-runtime/templates/LEARNING_PROTOCOL.md` | Modify | Rewrite: replace GBrain CLI with `session_search` + `memory` tool |
| `paperclip/profile-sync.test.mjs` | Modify | Remove gbrain fixtures, assertions, and `cloneDefaultGbrainTemplate` test |
| `scripts/test-blank-template.sh` | Modify | Remove gbrain skill presence checks |

---

## Task 1: Open GitHub Issue + Create Branch

- [ ] **Create the issue**

```bash
cd /path/to/template-agent   # adjust to your local clone

gh issue create \
  --repo leebaroneau/template-agent \
  --title "Task: remove GBrain tooling from template-agent image and runtime" \
  --label "type:task" \
  --body "Remove all GBrain tooling, env vars, skill wiring, and init logic from the template-agent stack.

## Why
Hermes has native three-tier memory (memory tool + session_search + skill_manage) that handles all use cases GBrain was filling. GBrain adds build time (gbrain clone), runtime overhead (per-profile init), and ops complexity (PGLite volumes, GBRAIN_HOME env management) without delivering proportional value.

## Scope
- Dockerfile: remove gbrain clone RUN block, GBRAIN_* ENV, wrapper script
- Entrypoints: remove GBRAIN_* exports and mkdir
- profile-sync.mjs: remove buildManagedAgentPayload gbrain params, ensureProfileHomes gbrain init, retireProfileHomes gbrain archival, cloneDefaultGbrainTemplate function
- bootstrap-profiles.sh: remove install_gbrain_skills(), gbrain home setup, gbrain init
- compose.yaml + env files: remove GBRAIN_* vars
- Templates: replace GBrain CLI references with session_search + memory tool
- Tests: remove gbrain fixtures and assertions
- Delete: paperclip/gbrain-wrapper.sh, hermes-runtime/skills/gbrain/"
```

- [ ] **Note the issue number** (referred to as `$N` in remaining tasks)

- [ ] **Create branch**

```bash
git checkout main
git pull origin main
git checkout -b task/$N-remove-gbrain
```

---

## Task 2: Dockerfile — strip GBrain build steps

**Files:**
- Modify: `paperclip/Dockerfile`

- [ ] **Run build smoke to confirm current state builds cleanly**

```bash
docker build -f paperclip/Dockerfile . --target base 2>&1 | tail -5 || true
# Just confirms starting state — failure here means pre-existing issue
```

- [ ] **Remove `ARG GBRAIN_REF` (line 6)**

Find and remove:
```dockerfile
ARG GBRAIN_REF=eval-run-v0.35.1.0-baseline
```

- [ ] **Remove `ENV GBRAIN_DATA_ROOT` and `ENV GBRAIN_HOME` (lines 12–13)**

Find and remove both lines:
```dockerfile
ENV GBRAIN_DATA_ROOT=/data/gbrain
ENV GBRAIN_HOME=/data/gbrain/default
```

- [ ] **Remove the entire gbrain clone RUN block (lines 63–68)**

Find and remove:
```dockerfile
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    git clone https://github.com/garrytan/gbrain.git /opt/gbrain \
  && cd /opt/gbrain \
  && git fetch --depth 1 origin "${GBRAIN_REF}" \
  && git checkout FETCH_HEAD \
  && bun install --production
```

- [ ] **Remove `COPY paperclip/gbrain-wrapper.sh /usr/local/bin/gbrain`**

Find and remove that COPY line.

- [ ] **Remove `chmod +x /usr/local/bin/gbrain` from the final RUN block**

The final RUN block contains `chmod +x /usr/local/bin/gbrain` — remove that line.

- [ ] **Commit**

```bash
git add paperclip/Dockerfile
git commit -m "Remove GBrain from Dockerfile build"
```

---

## Task 3: Delete gbrain-wrapper.sh and skills/gbrain/

**Files:**
- Delete: `paperclip/gbrain-wrapper.sh`
- Delete: `hermes-runtime/skills/gbrain/` (entire directory)

- [ ] **Delete the files**

```bash
rm paperclip/gbrain-wrapper.sh
rm -rf hermes-runtime/skills/gbrain/
```

- [ ] **Verify they are gone**

```bash
ls paperclip/gbrain-wrapper.sh 2>&1 | grep "No such file"
ls hermes-runtime/skills/gbrain/ 2>&1 | grep "No such file"
```

- [ ] **Commit**

```bash
git add -A paperclip/gbrain-wrapper.sh hermes-runtime/skills/gbrain/
git commit -m "Delete gbrain-wrapper.sh and bundled gbrain skill"
```

---

## Task 4: Entrypoints — remove GBRAIN env and mkdir

**Files:**
- Modify: `paperclip/hermes-entrypoint.sh`
- Modify: `paperclip/entrypoint.sh`

### hermes-entrypoint.sh

- [ ] **Remove `export GBRAIN_DATA_ROOT` line**

Find and remove:
```bash
export GBRAIN_DATA_ROOT="${GBRAIN_DATA_ROOT:-/data/gbrain}"
```

- [ ] **Remove `export GBRAIN_HOME` line**

Find and remove:
```bash
export GBRAIN_HOME="${GBRAIN_HOME:-$GBRAIN_DATA_ROOT/default}"
```

- [ ] **Remove `$GBRAIN_DATA_ROOT` from mkdir**

Change:
```bash
mkdir -p "$HERMES_DATA_ROOT" "$GBRAIN_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks
```
To:
```bash
mkdir -p "$HERMES_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks
```

### entrypoint.sh

- [ ] **Remove `export GBRAIN_DATA_ROOT` line**

Find and remove:
```bash
export GBRAIN_DATA_ROOT="${GBRAIN_DATA_ROOT:-/data/gbrain}"
```

- [ ] **Remove `export GBRAIN_HOME` line**

Find and remove:
```bash
export GBRAIN_HOME="${GBRAIN_HOME:-$GBRAIN_DATA_ROOT/default}"
```

- [ ] **Remove `$GBRAIN_DATA_ROOT` from mkdir**

Change:
```bash
mkdir -p "$HERMES_DATA_ROOT" "$GBRAIN_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks
```
To:
```bash
mkdir -p "$HERMES_DATA_ROOT" /home/node/.hermes /opt/work /data/.locks
```

- [ ] **Remove `gbrain --version` check**

Find and remove:
```bash
runuser -u node -- env HERMES_HOME="$HERMES_HOME" GBRAIN_HOME="$GBRAIN_HOME" gbrain --version
```

- [ ] **Remove `GBRAIN_DATA_ROOT` from profile-sync launch block**

In the profile-sync launch block, find and remove:
```bash
    GBRAIN_DATA_ROOT="$GBRAIN_DATA_ROOT" \
```

- [ ] **Commit**

```bash
git add paperclip/hermes-entrypoint.sh paperclip/entrypoint.sh
git commit -m "Remove GBRAIN env exports and mkdir from entrypoints"
```

---

## Task 5: profile-sync.mjs — remove all GBrain logic

**Files:**
- Modify: `paperclip/profile-sync.mjs`

This is the largest change. Work top-to-bottom through the file.

- [ ] **Remove `GBRAIN_TEMPLATE_PATHS` constant**

Find and remove the entire const:
```js
const GBRAIN_TEMPLATE_PATHS = [
  '.gbrain/skills',
  '.gbrain/prompts',
  '.gbrain/conventions',
  'gbrain.yml',
  'gbrain.yaml',
];
```

- [ ] **Remove GBrain sentence from `LEARNING_PROTOCOL_POINTER`**

Change:
```js
const LEARNING_PROTOCOL_POINTER = [
  `Learning Protocol: At task start and finish, read ${LEARNING_PROTOCOL_PATH}.`,
  `If that shared file is unavailable, read ${LEARNING_PROTOCOL_FILE} in your HERMES_HOME.`,
  'Use your role-specific GBRAIN_HOME for durable learned summaries; do not crawl all of /data.',
].join(' ');
```
To:
```js
const LEARNING_PROTOCOL_POINTER = [
  `Learning Protocol: At task start and finish, read ${LEARNING_PROTOCOL_PATH}.`,
  `If that shared file is unavailable, read ${LEARNING_PROTOCOL_FILE} in your HERMES_HOME.`,
].join(' ');
```

- [ ] **Strip `gbrainDataRoot` param and all gbrain logic from `buildManagedAgentPayload`**

Remove `gbrainDataRoot = '/data/gbrain',` from the destructured params.

Remove these two lines from the function body:
```js
const gbrainHome = join(gbrainDataRoot, profileSlug);
```

Change `adapterConfig.env` from:
```js
    env: {
      ...existingEnv,
      HERMES_HOME: hermesHome,
      GBRAIN_HOME: gbrainHome,
      PAPERCLIP_API_URL: paperclipServerUrl,
    },
```
To:
```js
    env: {
      ...existingEnv,
      HERMES_HOME: hermesHome,
      PAPERCLIP_API_URL: paperclipServerUrl,
    },
```

Remove `agentStackGbrainHome: gbrainHome,` from the returned metadata object.

- [ ] **Strip `gbrainDataRoot` and `initGbrain` params from `ensureProfileHomes`**

Remove from the destructured params:
```js
  gbrainDataRoot = '/data/gbrain',
```
and:
```js
  initGbrain = true,
```

Remove from the function body:
```js
  const gbrainHome = join(gbrainDataRoot, profileSlug);
```
```js
  await mkdir(gbrainHome, { recursive: true });
```

Inside the `if (profileSlug !== 'default')` block, remove:
```js
    await cloneDefaultGbrainTemplate({ gbrainDataRoot, gbrainHome });
```

Remove the entire gbrain init block:
```js
  if (initGbrain && !(await exists(join(gbrainHome, '.gbrain', 'config.json')))) {
    await runCommand('gbrain', ['init', '--pglite'], { GBRAIN_HOME: gbrainHome });
    await runCommand('gbrain', ['config', 'set', 'search.mode', 'conservative'], {
      GBRAIN_HOME: gbrainHome,
    }, { allowFailure: true });
  }
```

Change return value from:
```js
  return {
    hermesHome,
    gbrainHome,
    modelConfig: await readHermesModelConfig(join(hermesHome, 'config.yaml')),
  };
```
To:
```js
  return {
    hermesHome,
    modelConfig: await readHermesModelConfig(join(hermesHome, 'config.yaml')),
  };
```

- [ ] **Strip `gbrainDataRoot` param from `retireProfileHomes`**

Remove from destructured params:
```js
  gbrainDataRoot = '/data/gbrain',
```

Remove from function body:
```js
  const gbrainHome = join(gbrainDataRoot, profileSlug);
```

In the `purge` branch, remove:
```js
    await rm(gbrainHome, { recursive: true, force: true });
```

In the `archive` branch, remove:
```js
  await moveIfExists(gbrainHome, join(gbrainDataRoot, 'archive', `${profileSlug}-${stamp}`));
```

- [ ] **Strip `gbrainDataRoot` and `initGbrain` params from `reconcileAgents`**

Remove from the destructured params:
```js
  gbrainDataRoot = '/data/gbrain',
```
and:
```js
  initGbrain = true,
```

Find where these params are forwarded to `ensureHomes` calls inside the function body and remove those two forwarded keys.

- [ ] **Delete `cloneDefaultGbrainTemplate` function**

Find and remove the entire function:
```js
async function cloneDefaultGbrainTemplate({ gbrainDataRoot, gbrainHome }) {
  const defaultGbrainHome = join(gbrainDataRoot, 'default');
  if (defaultGbrainHome === gbrainHome || !(await exists(defaultGbrainHome))) return;

  for (const relativePath of GBRAIN_TEMPLATE_PATHS) {
    await copyTreeMissing(
      join(defaultGbrainHome, ...relativePath.split('/')),
      join(gbrainHome, ...relativePath.split('/')),
      () => false,
    );
  }
}
```

- [ ] **Run the test suite to verify no syntax errors or regressions so far**

```bash
node --test paperclip/profile-sync.test.mjs 2>&1 | tail -20
# Expected: some test failures (gbrain assertions not yet removed), but no syntax errors
```

- [ ] **Commit**

```bash
git add paperclip/profile-sync.mjs
git commit -m "Remove GBrain logic from profile-sync.mjs"
```

---

## Task 6: seed-agents.mjs — remove GBRAIN_HOME env and GBrain pointer sentence

**Files:**
- Modify: `paperclip/seed-agents.mjs`

- [ ] **Remove GBrain sentence from `LEARNING_PROTOCOL_POINTER`**

In seed-agents.mjs, find the `LEARNING_PROTOCOL_POINTER` array and remove the last element:
```js
  'Use your role-specific GBRAIN_HOME for durable learned summaries; do not crawl all of /data.',
```

- [ ] **Remove `GBRAIN_HOME` from the role env**

Find the env assignment that includes `GBRAIN_HOME: \`/data/gbrain/${profile}\`` and remove that line.

- [ ] **Commit**

```bash
git add paperclip/seed-agents.mjs
git commit -m "Remove GBRAIN_HOME from seed-agents.mjs"
```

---

## Task 7: bootstrap-profiles.sh — remove gbrain init

**Files:**
- Modify: `hermes-runtime/scripts/bootstrap-profiles.sh`

- [ ] **Remove `GBRAIN_DATA_ROOT` variable (line 5)**

Find and remove:
```bash
GBRAIN_DATA_ROOT="${GBRAIN_DATA_ROOT:-/opt/data/gbrain}"
```

- [ ] **Remove `$GBRAIN_DATA_ROOT` from the initial mkdir (line 9)**

Change:
```bash
mkdir -p "$HERMES_DATA_ROOT/profiles" "$GBRAIN_DATA_ROOT"
```
To:
```bash
mkdir -p "$HERMES_DATA_ROOT/profiles"
```

- [ ] **Delete the `install_gbrain_skills` function (lines 30–48)**

Find and remove the entire function:
```bash
install_gbrain_skills() {
  local profile_home="$1"
  local gbrain_source="${GBRAIN_SKILLS_SOURCE:-/opt/gbrain/skills}"
  local gbrain_dest="$profile_home/skills/gbrain"

  if [[ ! -d "$gbrain_source" ]]; then
    return 0
  fi

  mkdir -p "$gbrain_dest"
  for skill_dir in "$gbrain_source"/*; do
    [[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || continue
    local name
    name="$(basename "$skill_dir")"
    if [[ -e "$gbrain_dest/$name" && ! -L "$gbrain_dest/$name" ]]; then
      continue
    fi
    ln -sfn "$skill_dir" "$gbrain_dest/$name"
  done
}
```

- [ ] **Remove `gbrain_home` setup in the profile creation loop**

In the loop body, find and remove:
```bash
  gbrain_home="$GBRAIN_DATA_ROOT/$profile"
```

Change:
```bash
  mkdir -p "$profile_home" "$gbrain_home"
```
To:
```bash
  mkdir -p "$profile_home"
```

- [ ] **Remove `install_gbrain_skills` call**

Find and remove:
```bash
  install_gbrain_skills "$profile_home"
```

- [ ] **Remove gbrain init block**

Find and remove:
```bash
  if [[ ! -f "$gbrain_home/.gbrain/config.json" ]]; then
    GBRAIN_HOME="$gbrain_home" gbrain init --pglite
    GBRAIN_HOME="$gbrain_home" gbrain config set search.mode conservative >/dev/null 2>&1 || true
  fi
```

- [ ] **Commit**

```bash
git add hermes-runtime/scripts/bootstrap-profiles.sh
git commit -m "Remove install_gbrain_skills and gbrain init from bootstrap-profiles.sh"
```

---

## Task 8: compose.yaml + env files — remove GBRAIN_ vars

**Files:**
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `.env.coolify.example`

### compose.yaml

- [ ] **Remove `GBRAIN_DATA_ROOT` and `GBRAIN_HOME` from the `paperclip` service**

Find and remove both lines from the `paperclip` service environment block:
```yaml
      GBRAIN_DATA_ROOT: /data/gbrain
      GBRAIN_HOME: /data/gbrain/default
```

- [ ] **Remove `GBRAIN_DATA_ROOT` and `GBRAIN_HOME` from the `hermes` service**

Find and remove both lines from the `hermes` service environment block:
```yaml
      GBRAIN_DATA_ROOT: /data/gbrain
      GBRAIN_HOME: /data/gbrain/default
```

### .env.example

- [ ] **Remove `GBRAIN_REF` line**

Find and remove:
```
GBRAIN_REF=master
```

- [ ] **Remove gbrain from `PROFILE_SYNC_DEFAULT_COMPANY_SKILLS`**

Change:
```
PROFILE_SYNC_DEFAULT_COMPANY_SKILLS=gbrain,use-100m-framework
```
To:
```
PROFILE_SYNC_DEFAULT_COMPANY_SKILLS=use-100m-framework
```

### .env.coolify.example

- [ ] **Same two changes as .env.example**

Change:
```
PROFILE_SYNC_DEFAULT_COMPANY_SKILLS=gbrain,use-100m-framework
```
To:
```
PROFILE_SYNC_DEFAULT_COMPANY_SKILLS=use-100m-framework
```

Remove:
```
GBRAIN_REF=master
```

- [ ] **Commit**

```bash
git add compose.yaml .env.example .env.coolify.example
git commit -m "Remove GBRAIN_* env vars from compose.yaml and env examples"
```

---

## Task 9: Templates — replace GBrain with session_search

**Files:**
- Modify: `hermes-runtime/templates/SOUL.default.md`
- Modify: `hermes-runtime/templates/LEARNING_PROTOCOL.md`

### SOUL.default.md

- [ ] **Remove "Durable knowledge: GBrain." from the Identity section**

The Identity section currently reads:
```markdown
## Identity
Hermes role in a Paperclip agent stack. Task context: your Paperclip issue. Durable knowledge: GBrain. Working memory: `memories/`.
```

Change to:
```markdown
## Identity
Hermes role in a Paperclip agent stack. Task context: your Paperclip issue. Working memory: `memories/`.
```

- [ ] **Verify byte count still under 1024**

```bash
wc -c hermes-runtime/templates/SOUL.default.md
# Expected: < 1024
```

### LEARNING_PROTOCOL.md

- [ ] **Rewrite the file to replace GBrain CLI with session_search + memory tool**

Replace the entire file content with:

```markdown
# Learning Protocol

This is the Hermes-profile mirror of the shared Paperclip learning protocol.
The canonical runtime copy is `/data/agent-stack/learning-protocol.md`.

When the shared file is unavailable, follow this local copy.

## 1. Start With What You Already Know

At the start of meaningful work, search your prior session history before
assuming you have no relevant context.

```
session_search(query="<project, client, issue, or concept>")
```

If session_search returns no useful context, continue from the Paperclip task.

## 2. Read Only Relevant Runtime Context

You can inspect the shared `/data` volume, but do not browse it aimlessly.

Prioritize:
- The current Paperclip issue, project, and attached artifacts.
- Paths listed in `/data/agent-stack/important-information-index.md`.
- Relevant files under `/data/instances/default/projects/`.
- Your own Hermes profile home at `$HERMES_HOME`.

Avoid:
- Crawling every project.
- Reading unrelated role profile directories.
- Copying runtime databases, sessions, logs, or secrets into memory.
- Treating every transient task detail as durable knowledge.

## 3. Capture Durable Learning

At task end, save concise durable facts when the work produced reusable context.

```python
memory(action="add", target="memory", content="<compact fact — under 200 chars>")
```

Save: decisions, conventions, client facts, role-specific notes, known risks.
Do not save: transient task state, logs, raw transcripts, another profile's notes.

## 4. Maintain The Shared Index

When you discover a pointer that many roles will need, update:

```text
/data/agent-stack/important-information-index.md
```

Keep this index short. Link to durable sources instead of duplicating large content.

## 5. Leave A Trail

If you save durable memory facts, mention what you stored in the Paperclip issue
comment or final answer — so reviewers and future agents know what context exists.

## 6. Capture `$100M` Field Learnings

When a task applies the `$100M` framework and produces a reusable improvement,
save a sanitized note using the `memory` tool.

Key: `inbox/100m-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>`

Format:
- Proposed Improvement (one paragraph)
- Promotion Class: one of `clarity`, `example`, `pattern`, `strategic`
- Evidence (source citations)
- Why It Generalizes
- Why It May Not Generalize
- Suggested Framework Target

Never include client names, private metrics, customer names, secrets, raw
transcripts, or runtime database content.

## 7. Capture EOS Field Learnings

Same protocol as `$100M` field learnings. Key shape:

`inbox/eos-field-learning/<YYYY-MM-DD>-<company-or-profile-slug>-<short-topic>`

Never include client names, private metrics, or secrets.
```

- [ ] **Commit**

```bash
git add hermes-runtime/templates/SOUL.default.md hermes-runtime/templates/LEARNING_PROTOCOL.md
git commit -m "Replace GBrain references with session_search + memory tool in templates"
```

---

## Task 10: Tests — update profile-sync.test.mjs and test-blank-template.sh

**Files:**
- Modify: `paperclip/profile-sync.test.mjs`
- Modify: `scripts/test-blank-template.sh`

### profile-sync.test.mjs

- [ ] **Remove `GBRAIN_HOME` assertion from `buildManagedAgentPayload` test**

Find and remove:
```js
  assert.equal(payload.adapterConfig.env.GBRAIN_HOME, '/data/gbrain/acme-researcher');
```

- [ ] **Remove gbrain from `reconcileAgents` company skills fixture**

Find the `currentSkills` array in the `reconcileAgents creates missing default company skills` test and remove:
```js
    { key: 'company/gbrain', slug: 'gbrain', name: 'GBrain' },
```

- [ ] **Remove `gbrainHome` from `ensureHomes` mock return**

Find the mock `ensureHomes: async ({ profileSlug }) => ({ ... })` in reconcileAgents tests and remove:
```js
      gbrainHome: `/tmp/gbrain/${profileSlug}`,
```

- [ ] **Remove gbrain from `defaultCompanySkills` fixtures**

Find all test fixtures containing `defaultCompanySkills` and remove:
```js
      { slug: 'gbrain', name: 'GBrain', markdown: '# GBrain\n' },
```

- [ ] **Remove `company/gbrain` from expected `desiredSkills` assertions**

Find assertions on `patched[0].adapterConfig.paperclipSkillSync.desiredSkills` and remove `'company/gbrain'` from the expected array.

- [ ] **Update `ensureProfileHomes creates profile config, soul, and gbrain directory` test**

Rename the test to:
```js
test('ensureProfileHomes creates profile config, soul, and hermes home', async () => {
```

Remove `gbrainDataRoot` and `initGbrain` from the call:
```js
    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: join(root, 'hermes'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
    });
```

Remove gbrain assertions:
```js
    assert.equal(result.gbrainHome, join(root, 'gbrain/acme-researcher'));
```
and:
```js
    await stat(result.gbrainHome);
```

- [ ] **Remove `gbrainDataRoot` from all other `ensureProfileHomes` test calls**

Find every other `ensureProfileHomes({ ..., gbrainDataRoot: ..., ... })` call in the test file and remove the `gbrainDataRoot` key.

- [ ] **Remove `cloneDefaultGbrainTemplate` test block**

Find and remove the entire test:
```js
test('ensureProfileHomes clones default GBrain template into new profiles', async () => {
  ...
});
```
(This is the test around lines 534–564 that sets up `defaultGbrain` and checks skill propagation.)

- [ ] **Run the full test suite and verify it passes**

```bash
node --test paperclip/profile-sync.test.mjs 2>&1 | tail -20
# Expected: all tests pass, 0 failures
```

### test-blank-template.sh

- [ ] **Remove the gbrain skill presence checks**

Find and remove these two lines:
```bash
check_present "hermes-runtime/skills/gbrain/SKILL.md" '^name: gbrain$' "bundled GBrain skill has correct name"
check_present "hermes-runtime/skills/gbrain/SKILL.md" 'GBRAIN_HOME' "GBrain skill references GBRAIN_HOME"
```

- [ ] **Run the script to verify it still passes**

```bash
bash scripts/test-blank-template.sh 2>&1 | tail -10
# Expected: PASS or no gbrain-related failures
```

- [ ] **Commit**

```bash
git add paperclip/profile-sync.test.mjs scripts/test-blank-template.sh
git commit -m "Remove gbrain fixtures and assertions from tests"
```

---

## Task 11: Docs — remove GBrain references

**Files:**
- Modify: `README.md`
- Modify: `docs/design.md`
- Modify: `docs/deployment-standard.md`
- Modify: `docs/pre-deploy-backup.md`

- [ ] **Scan for remaining gbrain references**

```bash
grep -rn "gbrain\|GBRAIN\|GBrain" \
  README.md docs/ \
  --include="*.md" \
  | grep -v "Binary file"
```

- [ ] **For each hit: remove the line or replace with session_search/memory equivalent**

Key replacements:
- `gbrain search "<query>"` → `session_search(query="<query>")`
- "GBrain home at `$GBRAIN_HOME`" → remove or replace with "Hermes memory at `$HERMES_HOME/memories/`"
- `/data/gbrain/<company-role>` → remove
- Backup/restore references to `gbrain/` volume — remove or note "no longer needed"

- [ ] **Verify no gbrain references remain in docs**

```bash
grep -rn "gbrain\|GBRAIN\|GBrain" README.md docs/ --include="*.md"
# Expected: 0 matches
```

- [ ] **Commit**

```bash
git add README.md docs/
git commit -m "Remove GBrain references from docs"
```

---

## Task 12: Open Pull Request

- [ ] **Push branch**

```bash
git push -u origin task/$N-remove-gbrain
```

- [ ] **Open PR**

```bash
gh pr create \
  --repo leebaroneau/template-agent \
  --title "Task: remove GBrain tooling from template-agent image and runtime" \
  --body "Fixes #$N

## Summary

Removes all GBrain tooling from the template-agent stack. Hermes' native three-tier memory system (\`memory\` tool + \`session_search\` + \`skill_manage\`) handles all use cases GBrain was filling, without the build/runtime/ops overhead.

## Changes

- **Dockerfile**: removed \`ARG GBRAIN_REF\`, \`ENV GBRAIN_*\`, gbrain clone RUN block, wrapper script copy
- **Deleted**: \`paperclip/gbrain-wrapper.sh\`, \`hermes-runtime/skills/gbrain/\`
- **Entrypoints**: removed \`GBRAIN_DATA_ROOT\`/\`GBRAIN_HOME\` exports, mkdir, and \`gbrain --version\` check
- **profile-sync.mjs**: removed \`GBRAIN_TEMPLATE_PATHS\`, \`cloneDefaultGbrainTemplate\`, gbrain params from \`buildManagedAgentPayload\`/\`ensureProfileHomes\`/\`retireProfileHomes\`/\`reconcileAgents\`
- **seed-agents.mjs**: removed \`GBRAIN_HOME\` env, removed gbrain sentence from learning protocol pointer
- **bootstrap-profiles.sh**: removed \`install_gbrain_skills()\`, gbrain home setup, gbrain init
- **compose.yaml** + env files: removed \`GBRAIN_DATA_ROOT\`/\`GBRAIN_HOME\` env vars, \`GBRAIN_REF\`, updated \`PROFILE_SYNC_DEFAULT_COMPANY_SKILLS\`
- **Templates**: \`SOUL.default.md\` removes GBrain identity reference; \`LEARNING_PROTOCOL.md\` rewritten to use \`session_search\` + \`memory\` tool
- **Tests**: removed gbrain fixtures, \`gbrainHome\` assertions, \`cloneDefaultGbrainTemplate\` test

## Impact on live deployments

Existing \`/data/gbrain/\` volumes on haverford-droplet and genvest-droplet are untouched — no data loss. After next redeploy, agents no longer have the \`gbrain\` CLI. Native Hermes memory (\`session_search\`, \`memory\`, \`skill_manage\`) takes over.

## Test plan

- [ ] \`node --test paperclip/profile-sync.test.mjs\` passes
- [ ] \`bash scripts/test-blank-template.sh\` passes
- [ ] \`grep -r 'gbrain' hermes-runtime/ paperclip/\` returns no hits (except test file history)

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  --base main
```

Replace `$N` with the actual issue number.

---

## Self-Review

**Spec coverage:**
1. ✅ Dockerfile stripped — Task 2
2. ✅ Files deleted — Task 3
3. ✅ Entrypoints cleaned — Task 4
4. ✅ profile-sync.mjs — Task 5
5. ✅ seed-agents.mjs — Task 6
6. ✅ bootstrap-profiles.sh — Task 7
7. ✅ compose.yaml + env files — Task 8
8. ✅ Templates rewritten — Task 9
9. ✅ Tests updated — Task 10
10. ✅ Docs cleaned — Task 11

**Placeholder scan:** No TBDs, no "similar to Task N" references.

**Type consistency:** `ensureProfileHomes` return type loses `gbrainHome` — all callers in profile-sync.mjs are updated in Task 5; test callers updated in Task 10.
