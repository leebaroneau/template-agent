#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_AGENTS_ROUTE_PATH =
  '/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/dist/routes/agents.js';

export function parseHermesModelConfig(source) {
  const lines = String(source || '').split('\n');
  let inModelSection = false;
  let sectionIndent = 0;
  const config = { model: '', provider: '' };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;

    if (/^model:\s*$/.test(trimmed) && indent === 0) {
      inModelSection = true;
      sectionIndent = indent;
      continue;
    }

    if (inModelSection && indent <= sectionIndent && trimmed && !trimmed.startsWith('#')) {
      inModelSection = false;
    }

    if (!inModelSection) continue;

    const match = trimmed.match(/^\s*(\w+)\s*:\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2].trim().replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
    if (key === 'default') config.model = value;
    if (key === 'provider') config.provider = value;
  }

  return config;
}

export async function readHermesModelConfig({
  configPath = process.env.HERMES_CONFIG_PATH || `${process.env.HERMES_HOME || '/data/hermes'}/config.yaml`,
} = {}) {
  try {
    return parseHermesModelConfig(await readFile(configPath, 'utf8'));
  } catch {
    return { model: '', provider: '' };
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function formatShellExports({ config, env = process.env }) {
  const model = env.HERMES_MODEL || config.model || '';
  const provider = env.HERMES_PROVIDER || config.provider || '';
  const lines = [];

  if (model) lines.push(`export HERMES_MODEL=${shellQuote(model)}`);
  if (provider) lines.push(`export HERMES_PROVIDER=${shellQuote(provider)}`);

  return lines.join('\n');
}

export function patchAgentsRouteSource(source) {
  if (source.includes('Object.prototype.hasOwnProperty.call(next, "model")')) {
    return source;
  }

  const insert = `        // agent-stack Hermes defaults
        if (adapterType === "hermes_local") {
            const hasModel = Object.prototype.hasOwnProperty.call(next, "model");
            const hasProvider = Object.prototype.hasOwnProperty.call(next, "provider");
            if (!hasModel && asNonEmptyString(process.env.HERMES_MODEL)) {
                next.model = process.env.HERMES_MODEL;
            }
            if (!hasProvider && asNonEmptyString(process.env.HERMES_PROVIDER)) {
                next.provider = process.env.HERMES_PROVIDER;
            }
            return ensureGatewayDeviceKey(adapterType, next);
        }
`;
  const oldInsert = `        // agent-stack Hermes defaults
        if (adapterType === "hermes_local") {
            if (!asNonEmptyString(next.model) && asNonEmptyString(process.env.HERMES_MODEL)) {
                next.model = process.env.HERMES_MODEL;
            }
            if (!asNonEmptyString(next.provider) && asNonEmptyString(process.env.HERMES_PROVIDER)) {
                next.provider = process.env.HERMES_PROVIDER;
            }
            return ensureGatewayDeviceKey(adapterType, next);
        }
`;

  if (source.includes(oldInsert)) {
    return source.replace(oldInsert, insert);
  }

  const needle = '        if (adapterType === "codex_local") {';
  const patched = source.replace(needle, `${insert}${needle}`);
  if (patched === source) {
    throw new Error('Unable to patch Paperclip Hermes creation defaults');
  }

  return patched;
}

export async function patchAgentsRouteFile(
  filePath = process.env.PAPERCLIP_AGENTS_ROUTE_PATH || DEFAULT_AGENTS_ROUTE_PATH,
) {
  const source = await readFile(filePath, 'utf8');
  const patched = patchAgentsRouteSource(source);
  if (patched === source) {
    console.log('[agent-stack] Paperclip Hermes defaults patch already applied');
    return { changed: false, filePath };
  }

  await writeFile(filePath, patched);
  console.log('[agent-stack] Applied Paperclip Hermes defaults patch');
  return { changed: true, filePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] || 'patch';
  if (command === 'env') {
    const config = await readHermesModelConfig();
    console.log(formatShellExports({ config }));
  } else if (command === 'patch') {
    await patchAgentsRouteFile();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}
