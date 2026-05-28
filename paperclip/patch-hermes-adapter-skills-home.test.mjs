import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  patchHermesAdapterSkillsHomeSource,
  resolveHermesAdapterServerFile,
} from './patch-hermes-adapter-skills-home.mjs';

async function createFakeHermesAdapterPackage() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paperclip-hermes-adapter-'));
  const packageRoot = path.join(root, 'server', 'node_modules', 'hermes-paperclip-adapter');
  const serverDir = path.join(packageRoot, 'dist', 'server');
  await mkdir(serverDir, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'hermes-paperclip-adapter',
      type: 'module',
      exports: {
        './server': './dist/server/index.js',
      },
    }),
  );
  await writeFile(path.join(serverDir, 'index.js'), 'export {};\n');
  await writeFile(path.join(serverDir, 'skills.js'), 'export {};\n');
  return {
    anchor: path.join(root, 'server', 'src', 'index.ts'),
    skillsPath: await realpath(path.join(serverDir, 'skills.js')),
  };
}

const PRISTINE_SOURCE = `
async function buildHermesSkillSnapshot(config) {
    const home = resolveHermesHome(config);
    const hermesSkillsHome = path.join(home, ".hermes", "skills");
    // 1. Scan Paperclip-managed skills (bundled with the adapter)
    const paperclipEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
`;

test('patchHermesAdapterSkillsHomeSource prefers HERMES_HOME when set', () => {
  const patched = patchHermesAdapterSkillsHomeSource(PRISTINE_SOURCE);
  assert.notEqual(patched, PRISTINE_SOURCE);
  assert.match(patched, /agent-stack hermes-home skills override/);
  assert.match(patched, /__explicitHermesHome\s*\?\s*path\.join\(path\.resolve\(__explicitHermesHome\),\s*"skills"\)/);
  assert.match(patched, /:\s*path\.join\(home,\s*"\.hermes",\s*"skills"\)/);
});

test('patchHermesAdapterSkillsHomeSource leaves rest of file intact', () => {
  const patched = patchHermesAdapterSkillsHomeSource(PRISTINE_SOURCE);
  assert.match(patched, /await readPaperclipRuntimeSkillEntries\(config, __moduleDir\)/);
});

test('patchHermesAdapterSkillsHomeSource is idempotent', () => {
  const once = patchHermesAdapterSkillsHomeSource(PRISTINE_SOURCE);
  const twice = patchHermesAdapterSkillsHomeSource(once);
  assert.equal(once, twice);
});

test('patchHermesAdapterSkillsHomeSource returns source unchanged if anchor missing', () => {
  const unrelated = 'function unrelated() { return 1; }\n';
  assert.equal(patchHermesAdapterSkillsHomeSource(unrelated), unrelated);
});

test('patchHermesAdapterSkillsHomeSource rewrites scanHermesSkills to walk symlinks', () => {
  const scanSource = `
async function scanHermesSkills(skillsHome) {
    const entries = [];
    try {
        const categories = await fs.readdir(skillsHome, { withFileTypes: true });
        for (const cat of categories) {
            if (!cat.isDirectory())
                continue;
            const catPath = path.join(skillsHome, cat.name);
            const topLevelSkillMd = path.join(catPath, "SKILL.md");
            if (await fs.stat(topLevelSkillMd).catch(() => null)) {
                entries.push(await buildSkillEntry(cat.name, topLevelSkillMd, cat.name));
            }
            const items = await fs.readdir(catPath, { withFileTypes: true }).catch(() => []);
            for (const item of items) {
                if (!item.isDirectory())
                    continue;
                const skillMd = path.join(catPath, item.name, "SKILL.md");
                if (await fs.stat(skillMd).catch(() => null)) {
                    const key = item.name;
                    entries.push(await buildSkillEntry(key, skillMd, \`\${cat.name}/\${item.name}\`));
                }
            }
        }
    }
    catch {
    }
    return entries.sort((a, b) => a.key.localeCompare(b.key));
}
`;
  const patched = patchHermesAdapterSkillsHomeSource(scanSource);
  assert.notEqual(patched, scanSource);
  assert.match(patched, /agent-stack hermes-skills symlink walk/);
  assert.match(patched, /__agentStackIsDirOrSymlinkDir/);
  assert.match(patched, /entry\.isSymbolicLink\(\)/);
  assert.match(patched, /const itemPath = path\.join\(catPath, item\.name\);/);
  // The hard "!cat.isDirectory()" / "!item.isDirectory()" early-skips must be gone.
  assert.doesNotMatch(patched, /if \(!cat\.isDirectory\(\)\)\n\s+continue;/);
  assert.doesNotMatch(patched, /if \(!item\.isDirectory\(\)\)\n\s+continue;/);
});

test('patched scanHermesSkills helper treats symlink-to-dir as a directory', () => {
  const scanSource = `
async function scanHermesSkills(skillsHome) {
    const entries = [];
    try {
        const categories = await fs.readdir(skillsHome, { withFileTypes: true });
        for (const cat of categories) {
            if (!cat.isDirectory())
                continue;
            const catPath = path.join(skillsHome, cat.name);
            const topLevelSkillMd = path.join(catPath, "SKILL.md");
            if (await fs.stat(topLevelSkillMd).catch(() => null)) {
                entries.push(await buildSkillEntry(cat.name, topLevelSkillMd, cat.name));
            }
            const items = await fs.readdir(catPath, { withFileTypes: true }).catch(() => []);
            for (const item of items) {
                if (!item.isDirectory())
                    continue;
                const skillMd = path.join(catPath, item.name, "SKILL.md");
                if (await fs.stat(skillMd).catch(() => null)) {
                    const key = item.name;
                    entries.push(await buildSkillEntry(key, skillMd, "x"));
                }
            }
        }
    }
    catch {
    }
    return entries;
}
`;
  const patched = patchHermesAdapterSkillsHomeSource(scanSource);
  const helperMatch = patched.match(/async function __agentStackIsDirOrSymlinkDir\(entry, absolutePath\)[^]*?^\}/m);
  assert.ok(helperMatch, 'helper function should be present');
  const fakeFs = { stat: async () => ({ isDirectory: () => true }) };
  const factory = new Function('fs', `${helperMatch[0]}\nreturn __agentStackIsDirOrSymlinkDir;`);
  const helper = factory(fakeFs);
  return Promise.all([
    helper({ isDirectory: () => true, isSymbolicLink: () => false }, '/x').then((v) => assert.equal(v, true)),
    helper({ isDirectory: () => false, isSymbolicLink: () => true }, '/y').then((v) => assert.equal(v, true)),
    helper({ isDirectory: () => false, isSymbolicLink: () => false }, '/z').then((v) => assert.equal(v, false)),
  ]);
});

test('resulting code resolves env.HERMES_HOME to <HERMES_HOME>/skills', () => {
  const patched = patchHermesAdapterSkillsHomeSource(PRISTINE_SOURCE);
  const body = patched.slice(
    patched.indexOf('async function buildHermesSkillSnapshot'),
    patched.indexOf('const paperclipEntries'),
  );
  const harness = `
    const path = { join: (...parts) => parts.join('/'), resolve: (p) => p };
    function resolveHermesHome(_config) { return '/home/node'; }
    function probe(config) {
${body.replace('async function buildHermesSkillSnapshot(config) {', '').replace(/^/gm, '      ')}
      return hermesSkillsHome;
    }
    return probe;
  `;
  const probe = new Function(harness)();
  assert.equal(
    probe({ env: { HERMES_HOME: '/data/hermes/profiles/genvest-head-of-sales' } }),
    '/data/hermes/profiles/genvest-head-of-sales/skills',
  );
  assert.equal(probe({ env: {} }), '/home/node/.hermes/skills');
  assert.equal(probe({ env: { HERMES_HOME: '   ' } }), '/home/node/.hermes/skills');
  assert.equal(probe({}), '/home/node/.hermes/skills');
});

test('resolveHermesAdapterServerFile resolves source workspace adapter installs', async () => {
  const fake = await createFakeHermesAdapterPackage();
  assert.equal(
    resolveHermesAdapterServerFile('skills.js', { anchors: [fake.anchor], candidates: [] }),
    fake.skillsPath,
  );
});
