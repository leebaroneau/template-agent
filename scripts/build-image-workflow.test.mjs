import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('pull request image builds are manual and default to arm64 previews', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');

  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: \$\{\{ github\.ref == 'refs\/heads\/main' && 'ubuntu-latest' \|\| 'ubuntu-24\.04-arm' \}\}/);
  assert.match(workflow, /platforms:[\s\S]*default: linux\/arm64/);
  assert.match(workflow, /platforms="\$\{\{ inputs\.platforms \|\| 'linux\/arm64' \}\}"/);
  assert.match(workflow, /github\.ref.*refs\/heads\/main[\s\S]*platforms="linux\/amd64,linux\/arm64"/);
  assert.match(workflow, /docker\/setup-qemu-action@v4[\s\S]*platforms: all/);
});

test('workflow publishes the template-agent image package without hard-coded compose pulls', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');
  const compose = await readFile('compose.yaml', 'utf8');

  assert.match(workflow, /IMAGE_NAME: leebaroneau\/template-agent/);
  assert.doesNotMatch(workflow, /leebaroneau\/paperclip-hermes-gbrain/);
  assert.doesNotMatch(compose, /ghcr\.io\/leebaroneau\/template-agent:latest/);
  assert.doesNotMatch(compose, /ghcr\.io\/leebaroneau\/paperclip-hermes-gbrain:latest/);
});

test('compose builds the agent stack from the repository while GHCR deploys are paused', async () => {
  const compose = await readFile('compose.yaml', 'utf8');

  assert.match(compose, /x-agent-stack-build:/);
  assert.doesNotMatch(compose, /image:\s*template-agent:\$\{SOURCE_COMMIT:-local\}/);
  assert.match(compose, /build:[\s\S]*context: \.[\s\S]*dockerfile: paperclip\/Dockerfile/);
  assert.match(compose, /pull_policy:\s*build/);
  assert.doesNotMatch(compose, /pull_policy:\s*always/);
});

test('compose leaves proxy routing labels to Coolify', async () => {
  const compose = await readFile('compose.yaml', 'utf8');

  assert.doesNotMatch(compose, /traefik\./);
  assert.doesNotMatch(compose, /caddy_/);
});

test('multi-arch image publish has enough timeout and non-blocking cache export', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');

  assert.match(workflow, /timeout-minutes: 90/);
  assert.match(workflow, /cache-to: type=gha,mode=min,ignore-error=true/);
  assert.doesNotMatch(workflow, /cache-to: type=gha,mode=max\s*$/m);
});

test('production deploy webhooks only run from main branch image builds', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');

  const deployConditions = [...workflow.matchAll(/if: (success\(\)[^\n]+COOLIFY_[^\n]+_APP_UUID[^\n]+)/g)];
  assert.equal(deployConditions.length, 3);

  for (const [, condition] of deployConditions) {
    assert.match(condition, /github\.ref == 'refs\/heads\/main'/);
    assert.doesNotMatch(condition, /github\.event_name != 'pull_request'/);
  }
});

test('GHCR login retries transient registry timeouts', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');

  assert.match(workflow, /name: Log in to GHCR/);
  assert.match(workflow, /for attempt in 1 2 3;/);
  assert.match(workflow, /docker login "\$REGISTRY" -u "\$GHCR_USERNAME" --password-stdin/);
  assert.doesNotMatch(workflow, /docker\/login-action@v4/);
});
