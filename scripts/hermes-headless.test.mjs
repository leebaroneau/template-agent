import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function file(path) {
  return readFile(join(repoRoot, path), 'utf8');
}

test('compose keeps Hermes headless and unrouted by default', async () => {
  const compose = await file('compose.yaml');

  assert.match(compose, /HERMES_DASHBOARD_ENABLED:\s*\$\{HERMES_DASHBOARD_ENABLED:-1\}/);
  assert.doesNotMatch(compose, /hermes-auth/);
  assert.doesNotMatch(compose, /traefik\.http\.routers\.hermes/);
  assert.match(compose, /healthcheck:\s*\n\s+test:\s*\["CMD", "test", "-f", "\/tmp\/hermes-entrypoint-ready"\]/);
});

test('Hermes entrypoint can stay alive for gateways without starting the dashboard', async () => {
  const entrypoint = await file('paperclip/hermes-entrypoint.sh');

  assert.match(entrypoint, /HERMES_DASHBOARD_ENABLED:-0/);
  assert.match(entrypoint, /touch \/tmp\/hermes-entrypoint-ready/);
  assert.match(entrypoint, /exec sleep infinity/);
  assert.match(entrypoint, /args=\(dashboard --host "\$host" --port "\$port" --no-open\)/);
});

test('Hermes entrypoint keeps dashboard auth enabled on remote bind by default', async () => {
  const entrypoint = await file('paperclip/hermes-entrypoint.sh');
  const compose = await file('compose.yaml');

  assert.match(compose, /HERMES_DASHBOARD_INSECURE:\s*\$\{HERMES_DASHBOARD_INSECURE:-0\}/);
  assert.match(entrypoint, /HERMES_DASHBOARD_INSECURE:-0/);
  assert.doesNotMatch(
    entrypoint,
    /if \[\[ "\$host" != "127\.0\.0\.1" && "\$host" != "localhost" \]\]; then\s+args\+=\(--insecure\)\s+fi/
  );
});

test('example env files make Hermes dashboard opt-in', async () => {
  for (const path of ['.env.example', '.env.coolify.example']) {
    const env = await file(path);
    assert.match(env, /^HERMES_DASHBOARD_ENABLED=1$/m, `${path} should enable the dashboard by default`);
  }
});

test('Coolify env helper emits a headless Hermes default', async () => {
  const helper = await file('scripts/coolify-env.sh');

  assert.match(helper, /^HERMES_DASHBOARD_ENABLED=1$/m);
  assert.doesNotMatch(helper, /^HERMES_HOSTNAME=/m);
});
