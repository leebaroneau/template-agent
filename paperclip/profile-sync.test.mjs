import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildManagedAgentPayload,
  desiredProfileSlug,
  ensureProfileHomes,
  reconcileAgents,
} from './profile-sync.mjs';

test('desiredProfileSlug combines sanitized company and profile names', () => {
  assert.equal(desiredProfileSlug('Acme, Inc.', 'SEO Researcher'), 'acme-inc-seo-researcher');
});

test('desiredProfileSlug keeps an existing managed profile stable', () => {
  assert.equal(
    desiredProfileSlug('Renamed Company', 'SEO Researcher', 'acme-inc-seo-researcher'),
    'acme-inc-seo-researcher',
  );
});

test('buildManagedAgentPayload isolates Hermes and GBrain for one profile', () => {
  const payload = buildManagedAgentPayload({
    agent: {
      name: 'Researcher',
      role: 'assistant',
      title: 'Research Agent',
      adapterConfig: {
        timeoutSec: 30,
        env: {
          KEEP_ME: '1',
        },
      },
      metadata: {
        existing: true,
      },
    },
    companyName: 'Acme',
    paperclipAgentServerUrl: 'http://paperclip:3100/api',
  });

  assert.equal(payload.adapterType, 'hermes_local');
  assert.equal(payload.adapterConfig.env.HERMES_HOME, '/data/hermes/profiles/acme-researcher');
  assert.equal(payload.adapterConfig.env.GBRAIN_HOME, '/data/gbrain/acme-researcher');
  assert.equal(payload.adapterConfig.env.PAPERCLIP_API_URL, 'http://paperclip:3100');
  assert.equal(payload.adapterConfig.env.KEEP_ME, '1');
  assert.equal(payload.adapterConfig.paperclipApiUrl, 'http://paperclip:3100/api');
  assert.equal(payload.metadata.existing, true);
  assert.equal(payload.metadata.agentStackProfileSlug, 'acme-researcher');
  assert.equal(payload.metadata.managedBy, 'agent-stack profile-sync.mjs');
});

test('buildManagedAgentPayload removes unsupported mcp toolset from existing configs', () => {
  const payload = buildManagedAgentPayload({
    agent: {
      name: 'Engineer',
      adapterConfig: {
        toolsets: 'terminal,file,web,mcp',
      },
      metadata: {},
    },
    companyName: 'Acme',
  });

  assert.equal(payload.adapterConfig.toolsets, 'terminal,file,web');
});

test('buildManagedAgentPayload inherits Hermes model settings from the profile config', () => {
  const payload = buildManagedAgentPayload({
    agent: {
      name: 'CEO',
      adapterConfig: {},
      metadata: {},
    },
    companyName: 'Acme',
    hermesModelConfig: {
      model: 'gpt-5.5',
      provider: 'openai-codex',
    },
  });

  assert.equal(payload.adapterConfig.model, 'gpt-5.5');
  assert.equal(payload.adapterConfig.provider, 'openai-codex');
});

test('buildManagedAgentPayload adds shared operating pointers to capabilities', () => {
  const payload = buildManagedAgentPayload({
    agent: {
      name: 'Researcher',
      capabilities: 'Researches assigned market questions.',
      adapterConfig: {},
      metadata: {},
    },
    companyName: 'Acme',
  });

  assert.match(payload.capabilities, /Researches assigned market questions\./);
  assert.match(payload.capabilities, /Delegation Protocol/);
  assert.match(payload.capabilities, /\/data\/agent-stack\/delegation-protocol\.md/);
  assert.match(payload.capabilities, /Org Chart/);
  assert.match(payload.capabilities, /\/data\/agent-stack\/org-chart\.md/);
  assert.match(payload.capabilities, /Learning Protocol/);
  assert.match(payload.capabilities, /\/data\/agent-stack\/learning-protocol\.md/);
  assert.equal(payload.capabilities.match(/Delegation Protocol/g).length, 1);
  assert.equal(payload.capabilities.match(/Org Chart/g).length, 1);
  assert.equal(payload.capabilities.match(/Learning Protocol/g).length, 1);
});

test('buildManagedAgentPayload does not duplicate shared operating pointers', () => {
  const payload = buildManagedAgentPayload({
    agent: {
      name: 'Researcher',
      capabilities: [
        'Researches assigned market questions.',
        'Delegation Protocol: Before doing work, read /data/agent-stack/delegation-protocol.md.',
        'Org Chart: Before delegating across roles, read /data/agent-stack/org-chart.md.',
        'Learning Protocol: At task start and finish, read /data/agent-stack/learning-protocol.md.',
      ].join('\n'),
      adapterConfig: {},
      metadata: {},
    },
    companyName: 'Acme',
  });

  assert.equal(payload.capabilities.match(/Delegation Protocol/g).length, 1);
  assert.equal(payload.capabilities.match(/Org Chart/g).length, 1);
  assert.equal(payload.capabilities.match(/Learning Protocol/g).length, 1);
});

test('buildManagedAgentPayload keeps explicit agent model settings', () => {
  const payload = buildManagedAgentPayload({
    agent: {
      name: 'CEO',
      adapterConfig: {
        model: 'claude-opus-4-1',
        provider: 'anthropic',
      },
      metadata: {},
    },
    companyName: 'Acme',
    hermesModelConfig: {
      model: 'gpt-5.5',
      provider: 'openai-codex',
    },
  });

  assert.equal(payload.adapterConfig.model, 'claude-opus-4-1');
  assert.equal(payload.adapterConfig.provider, 'anthropic');
});

test('ensureProfileHomes creates profile config, soul, and gbrain directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-'));
  try {
    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: join(root, 'hermes'),
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    assert.equal(result.hermesHome, join(root, 'hermes/profiles/acme-researcher'));
    assert.equal(result.gbrainHome, join(root, 'gbrain/acme-researcher'));
    // Assert the rendered config.yaml is a faithful copy of the template that
    // ships in-repo. Pinning to the template content (rather than a static
    // '{}\n') stays correct as upstream adds MCP server / memory defaults to
    // the template, while still catching copy regressions.
    const templateConfig = await readFile(
      join(process.cwd(), 'hermes-runtime/templates/config.yaml'),
      'utf8',
    );
    assert.equal(await readFile(join(result.hermesHome, 'config.yaml'), 'utf8'), templateConfig);
    assert.match(await readFile(join(result.hermesHome, 'SOUL.md'), 'utf8'), /Hermes/);
    assert.match(
      await readFile(join(result.hermesHome, 'DELEGATION_PROTOCOL.md'), 'utf8'),
      /Delegation Protocol/,
    );
    assert.match(
      await readFile(join(result.hermesHome, 'LEARNING_PROTOCOL.md'), 'utf8'),
      /Learning Protocol/,
    );
    await stat(result.gbrainHome);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureProfileHomes copies default Hermes env into new profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-'));
  try {
    const hermesRoot = join(root, 'hermes');
    await mkdir(hermesRoot, { recursive: true });
    await writeFile(join(hermesRoot, '.env'), 'OPENAI_API_KEY=real-key\n');

    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: hermesRoot,
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    assert.equal(await readFile(join(result.hermesHome, '.env'), 'utf8'), 'OPENAI_API_KEY=real-key\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureProfileHomes clones default Hermes profile files without nested runtime profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-'));
  try {
    const hermesRoot = join(root, 'hermes');
    await mkdir(join(hermesRoot, 'skills', 'gbrain'), { recursive: true });
    await mkdir(join(hermesRoot, 'profiles', 'old-agent'), { recursive: true });
    await writeFile(join(hermesRoot, 'SOUL.md'), '# Default Soul\n');
    await writeFile(join(hermesRoot, 'config.yaml'), 'default-config: true\n');
    await writeFile(join(hermesRoot, 'skills', 'gbrain', 'SKILL.md'), '# Default GBrain Skill\n');
    await writeFile(join(hermesRoot, 'profiles', 'old-agent', 'SOUL.md'), '# Do Not Copy\n');

    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: hermesRoot,
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    assert.equal(await readFile(join(result.hermesHome, 'SOUL.md'), 'utf8'), '# Default Soul\n');
    assert.equal(
      await readFile(join(result.hermesHome, 'skills', 'gbrain', 'SKILL.md'), 'utf8'),
      '# Default GBrain Skill\n',
    );
    await assert.rejects(
      stat(join(result.hermesHome, 'profiles', 'old-agent', 'SOUL.md')),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureProfileHomes does not clone default Hermes runtime databases or sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-'));
  try {
    const hermesRoot = join(root, 'hermes');
    await mkdir(join(hermesRoot, 'sessions'), { recursive: true });
    await writeFile(join(hermesRoot, 'state.db'), 'default-state');
    await writeFile(join(hermesRoot, 'state.db-wal'), 'default-state-wal');
    await writeFile(join(hermesRoot, 'state.db-shm'), 'default-state-shm');
    await writeFile(join(hermesRoot, 'kanban.db'), 'default-kanban');
    await writeFile(join(hermesRoot, 'kanban.db-wal'), 'default-kanban-wal');
    await writeFile(join(hermesRoot, 'auth.lock'), '');
    await writeFile(join(hermesRoot, '.hermes_history'), 'old history');
    await writeFile(join(hermesRoot, 'sessions', 'session_20260515_160718_1a4293.json'), '{}');

    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: hermesRoot,
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    for (const relativePath of [
      'state.db',
      'state.db-wal',
      'state.db-shm',
      'kanban.db',
      'kanban.db-wal',
      'auth.lock',
      '.hermes_history',
      'sessions/session_20260515_160718_1a4293.json',
    ]) {
      await assert.rejects(stat(join(result.hermesHome, relativePath)), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureProfileHomes pre-creates Hermes well-known subdirs with 0700 perms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-prewarm-'));
  try {
    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: join(root, 'hermes'),
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    const expected = [
      'cron',
      'sessions',
      'logs',
      'logs/curator',
      'memories',
      'pairing',
      'hooks',
      'image_cache',
      'audio_cache',
      'skills',
    ];

    for (const rel of expected) {
      const info = await stat(join(result.hermesHome, rel));
      assert.ok(info.isDirectory(), `${rel} should be a directory`);
      assert.equal(
        info.mode & 0o777,
        0o700,
        `${rel} should be mode 0700, got ${(info.mode & 0o777).toString(8)}`,
      );
    }

    const homeInfo = await stat(result.hermesHome);
    assert.equal(homeInfo.mode & 0o777, 0o700, 'hermesHome should be mode 0700');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureProfileHomes pre-creates well-known subdirs for the default profile (flat layout)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-prewarm-default-'));
  try {
    const result = await ensureProfileHomes({
      profileSlug: 'default',
      hermesDataRoot: join(root, 'hermes'),
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    // For the default profile, hermesHome === hermesDataRoot (flat layout).
    assert.equal(result.hermesHome, join(root, 'hermes'));

    for (const rel of ['cron', 'sessions', 'logs/curator', 'skills']) {
      const info = await stat(join(result.hermesHome, rel));
      assert.ok(info.isDirectory(), `${rel} should exist in the flat default layout`);
      assert.equal(info.mode & 0o777, 0o700);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureProfileHomes restores broken perms on Hermes well-known subdirs (self-heal)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-prewarm-heal-'));
  try {
    const callOnce = () =>
      ensureProfileHomes({
        profileSlug: 'acme-researcher',
        hermesDataRoot: join(root, 'hermes'),
        gbrainDataRoot: join(root, 'gbrain'),
        templateDir: join(process.cwd(), 'hermes-runtime/templates'),
        initGbrain: false,
      });

    const first = await callOnce();
    const curatorPath = join(first.hermesHome, 'logs', 'curator');
    await chmod(curatorPath, 0o000);

    await callOnce();
    const restored = await stat(curatorPath);
    assert.equal(
      restored.mode & 0o777,
      0o700,
      'curator perms should be restored to 0700 on next sync',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureProfileHomes copies safe default GBrain skill folders without database files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-'));
  try {
    const defaultGbrain = join(root, 'gbrain', 'default');
    await mkdir(join(defaultGbrain, 'skills', 'article-enrichment'), { recursive: true });
    await mkdir(join(defaultGbrain, '.gbrain', 'skills', 'brain-pdf'), { recursive: true });
    await mkdir(join(defaultGbrain, '.gbrain', 'brain.pglite'), { recursive: true });
    await writeFile(join(defaultGbrain, 'skills', 'article-enrichment', 'SKILL.md'), '# Article Skill\n');
    await writeFile(join(defaultGbrain, '.gbrain', 'skills', 'brain-pdf', 'SKILL.md'), '# PDF Skill\n');
    await writeFile(join(defaultGbrain, '.gbrain', 'brain.pglite', 'PG_VERSION'), '16\n');
    await writeFile(join(defaultGbrain, '.gbrain', 'config.json'), '{"database_path":"default"}\n');
    await writeFile(join(defaultGbrain, 'company-memory.md'), '# Do Not Copy Knowledge\n');

    const result = await ensureProfileHomes({
      profileSlug: 'acme-researcher',
      hermesDataRoot: join(root, 'hermes'),
      gbrainDataRoot: join(root, 'gbrain'),
      templateDir: join(process.cwd(), 'hermes-runtime/templates'),
      initGbrain: false,
    });

    assert.equal(
      await readFile(join(result.gbrainHome, 'skills', 'article-enrichment', 'SKILL.md'), 'utf8'),
      '# Article Skill\n',
    );
    assert.equal(
      await readFile(join(result.gbrainHome, '.gbrain', 'skills', 'brain-pdf', 'SKILL.md'), 'utf8'),
      '# PDF Skill\n',
    );
    await assert.rejects(stat(join(result.gbrainHome, '.gbrain', 'brain.pglite', 'PG_VERSION')), {
      code: 'ENOENT',
    });
    await assert.rejects(stat(join(result.gbrainHome, '.gbrain', 'config.json')), { code: 'ENOENT' });
    await assert.rejects(stat(join(result.gbrainHome, 'company-memory.md')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reconcileAgents patches hermes_local agents, capability discovery, and managed entries', async () => {
  const apiCalls = [];
  const homeCalls = [];
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-org-'));
  const result = await reconcileAgents({
    companies: [{ id: 'co_1', name: 'Acme, Inc.' }],
    listAgents: async () => [
      {
        id: 'a_1',
        name: 'Researcher',
        role: 'assistant',
        title: 'Research Agent',
        capabilities: 'Researches assigned market questions.',
        adapterType: 'hermes_local',
        adapterConfig: {},
        metadata: {
          team: 'Growth',
          reportsTo: 'CEO',
        },
      },
      {
        id: 'a_2',
        name: 'Designer',
        title: 'Design Agent',
        adapterType: 'other',
        adapterConfig: {},
        metadata: {
          team: 'Creative',
        },
      },
    ],
    patchAgent: async (agentId, payload) => {
      apiCalls.push({ agentId, payload });
      return { id: agentId, ...payload };
    },
    ensureHomes: async ({ profileSlug }) => {
      homeCalls.push(profileSlug);
      return {
        profileSlug,
        modelConfig: {
          model: 'gpt-5.5',
          provider: 'openai-codex',
        },
      };
    },
    manifest: { managedAgents: [] },
    paperclipAgentServerUrl: 'http://paperclip:3100',
    orgMirrorRoot: root,
  });

  assert.deepEqual(homeCalls, ['acme-inc-researcher']);
  assert.equal(apiCalls.length, 2);
  const researcherPatch = apiCalls.find((call) => call.agentId === 'a_1');
  const designerPatch = apiCalls.find((call) => call.agentId === 'a_2');
  assert.equal(researcherPatch.payload.adapterConfig.model, 'gpt-5.5');
  assert.equal(researcherPatch.payload.adapterConfig.provider, 'openai-codex');
  assert.equal(researcherPatch.payload.metadata.agentStackProfileSlug, 'acme-inc-researcher');
  assert.match(researcherPatch.payload.capabilities, /Capability Discovery:/);
  assert.deepEqual(Object.keys(designerPatch.payload), ['capabilities']);
  assert.match(designerPatch.payload.capabilities, /Capability Discovery:/);
  assert.equal(result.capabilityPatched, 1);
  assert.equal(result.manifest.managedAgents.length, 1);
  assert.equal(result.manifest.managedAgents[0].agentId, 'a_1');
  assert.equal(result.manifest.managedAgents[0].profileSlug, 'acme-inc-researcher');

  const orgJson = JSON.parse(await readFile(join(root, 'org-chart.json'), 'utf8'));
  assert.equal(orgJson.companies.length, 1);
  assert.equal(orgJson.companies[0].agents.length, 2);
  assert.deepEqual(
    orgJson.companies[0].agents.map((agent) => agent.name),
    ['Researcher', 'Designer'],
  );
  assert.equal(orgJson.companies[0].agents[0].profileSlug, 'acme-inc-researcher');
  assert.equal(orgJson.companies[0].agents[0].team, 'Growth');
  assert.equal(orgJson.companies[0].agents[0].reportsTo, 'CEO');
  assert.equal(orgJson.companies[0].agents[1].team, 'Creative');
  assert.match(await readFile(join(root, 'org-chart.md'), 'utf8'), /Researcher/);
  assert.match(await readFile(join(root, 'org-chart.md'), 'utf8'), /Designer/);

  await rm(root, { recursive: true, force: true });
});

test('reconcileAgents grants task assignment to agents with direct reports', async () => {
  const permissionCalls = [];
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-permissions-'));
  try {
    const result = await reconcileAgents({
      companies: [{ id: 'co_1', name: 'Acme, Inc.' }],
      listAgents: async () => [
        {
          id: 'ceo_1',
          name: 'CEO',
          role: 'ceo',
          adapterType: 'process',
          permissions: { canCreateAgents: true },
        },
        {
          id: 'cto_1',
          name: 'CTO',
          role: 'cto',
          title: 'Chief Technology Officer',
          adapterType: 'process',
          reportsTo: 'ceo_1',
          permissions: { canCreateAgents: false },
        },
        {
          id: 'eng_1',
          name: 'Engineer',
          role: 'engineer',
          adapterType: 'process',
          reportsTo: 'cto_1',
          permissions: { canCreateAgents: false },
        },
      ],
      patchAgent: async (agentId, payload) => ({ id: agentId, ...payload }),
      patchAgentPermissions: async (agentId, payload) => {
        permissionCalls.push({ agentId, payload });
        return {
          id: agentId,
          permissions: { canCreateAgents: payload.canCreateAgents },
          access: {
            canAssignTasks: payload.canAssignTasks,
            taskAssignSource: 'explicit_grant',
          },
        };
      },
      ensureHomes: async () => {
        throw new Error('ensureHomes should not be called for process agents');
      },
      manifest: { managedAgents: [] },
      paperclipAgentServerUrl: 'http://paperclip:3100',
      orgMirrorRoot: root,
    });

    assert.equal(result.permissioned, 2);
    assert.deepEqual(permissionCalls, [
      {
        agentId: 'ceo_1',
        payload: { canCreateAgents: true, canAssignTasks: true },
      },
      {
        agentId: 'cto_1',
        payload: { canCreateAgents: false, canAssignTasks: true },
      },
    ]);

    const orgJson = JSON.parse(await readFile(join(root, 'org-chart.json'), 'utf8'));
    const ceo = orgJson.companies[0].agents.find((agent) => agent.id === 'ceo_1');
    const cto = orgJson.companies[0].agents.find((agent) => agent.id === 'cto_1');
    const engineer = orgJson.companies[0].agents.find((agent) => agent.id === 'eng_1');
    assert.equal(ceo.directReports, 1);
    assert.equal(ceo.access.canAssignTasks, true);
    assert.equal(ceo.permissions.canCreateAgents, true);
    assert.equal(cto.directReports, 1);
    assert.equal(cto.access.canAssignTasks, true);
    assert.equal(cto.permissions.canCreateAgents, false);
    assert.equal(engineer.directReports, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reconcileAgents adds capability discovery guidance to existing profiles', async () => {
  const capabilityPatches = [];
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-capabilities-'));
  try {
    await reconcileAgents({
      companies: [{ id: 'co_1', name: 'Acme, Inc.' }],
      listAgents: async () => [
        {
          id: 'cto_1',
          name: 'CTO',
          role: 'cto',
          title: 'Chief Technology Officer',
          capabilities: 'Owns engineering and infrastructure.',
          adapterType: 'hermes_local',
          adapterConfig: {},
          permissions: { canCreateAgents: false },
        },
        {
          id: 'cmo_1',
          name: 'CMO',
          role: 'cmo',
          title: 'Chief Marketing Officer',
          capabilities: 'Owns brand and demand generation.',
          adapterType: 'process',
          reportsTo: 'cto_1',
          permissions: { canCreateAgents: false },
        },
      ],
      patchAgent: async (agentId, payload) => {
        capabilityPatches.push({ agentId, capabilities: payload.capabilities });
        return { id: agentId, ...payload };
      },
      patchAgentPermissions: async (agentId, payload) => ({
        id: agentId,
        permissions: { canCreateAgents: payload.canCreateAgents },
        access: { canAssignTasks: payload.canAssignTasks },
      }),
      ensureHomes: async ({ profileSlug }) => ({ profileSlug }),
      manifest: { managedAgents: [] },
      paperclipAgentServerUrl: 'http://paperclip:3100',
      orgMirrorRoot: root,
    });

    const ctoPatch = capabilityPatches.find((patch) => patch.agentId === 'cto_1');
    const cmoPatch = capabilityPatches.find((patch) => patch.agentId === 'cmo_1');
    assert.match(ctoPatch.capabilities, /Capability Discovery:/);
    assert.match(ctoPatch.capabilities, /technical implementation/i);
    assert.match(ctoPatch.capabilities, /peer manager/i);
    assert.match(cmoPatch.capabilities, /Capability Discovery:/);
    assert.match(cmoPatch.capabilities, /marketing/i);
    assert.match(cmoPatch.capabilities, /appropriate peer manager/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reconcileAgents archives missing managed agents after a successful company scan', async () => {
  const archived = [];
  const result = await reconcileAgents({
    companies: [{ id: 'co_1', name: 'Acme' }],
    listAgents: async () => [],
    patchAgent: async () => {
      throw new Error('patchAgent should not be called');
    },
    ensureHomes: async () => {
      throw new Error('ensureHomes should not be called');
    },
    writeOrgMirror: async () => {},
    retireHomes: async (entry) => {
      archived.push(entry.profileSlug);
    },
    manifest: {
      managedAgents: [
        {
          companyId: 'co_1',
          companyName: 'Acme',
          agentId: 'a_1',
          agentName: 'Researcher',
          profileSlug: 'acme-researcher',
        },
      ],
    },
    deleteMode: 'archive',
    paperclipAgentServerUrl: 'http://paperclip:3100',
  });

  assert.deepEqual(archived, ['acme-researcher']);
  assert.equal(result.manifest.managedAgents.length, 0);
});

test('reconcileAgents archives managed agents returned as terminated', async () => {
  const archived = [];
  const result = await reconcileAgents({
    companies: [{ id: 'co_1', name: 'Acme' }],
    listAgents: async () => [
      {
        id: 'a_1',
        name: 'Researcher',
        adapterType: 'hermes_local',
        terminatedAt: '2026-05-15T00:00:00.000Z',
        adapterConfig: {},
        metadata: { agentStackProfileSlug: 'acme-researcher' },
      },
    ],
    patchAgent: async () => {
      throw new Error('patchAgent should not be called');
    },
    ensureHomes: async () => {
      throw new Error('ensureHomes should not be called');
    },
    writeOrgMirror: async () => {},
    retireHomes: async (entry) => {
      archived.push(entry.profileSlug);
    },
    manifest: {
      managedAgents: [
        {
          companyId: 'co_1',
          companyName: 'Acme',
          agentId: 'a_1',
          agentName: 'Researcher',
          profileSlug: 'acme-researcher',
        },
      ],
    },
    deleteMode: 'archive',
    paperclipAgentServerUrl: 'http://paperclip:3100',
  });

  assert.deepEqual(archived, ['acme-researcher']);
  assert.equal(result.manifest.managedAgents.length, 0);
});

test('profile-sync CLI one-shot provisions homes and patches Paperclip API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sync-cli-'));
  const patched = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/api/companies') {
        return json(response, [{ id: 'co_1', name: 'Acme, Inc.' }]);
      }

      if (request.method === 'GET' && request.url === '/api/companies/co_1/agents') {
        return json(response, [
          { id: 'a_1', name: 'Researcher', adapterType: 'hermes_local', adapterConfig: {}, metadata: {} },
        ]);
      }

      if (request.method === 'PATCH' && request.url === '/api/agents/a_1') {
        const body = await readRequestJson(request);
        patched.push(body);
        return json(response, { id: 'a_1', ...body });
      }

      response.statusCode = 404;
      response.end('not found');
    } catch (error) {
      response.statusCode = 500;
      response.end(error.stack || error.message);
    }
  });

  await listen(server);
  try {
    const port = server.address().port;
    const manifestPath = join(root, 'manifest.json');
    const child = await runNode(['paperclip/profile-sync.mjs', 'once'], {
      PROFILE_SYNC_ENABLED: '1',
      PROFILE_SYNC_SKIP_GBRAIN_INIT: '1',
      PAPERCLIP_PROFILE_SYNC_API_KEY: 'test-key',
      PAPERCLIP_API_BASE: `http://127.0.0.1:${port}`,
      PAPERCLIP_AGENT_API_URL: 'http://127.0.0.1:3100',
      HERMES_DATA_ROOT: join(root, 'hermes'),
      GBRAIN_DATA_ROOT: join(root, 'gbrain'),
      ORG_MIRROR_ROOT: join(root, 'agent-stack'),
      PROFILE_SYNC_MANIFEST_PATH: manifestPath,
      PROFILE_SYNC_TEMPLATE_DIR: join(process.cwd(), 'hermes-runtime/templates'),
    });

    assert.equal(child.code, 0, child.stderr);
    assert.match(child.stdout, /"patched":1/);
    assert.equal(patched.length, 1);
    assert.equal(patched[0].metadata.agentStackProfileSlug, 'acme-inc-researcher');
    assert.equal(
      patched[0].adapterConfig.env.HERMES_HOME,
      join(root, 'hermes/profiles/acme-inc-researcher'),
    );
    assert.equal(
      patched[0].adapterConfig.env.GBRAIN_HOME,
      join(root, 'gbrain/acme-inc-researcher'),
    );
    await stat(join(root, 'hermes/profiles/acme-inc-researcher/config.yaml'));
    await stat(join(root, 'gbrain/acme-inc-researcher'));

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.managedAgents[0].agentId, 'a_1');
    assert.equal(manifest.managedAgents[0].profileSlug, 'acme-inc-researcher');
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

function json(response, body) {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function runNode(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}
