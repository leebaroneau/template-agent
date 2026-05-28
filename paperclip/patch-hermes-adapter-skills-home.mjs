#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const LEGACY_HERMES_SKILLS_PATH =
  '/usr/local/lib/node_modules/paperclipai/node_modules/hermes-paperclip-adapter/dist/server/skills.js';

const DEFAULT_RESOLVE_ANCHORS = [
  '/opt/paperclip-src/server/src/index.ts',
  '/opt/paperclip-src/server/dist/index.js',
  '/usr/local/lib/node_modules/paperclipai/dist/index.js',
  '/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/dist/index.js',
];

export function resolveHermesAdapterServerFile(fileName, options = {}) {
  const candidates = options.candidates ?? [
    LEGACY_HERMES_SKILLS_PATH,
    `/opt/paperclip-src/server/node_modules/hermes-paperclip-adapter/dist/server/${fileName}`,
  ];
  const anchors = options.anchors ?? DEFAULT_RESOLVE_ANCHORS;
  const checked = [];

  for (const candidate of candidates) {
    checked.push(candidate);
    if (existsSync(candidate)) return candidate;
  }

  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor);
      const serverIndexPath = require.resolve('hermes-paperclip-adapter/server');
      const candidate = join(dirname(serverIndexPath), fileName);
      checked.push(candidate);
      if (existsSync(candidate)) return candidate;
    } catch {
      checked.push(`${anchor} -> hermes-paperclip-adapter/server`);
    }
  }

  throw new Error(
    `[agent-stack] Could not locate hermes-paperclip-adapter dist/server/${fileName}. Checked: ${checked.join(', ')}`,
  );
}

const MARKER = '// agent-stack hermes-home skills override';
const SYMLINK_MARKER = '// agent-stack hermes-skills symlink walk';

const ORIGINAL =
  'async function buildHermesSkillSnapshot(config) {\n' +
  '    const home = resolveHermesHome(config);\n' +
  '    const hermesSkillsHome = path.join(home, ".hermes", "skills");';

const REPLACEMENT =
  'async function buildHermesSkillSnapshot(config) {\n' +
  '    const home = resolveHermesHome(config);\n' +
  '    ' + MARKER + '\n' +
  '    const __envForHermesSkillsHome = typeof config.env === "object" && config.env !== null && !Array.isArray(config.env) ? config.env : {};\n' +
  '    const __explicitHermesHome = typeof __envForHermesSkillsHome.HERMES_HOME === "string" && __envForHermesSkillsHome.HERMES_HOME.trim().length > 0 ? __envForHermesSkillsHome.HERMES_HOME.trim() : null;\n' +
  '    const hermesSkillsHome = __explicitHermesHome\n' +
  '        ? path.join(path.resolve(__explicitHermesHome), "skills")\n' +
  '        : path.join(home, ".hermes", "skills");';

// The bundled scanHermesSkills uses Dirent.isDirectory(), which returns false
// for symlinks pointing at directories. agent-stack-managed profile homes are
// full of symlinks (Hermes-bundled skills, agent-stack skills)
// so every entry is silently skipped. Replace the two Dirent checks with a
// helper that also accepts symlinks-to-directories via fs.stat (which derefs).
const SYMLINK_ORIGINAL =
  'async function scanHermesSkills(skillsHome) {\n' +
  '    const entries = [];\n' +
  '    try {\n' +
  '        const categories = await fs.readdir(skillsHome, { withFileTypes: true });\n' +
  '        for (const cat of categories) {\n' +
  '            if (!cat.isDirectory())\n' +
  '                continue;\n' +
  '            const catPath = path.join(skillsHome, cat.name);';

const SYMLINK_REPLACEMENT =
  'async function __agentStackIsDirOrSymlinkDir(entry, absolutePath) {\n' +
  '    if (entry.isDirectory()) return true;\n' +
  '    if (!entry.isSymbolicLink()) return false;\n' +
  '    try {\n' +
  '        const stats = await fs.stat(absolutePath);\n' +
  '        return stats.isDirectory();\n' +
  '    } catch {\n' +
  '        return false;\n' +
  '    }\n' +
  '}\n' +
  'async function scanHermesSkills(skillsHome) {\n' +
  '    ' + SYMLINK_MARKER + '\n' +
  '    const entries = [];\n' +
  '    try {\n' +
  '        const categories = await fs.readdir(skillsHome, { withFileTypes: true });\n' +
  '        for (const cat of categories) {\n' +
  '            const catPath = path.join(skillsHome, cat.name);\n' +
  '            if (!(await __agentStackIsDirOrSymlinkDir(cat, catPath)))\n' +
  '                continue;';

const SYMLINK_INNER_ORIGINAL =
  '            const items = await fs.readdir(catPath, { withFileTypes: true }).catch(() => []);\n' +
  '            for (const item of items) {\n' +
  '                if (!item.isDirectory())\n' +
  '                    continue;\n' +
  '                const skillMd = path.join(catPath, item.name, "SKILL.md");';

const SYMLINK_INNER_REPLACEMENT =
  '            const items = await fs.readdir(catPath, { withFileTypes: true }).catch(() => []);\n' +
  '            for (const item of items) {\n' +
  '                const itemPath = path.join(catPath, item.name);\n' +
  '                if (!(await __agentStackIsDirOrSymlinkDir(item, itemPath)))\n' +
  '                    continue;\n' +
  '                const skillMd = path.join(itemPath, "SKILL.md");';

export function patchHermesAdapterSkillsHomeSource(source) {
  let patched = source;
  if (!patched.includes(MARKER)) {
    const next = patched.replace(ORIGINAL, REPLACEMENT);
    if (next !== patched) patched = next;
  }
  if (!patched.includes(SYMLINK_MARKER)) {
    const next = patched.replace(SYMLINK_ORIGINAL, SYMLINK_REPLACEMENT);
    if (next !== patched) patched = next;
  }
  const next = patched.replace(SYMLINK_INNER_ORIGINAL, SYMLINK_INNER_REPLACEMENT);
  if (next !== patched) patched = next;
  return patched;
}

export async function patchHermesAdapterSkillsHomeFile(
  filePath = process.env.HERMES_ADAPTER_SKILLS_PATH || resolveHermesAdapterServerFile('skills.js'),
) {
  const source = await readFile(filePath, 'utf8');
  const patched = patchHermesAdapterSkillsHomeSource(source);
  if (patched === source) {
    console.log('[agent-stack] Hermes adapter skills-home patch already applied');
    return { changed: false, filePath };
  }
  await writeFile(filePath, patched);
  console.log('[agent-stack] Applied Hermes adapter skills-home patch');
  return { changed: true, filePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await patchHermesAdapterSkillsHomeFile();
}
