#!/usr/bin/env node

import { copyFile, readFile, writeFile } from 'node:fs/promises';

const VALID_CONFIG_SOURCES = new Set(['onboard', 'configure', 'doctor']);

export async function repairPaperclipConfigFile({
  configPath = process.env.PAPERCLIP_CONFIG_PATH
    || `${process.env.PAPERCLIP_HOME || '/data'}/instances/default/config.json`,
  backupPath = `${configPath}.pre-agent-stack-config-repair`,
  now = () => new Date(),
} = {}) {
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { changed: false, reason: 'missing', configPath };
    }
    throw error;
  }

  const config = JSON.parse(raw);
  const meta = config.$meta && typeof config.$meta === 'object' ? config.$meta : {};
  const source = typeof meta.source === 'string' ? meta.source : '';

  if (VALID_CONFIG_SOURCES.has(source)) {
    return { changed: false, reason: 'valid', configPath };
  }

  await copyFile(configPath, backupPath);

  config.$meta = {
    ...meta,
    version: typeof meta.version === 'number' ? meta.version : 1,
    source: 'configure',
    updatedAt: now().toISOString(),
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    changed: true,
    configPath,
    backupPath,
    fromSource: source || null,
    toSource: 'configure',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await repairPaperclipConfigFile();
  if (result.changed) {
    console.log(
      `[agent-stack] Repaired Paperclip config metadata source ${JSON.stringify(result.fromSource)} -> "configure"`,
    );
    console.log(`[agent-stack] Backed up original config to ${result.backupPath}`);
  }
}
