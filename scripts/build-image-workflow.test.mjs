import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('image builds run on push to main and manual dispatch (no PR builds)', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');

  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
});

test('workflow publishes the template-agent image identity (no legacy gbrain name)', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');
  const compose = await readFile('compose.yaml', 'utf8');

  assert.match(workflow, /REMOTE_IMAGE: ghcr\.io\/leebaroneau\/template-agent/);
  assert.doesNotMatch(workflow, /leebaroneau\/paperclip-hermes-gbrain/);
  // compose pins the published image via TEMPLATE_AGENT_IMAGE (default :latest).
  assert.match(compose, /image:\s*\$\{TEMPLATE_AGENT_IMAGE:-ghcr\.io\/leebaroneau\/template-agent:latest\}/);
  assert.doesNotMatch(compose, /ghcr\.io\/leebaroneau\/paperclip-hermes-gbrain/);
});

test('compose.yaml is pull-only; the build override lives in compose.build.yaml', async () => {
  const compose = await readFile('compose.yaml', 'utf8');
  const composeBuild = await readFile('compose.build.yaml', 'utf8');

  // Production compose.yaml pulls the pinned image (durable pull-race fix) and
  // carries NO build instructions — those live in the local-build overlay.
  assert.doesNotMatch(compose, /build:/);
  assert.match(compose, /pull_policy:\s*always/);
  assert.match(composeBuild, /build:[\s\S]*context: \.[\s\S]*dockerfile: paperclip\/Dockerfile/);
  assert.match(composeBuild, /pull_policy:\s*build/);
});

test('compose leaves proxy routing labels to Coolify', async () => {
  const compose = await readFile('compose.yaml', 'utf8');

  assert.doesNotMatch(compose, /traefik\./);
  assert.doesNotMatch(compose, /caddy_/);
});

test('build pushes sha + latest tags and audits the image', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');

  // buildx --push streams directly to registry; audit pulls after push
  assert.match(workflow, /docker\/build-push-action/);
  assert.match(workflow, /push:\s*true/);
  // SHA resolved via steps.sha.outputs.sha to handle workflow_run event correctly
  assert.match(workflow, /sha-\$\{\{[\s]*steps\.sha\.outputs\.sha[\s]*\}\}/);
  assert.match(workflow, /audit-blank-image\.sh/);
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

test('logs in to GHCR via docker/login-action', async () => {
  const workflow = await readFile('.github/workflows/build-image.yml', 'utf8');

  assert.match(workflow, /name: Log in to GitHub Container Registry/);
  assert.match(workflow, /docker\/login-action@v3/);
  assert.match(workflow, /registry: ghcr\.io/);
});
