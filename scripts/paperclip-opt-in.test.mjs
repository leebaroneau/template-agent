import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

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

test('Paperclip-only agent-stack skills follow PAPERCLIP_ENABLED', async () => {
  const root = await mkdtemp(join(tmpdir(), 'template-agent-skills-'));
  const hermesHome = join(root, 'hermes');
  const templateDir = join(root, 'templates');
  const skillsSource = join(root, 'agent-stack-skills');
  const alwaysOnSkills = [
    'claude-code',
    'codex',
    'pipeline-workflow',
    'shopify-app',
    'shopify-theme',
    'use-100m-framework',
    'use-eos-framework',
  ];
  const paperclipOnlySkills = ['paperclip-org-structure', 'using-paperclip'];

  await mkdir(templateDir, { recursive: true });
  await mkdir(skillsSource, { recursive: true });
  await writeFile(join(templateDir, 'config.yaml'), '{}\n');
  await writeFile(join(templateDir, 'SOUL.default.md'), '# Default\n');

  for (const skill of [...alwaysOnSkills, ...paperclipOnlySkills]) {
    const dir = join(skillsSource, skill);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), `name: ${skill}\n`);
  }

  const runBootstrap = (paperclipEnabled) => execFileAsync(
    'bash',
    ['hermes-runtime/scripts/bootstrap-profiles.sh'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HERMES_DATA_ROOT: hermesHome,
        HERMES_PROFILES: 'default',
        TEMPLATE_DIR: templateDir,
        HERMES_BUNDLED_SKILLS_SOURCE: join(root, 'missing-hermes-skills'),
        AGENT_STACK_SKILLS_SOURCE: skillsSource,
        PAPERCLIP_ENABLED: paperclipEnabled,
      },
    },
  );

  const skillPath = (skill) => join(hermesHome, 'skills', 'agent-stack', skill);
  const exists = async (path) => {
    try {
      await access(path);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };

  try {
    await runBootstrap('0');
    for (const skill of alwaysOnSkills) {
      assert.equal(await exists(skillPath(skill)), true);
    }
    for (const skill of paperclipOnlySkills) {
      assert.equal(await exists(skillPath(skill)), false);
    }

    await runBootstrap('1');
    for (const skill of [...alwaysOnSkills, ...paperclipOnlySkills]) {
      assert.equal((await lstat(skillPath(skill))).isSymbolicLink(), true);
    }

    await runBootstrap('0');
    for (const skill of alwaysOnSkills) {
      assert.equal(await exists(skillPath(skill)), true);
    }
    for (const skill of paperclipOnlySkills) {
      assert.equal(await exists(skillPath(skill)), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
