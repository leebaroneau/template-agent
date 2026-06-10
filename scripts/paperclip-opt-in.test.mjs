import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function file(path) {
  return readFile(join(repoRoot, path), 'utf8');
}

function serviceBlock(compose, name) {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|(?![\\s\\S]))`, 'm'));
  assert.ok(match, `missing compose service ${name}`);
  return match[1];
}

test('Paperclip service is opt-in and does not block Hermes startup by default', async () => {
  const compose = await file('compose.yaml');
  const paperclip = serviceBlock(compose, 'paperclip');
  const hermes = serviceBlock(compose, 'hermes');

  assert.match(paperclip, /scale:\s*\$\{PAPERCLIP_ENABLED:-0\}/);
  assert.match(paperclip, /PAPERCLIP_ENABLED:\s*\$\{PAPERCLIP_ENABLED:-0\}/);
  assert.doesNotMatch(hermes, /depends_on:\s*\n\s+- paperclip/);
});

test('example env defaults keep Paperclip disabled with no separate profile-sync switch', async () => {
  for (const path of ['.env.example', '.env.coolify.example']) {
    const env = await file(path);
    assert.match(env, /^PAPERCLIP_ENABLED=0$/m, `${path} should leave Paperclip off`);
    assert.doesNotMatch(env, /^PROFILE_SYNC_ENABLED=/m, `${path} should not require a separate profile-sync switch`);
  }

  const helper = await file('scripts/coolify-env.sh');
  assert.match(helper, /^PAPERCLIP_ENABLED=0$/m);
  assert.doesNotMatch(helper, /^PROFILE_SYNC_ENABLED=/m);
});

test('Paperclip entrypoint uses PAPERCLIP_ENABLED as the profile-sync opt-in', async () => {
  const entrypoint = await file('paperclip/entrypoint.sh');

  assert.match(entrypoint, /PAPERCLIP_ENABLED:-0/);
  assert.match(entrypoint, /Paperclip disabled/);
  assert.match(entrypoint, /Starting embedded profile-sync loop/);
  assert.match(entrypoint, /PROFILE_SYNC_ENABLED=1/);
  assert.doesNotMatch(entrypoint, /PROFILE_SYNC_ENABLED:-auto/);
  assert.doesNotMatch(entrypoint, /PROFILE_SYNC_ENABLED:-0/);
});

test('local build attaches to Hermes so Paperclip is not the build-triggering service', async () => {
  const compose = await file('compose.build.yaml');
  const paperclip = serviceBlock(compose, 'paperclip');
  const hermes = serviceBlock(compose, 'hermes');

  assert.doesNotMatch(paperclip, /build:/);
  assert.match(hermes, /build:\s*\n\s+context:\s*\.\s*\n\s+dockerfile:\s*paperclip\/Dockerfile/);
});

test('Hermes skill bootstrap adds bundled skills without wiping profile-owned skills', async () => {
  const bootstrap = await file('hermes-runtime/scripts/bootstrap-profiles.sh');

  assert.match(bootstrap, /install_hermes_bundled_skills\(\)/);
  assert.match(bootstrap, /install_agent_stack_skills\(\)/);
  assert.match(bootstrap, /install_hermes_bundled_skills "\$profile_home"/);
  assert.match(bootstrap, /install_agent_stack_skills "\$profile_home"/);
  assert.match(bootstrap, /install_hermes_bundled_skills "\$runtime_profile_home"/);
  assert.match(bootstrap, /install_agent_stack_skills "\$runtime_profile_home"/);
  assert.match(bootstrap, /if \[\[ -e "\$profile_home\/skills\/\$name" && ! -L "\$profile_home\/skills\/\$name" \]\]; then/);
  assert.match(bootstrap, /if \[\[ -e "\$dest\/\$name" && ! -L "\$dest\/\$name" \]\]; then/);
  assert.doesNotMatch(bootstrap, /rm\s+-rf\s+"\$profile_home\/skills"/);
  assert.doesNotMatch(bootstrap, /rm\s+-rf\s+"\$runtime_profile_home\/skills"/);
});
