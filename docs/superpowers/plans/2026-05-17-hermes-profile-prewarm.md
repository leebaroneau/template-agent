# Hermes Profile Directory Pre-Warm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the `adapter_failed` / `PermissionError: [Errno 13] Permission denied: '/data/hermes/profiles/<slug>/logs/curator'` startup race for freshly-provisioned Hermes profiles by pre-creating Hermes' canonical well-known subdirectory tree inside `ensureProfileHomes` with stable, idempotent permissions.

**Architecture:** Mirror upstream Hermes' `ensure_hermes_home()` exactly (from `hermes_cli/config.py`). After profile-sync creates `hermesHome`, it now also pre-creates and `chmod 0700`s each well-known subdir (`cron`, `sessions`, `logs`, `logs/curator`, `memories`, `pairing`, `hooks`, `image_cache`, `audio_cache`, `skills`) and `chmod 0700`s the profile root itself. This runs on every `profile-sync` iteration, so it's also self-healing: if any subdir is missing or has the wrong mode, the next 60-second sweep restores it. The list lives as a single exported constant so we can update in lock-step with upstream releases.

**Tech Stack:** Node.js (>=20), `node:fs/promises` (`mkdir`, `chmod`, `stat`), `node:test`, `node:assert/strict`.

**Concrete root-cause evidence (from droplet `paperclip-otm4l…`, run `5ab4b0c1-…`, 2026-05-17 10:47:23 UTC):**

```
[hermes] Starting Hermes Agent (model=gpt-5.5, provider=openai-codex …)
PermissionError: [Errno 13] Permission denied: '/data/hermes/profiles/genvest-ceo/logs/curator'
  File ".../hermes_cli/config.py", line 440, in ensure_hermes_home
    d.mkdir(parents=True, exist_ok=True)
[hermes] Exit code: 1
```

Hermes upstream (`hermes_cli/config.py` ~ line 440) creates these subdirs lazily on first `hermes chat`. When profile-sync had only finished partial scaffolding, the lazy `mkdir(parents=True, exist_ok=True)` + `is_dir()` checks raced and returned EACCES on the second-pass stat. Pre-creating them with stable perms removes the race window entirely.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `paperclip/profile-sync.mjs` | Modify | Export `HERMES_WELL_KNOWN_SUBDIRS` constant; add `ensureHermesSubdirs(hermesHome)` helper; call it from `ensureProfileHomes` after `mkdir(hermesHome,…)`. |
| `paperclip/profile-sync.test.mjs` | Modify | Add `ensureProfileHomes pre-creates Hermes well-known subdirs with 0700 perms` test using existing `mkdtemp` pattern. |

No new files. Two files modified. Full diff fits in a single PR.

## Out of Scope (separate follow-up)

- Auto-retry of `adapter_failed` in the first N minutes after agent creation (lives in upstream Paperclip core, not in this template repo). Leave a note in the PR description so future-us picks it up.
- chown-ing dirs (paperclip and hermes containers both run as uid 1000 / user `node`; profile-sync inherits that uid, so created dirs are already owned correctly — no chown needed).

---

## Task 1: Add canonical Hermes well-known subdirs constant + helper

**Files:**
- Modify: `paperclip/profile-sync.mjs:80` (immediately after the `GBRAIN_TEMPLATE_PATHS` block, before `desiredProfileSlug`)

- [ ] **Step 1: Write the failing test for `HERMES_WELL_KNOWN_SUBDIRS` shape**

Add this test to `paperclip/profile-sync.test.mjs`, after the existing `ensureProfileHomes` block (~ line 235):

```javascript
test('ensureProfileHomes pre-creates Hermes well-known subdirs with 0700 perms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-prewarm-'));
  try {
    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: join(root, 'hermes'),
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    // Canonical Hermes well-known subdirs from upstream hermes_cli/config.py:ensure_hermes_home
    const expected = [
      'cron',
      'sessions',
      'logs',
      'logs/curator',
      'memories',
      'pairing',
      'hooks',
      'image_cache',
      'audio_cache',
      'skills',
    ];

    for (const rel of expected) {
      const info = await stat(join(result.hermesHome, rel));
      assert.ok(info.isDirectory(), `${rel} should be a directory`);
      // mode & 0o777 isolates the user/group/other bits from the file-type bits
      assert.equal(info.mode & 0o777, 0o700, `${rel} should be mode 0700, got ${(info.mode & 0o777).toString(8)}`);
    }

    // Profile root itself should also be 0700 (matches upstream _secure_dir)
    const homeInfo = await stat(result.hermesHome);
    assert.equal(homeInfo.mode & 0o777, 0o700, 'hermesHome should be mode 0700');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd /Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-agent
npm test -- --grep 'pre-creates Hermes well-known subdirs'
```

Expected: FAIL — first `stat(join(result.hermesHome, 'cron'))` rejects with `ENOENT` because the dir isn't pre-created.

- [ ] **Step 3: Add the constant + helper to `paperclip/profile-sync.mjs`**

Find the existing `GBRAIN_TEMPLATE_PATHS` block (currently ending at line 80, just before `export function desiredProfileSlug`). Insert the following directly after the closing `];` of `GBRAIN_TEMPLATE_PATHS`:

```javascript
// Canonical list of Hermes well-known subdirs, mirroring upstream
// hermes_cli/config.py:ensure_hermes_home(). Pre-creating these with stable
// perms inside profile-sync eliminates the EACCES startup race where Paperclip
// can dispatch an agent run before Hermes' own lazy mkdir window settles.
//
// Keep this list in lock-step with upstream. If a Hermes release adds a new
// well-known subdir, append it here.
export const HERMES_WELL_KNOWN_SUBDIRS = Object.freeze([
  'cron',
  'sessions',
  'logs',
  'logs/curator',
  'memories',
  'pairing',
  'hooks',
  'image_cache',
  'audio_cache',
  'skills',
]);
```

Then, near the other small helpers at the bottom of the file (after `moveIfExists` ~ line 956), add:

```javascript
async function ensureHermesSubdirs(hermesHome) {
  // Idempotent: every profile-sync iteration re-asserts the dir tree + perms,
  // so a half-created profile or a stray chmod gets healed on the next pass.
  await chmod(hermesHome, 0o700);
  for (const relative of HERMES_WELL_KNOWN_SUBDIRS) {
    const target = join(hermesHome, relative);
    await mkdir(target, { recursive: true });
    await chmod(target, 0o700);
  }
}
```

- [ ] **Step 4: Run the test again and verify it still fails for the right reason**

```bash
npm test -- --grep 'pre-creates Hermes well-known subdirs'
```

Expected: still FAIL — the helper exists but isn't wired into `ensureProfileHomes` yet. The first `stat` for `cron` still rejects with `ENOENT`. This proves Step 3 alone is inert (no behavior change).

- [ ] **Step 5: Commit the failing helper**

```bash
git add paperclip/profile-sync.mjs paperclip/profile-sync.test.mjs
git commit -m "Add ensureHermesSubdirs helper + failing pre-warm test"
```

---

## Task 2: Wire `ensureHermesSubdirs` into `ensureProfileHomes`

**Files:**
- Modify: `paperclip/profile-sync.mjs:274` (inside `ensureProfileHomes`, right after the existing `await mkdir(hermesHome, { recursive: true });`)

- [ ] **Step 1: Add the call site**

In `paperclip/profile-sync.mjs`, locate `ensureProfileHomes`. The current body starts with:

```javascript
  await mkdir(hermesHome, { recursive: true });
  await mkdir(gbrainHome, { recursive: true });
```

Change it to:

```javascript
  await mkdir(hermesHome, { recursive: true });
  await mkdir(gbrainHome, { recursive: true });
  await ensureHermesSubdirs(hermesHome);
```

Order matters: `ensureHermesSubdirs` runs **after** `mkdir(hermesHome)` (parent must exist) and **before** the default-profile clone (so the cloning step never has to create these subdirs itself).

- [ ] **Step 2: Run the test and verify it passes**

```bash
npm test -- --grep 'pre-creates Hermes well-known subdirs'
```

Expected: PASS — all 10 subdirs exist with mode 0700, and the profile root is mode 0700.

- [ ] **Step 3: Run the full test suite to verify no regression**

```bash
npm test
```

Expected: All existing tests pass. In particular: the existing `ensureProfileHomes creates profile config, soul, and gbrain directory` test still passes (config.yaml, SOUL.md, DELEGATION_PROTOCOL.md, LEARNING_PROTOCOL.md are unchanged); the `clones default Hermes profile files` test still passes (skipped dirs are unaffected because they were already excluded from `cloneDefaultHermesProfile`).

- [ ] **Step 4: Commit**

```bash
git add paperclip/profile-sync.mjs
git commit -m "Pre-warm Hermes well-known subdirs in ensureProfileHomes"
```

---

## Task 3: Add idempotency / self-healing regression test

This test proves the second guarantee in the architecture statement: calling `ensureProfileHomes` again on a profile where someone has broken the perms restores them. This is what saves us from a future race where some external process chmods curator back to 0600 or similar.

**Files:**
- Modify: `paperclip/profile-sync.test.mjs` (add directly after the prewarm test from Task 1)

- [ ] **Step 1: Write the failing test**

```javascript
test('ensureProfileHomes restores broken perms on Hermes well-known subdirs (self-heal)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-prewarm-heal-'));
  try {
    const callOnce = () =>
      ensureProfileHomes({
        profileSlug: 'acme-researcher',
        hermesDataRoot: join(root, 'hermes'),
        gbrainDataRoot: join(root, 'gbrain'),
        templateDir: join(process.cwd(), 'hermes-runtime/templates'),
        initGbrain: false,
      });

    const first = await callOnce();
    // Simulate an external process breaking curator's perms.
    const curatorPath = join(first.hermesHome, 'logs', 'curator');
    await chmod(curatorPath, 0o000);

    // Next profile-sync iteration should restore 0700.
    await callOnce();
    const restored = await stat(curatorPath);
    assert.equal(restored.mode & 0o777, 0o700, 'curator perms should be restored to 0700 on next sync');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

Also add `chmod` to the existing import list at the top of the test file. Find:

```javascript
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
```

Change to:

```javascript
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
```

- [ ] **Step 2: Run the test and verify it passes**

```bash
npm test -- --grep 'restores broken perms'
```

Expected: PASS — `ensureHermesSubdirs` already runs on every call, so the second call re-`chmod`s curator back to 0700. This test locks in that behavior so a future refactor can't accidentally make the function "only run on first creation."

- [ ] **Step 3: Run the full suite once more**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add paperclip/profile-sync.test.mjs
git commit -m "Lock in profile-sync self-healing of Hermes subdir perms"
```

---

## Task 4: Verify against the real droplet container (sanity check)

This is a one-off manual verification — not a committed test — to confirm the fix actually prevents the EACCES symptom in production after the next deploy.

- [ ] **Step 1: Confirm current droplet behavior**

Pre-fix: the `genvest-ceo` profile on the droplet (`/data/hermes/profiles/genvest-ceo/`) currently has `drwx------` on `logs/` and `logs/curator/` only because the TUI gateway created them lazily. Other well-known subdirs may not exist yet. List:

```bash
ssh genvest-droplet "docker exec hermes-otm4lzviqdp29yuhkafcghsb-122710762906 ls /data/hermes/profiles/genvest-ceo/ | sort"
```

Note which of the 10 well-known subdirs are MISSING. Expected: likely `pairing`, `hooks`, `image_cache`, `memories` are missing.

- [ ] **Step 2: Deploy this branch**

After the PR is merged and Coolify auto-deploys, profile-sync will run once on container startup and again every 60s. The first iteration after deploy should pre-create the missing subdirs.

- [ ] **Step 3: Re-list and confirm**

```bash
ssh genvest-droplet "docker exec hermes-otm4lzviqdp29yuhkafcghsb-… ls /data/hermes/profiles/genvest-ceo/ | sort"
ssh genvest-droplet "docker exec hermes-otm4lzviqdp29yuhkafcghsb-… stat -c '%a %n' /data/hermes/profiles/genvest-ceo/{cron,sessions,logs,logs/curator,memories,pairing,hooks,image_cache,audio_cache,skills}"
```

Expected: all 10 dirs exist, all mode 700.

- [ ] **Step 4: Optionally re-run a freshly-created agent**

Create a new agent for the Genvest company in Paperclip (UI), wait for one profile-sync cycle (~60s), assign a small test issue, watch the run log. Should start cleanly without the EACCES.

---

## Self-Review

1. **Spec coverage:** Single goal (eliminate startup race via pre-warm). Task 1 introduces helper + failing test, Task 2 wires it in, Task 3 locks in self-healing, Task 4 confirms in production. Covered.
2. **Placeholder scan:** No "TBD", "TODO", "handle edge cases" — every code block is complete.
3. **Type consistency:** `HERMES_WELL_KNOWN_SUBDIRS` named consistently in constant declaration, helper body, and test expectations. `ensureHermesSubdirs(hermesHome)` signature consistent across declaration and call site. Import additions (`chmod`) listed explicitly.
