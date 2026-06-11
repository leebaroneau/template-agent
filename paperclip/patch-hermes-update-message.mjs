#!/usr/bin/env node
/**
 * Patches _DOCKER_UPDATE_MESSAGE in hermes_cli/config.py to show
 * template-agent / Coolify deployment guidance instead of the upstream
 * nousresearch/hermes-agent docker pull instructions.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_PY = '/usr/local/lib/hermes-agent/hermes_cli/config.py';
const PYCACHE = '/usr/local/lib/hermes-agent/hermes_cli/__pycache__';

const CUSTOM_MESSAGE = `\
✗ \`\`hermes update\`\` is managed by Coolify in this deployment.

This container runs as ghcr.io/leebaroneau/template-agent — updates are
deployed automatically via GitHub Actions when changes land on main.

To update to the latest Hermes Agent version:
  1. Bump the hermes-agent version in the template-agent Dockerfile
  2. Push / merge to main → https://github.com/leebaroneau/template-agent
  3. CI builds + pushes a new image → Coolify redeploys automatically

To trigger a redeploy with the current image (no version bump needed):
  Coolify → select the hermes service → click "Redeploy"

Your config and session history live under $HERMES_HOME (/data/hermes)
and persist across redeploys — no data is lost on container restart.`;

if (!existsSync(CONFIG_PY)) {
  console.error(`patch-hermes-update-message: ${CONFIG_PY} not found — skipping`);
  process.exit(0);
}

const original = await readFile(CONFIG_PY, 'utf8');

// Match the _DOCKER_UPDATE_MESSAGE = """...""" block (triple-quoted string).
const pattern = /(_DOCKER_UPDATE_MESSAGE\s*=\s*""")[\s\S]*?(""")/;
if (!pattern.test(original)) {
  console.error('patch-hermes-update-message: _DOCKER_UPDATE_MESSAGE not found — skipping');
  process.exit(0);
}

const patched = original.replace(pattern, `$1${CUSTOM_MESSAGE}$2`);
await writeFile(CONFIG_PY, patched, 'utf8');

// Remove compiled bytecode so Python picks up the patched source.
if (existsSync(PYCACHE)) {
  for (const entry of (await import('node:fs')).default.readdirSync(PYCACHE)) {
    if (entry.startsWith('config.') && entry.endsWith('.pyc')) {
      rmSync(join(PYCACHE, entry));
    }
  }
}

console.log('patch-hermes-update-message: patched _DOCKER_UPDATE_MESSAGE in config.py');
