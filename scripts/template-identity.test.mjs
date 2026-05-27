import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function gitLsFiles() {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
  const files = stdout.trim().split('\n').filter(Boolean);
  const existing = [];

  for (const file of files) {
    try {
      await access(join(repoRoot, file));
      existing.push(file);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return existing;
}

test('template no longer references the legacy project image identity', async () => {
  const forbidden = [
    { pattern: ['AGENT', 'STACK', 'IMAGE'].join('_'), label: 'old registry image override' },
  ];
  const files = (await gitLsFiles()).filter((file) => file !== 'scripts/template-identity.test.mjs');
  const failures = [];

  assert.equal(files.includes('.github/workflows/build-image.yml'), true);

  for (const file of files) {
    const text = await readFile(join(repoRoot, file), 'utf8');
    for (const { pattern, label } of forbidden) {
      if (text.includes(pattern)) {
        failures.push(`${file}: contains ${label} (${pattern})`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test('compose pulls the audited template-agent image by default for Coolify', async () => {
  const compose = await readFile(join(repoRoot, 'compose.yaml'), 'utf8');

  assert.doesNotMatch(compose, /build:/);
  assert.match(compose, /image:\s*\$\{TEMPLATE_AGENT_IMAGE:-ghcr\.io\/leebaroneau\/template-agent:latest\}/);
  assert.match(compose, /pull_policy:\s*always/);
});

test('local build override builds the template-agent image from this repository', async () => {
  const compose = await readFile(join(repoRoot, 'compose.build.yaml'), 'utf8');
  const buildBlocks = compose.match(/build:\s*\n\s+context:\s*\.\s*\n\s+dockerfile:\s*paperclip\/Dockerfile/g) ?? [];

  assert.match(compose, /image:\s*\$\{TEMPLATE_AGENT_IMAGE:-template-agent:local\}/);
  assert.equal(buildBlocks.length, 1);
  assert.match(compose, /pull_policy:\s*build/);
  assert.match(compose, /pull_policy:\s*never/);
});

test('Hermes image installs the Anthropic provider dependency', async () => {
  const dockerfile = await readFile(join(repoRoot, 'paperclip/Dockerfile'), 'utf8');

  assert.match(dockerfile, /uv pip install --python \.\/venv\/bin\/python[^\n]*"anthropic>=0\.39\.0"/);
});

test('Hermes entrypoint marks the wrapper healthcheck ready', async () => {
  const entrypoint = await readFile(join(repoRoot, 'paperclip/hermes-entrypoint.sh'), 'utf8');

  assert.match(entrypoint, /rm -f \/tmp\/hermes-entrypoint-ready/);
  assert.match(entrypoint, /touch \/tmp\/hermes-entrypoint-ready\nexec runuser -u node -- hermes/);
});
