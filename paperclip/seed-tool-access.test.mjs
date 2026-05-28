import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_COMPANY_TOOLS,
  DEFAULT_TOOL_ACCESS_PRESETS,
  seedToolAccessForCompany,
} from './seed-tool-access.mjs';

test('seeds company tools, presets, and applies the default preset idempotently', async () => {
  const state = {
    tools: [],
    presets: [],
    grants: [],
    agents: [
      { id: 'agent-1', adapterType: 'hermes_local', status: 'active' },
      { id: 'agent-2', adapterType: 'claude_local', status: 'active' },
    ],
    applyCalls: [],
  };

  const api = async (method, path, body) => {
    if (method === 'GET' && path === '/api/companies/company-1/tools') {
      return { tools: state.tools, grants: state.grants };
    }
    if (method === 'POST' && path === '/api/companies/company-1/tools') {
      const created = { id: `tool-${state.tools.length + 1}`, companyId: 'company-1', ...body };
      state.tools.push(created);
      return created;
    }
    if (method === 'GET' && path === '/api/companies/company-1/tool-presets') {
      return state.presets;
    }
    if (method === 'POST' && path === '/api/companies/company-1/tool-presets') {
      const created = { id: `preset-${state.presets.length + 1}`, companyId: 'company-1', ...body };
      state.presets.push(created);
      return created;
    }
    if (method === 'GET' && path === '/api/companies/company-1/agents') {
      return state.agents;
    }
    if (method === 'POST' && path === '/api/companies/company-1/tool-presets/apply') {
      state.applyCalls.push(body);
      const preset = state.presets.find((row) => row.id === body.presetId);
      for (const presetGrant of preset.grants) {
        const tool = state.tools.find((row) => row.key === presetGrant.toolKey);
        if (!tool) continue;
        const existing = state.grants.find((grant) => grant.agentId === body.agentId && grant.toolId === tool.id);
        if (existing) {
          existing.mode = presetGrant.mode;
        } else {
          state.grants.push({
            id: `grant-${state.grants.length + 1}`,
            agentId: body.agentId,
            toolId: tool.id,
            mode: presetGrant.mode,
          });
        }
      }
      return { grants: state.grants };
    }
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };

  const first = await seedToolAccessForCompany({ api, companyId: 'company-1' });
  assert.equal(first.createdTools, 11);
  assert.equal(first.createdPresets, 3);
  assert.equal(first.appliedPresets, 1);
  assert.equal(state.applyCalls.length, 1);
  assert.equal(state.applyCalls[0].agentId, 'agent-1');

  const second = await seedToolAccessForCompany({ api, companyId: 'company-1' });
  assert.equal(second.createdTools, 0);
  assert.equal(second.createdPresets, 0);
  assert.equal(second.appliedPresets, 0);
  assert.equal(state.applyCalls.length, 1);
});

test('skips gracefully when the Paperclip build has no tool access API', async () => {
  const logs = [];
  const summary = await seedToolAccessForCompany({
    companyId: 'company-1',
    log: (line) => logs.push(line),
    api: async () => {
      throw new Error('GET /api/companies/company-1/tools failed with 404: not found');
    },
  });

  assert.equal(summary.skipped, true);
  assert.match(logs[0], /tool access API unavailable/);
});

test('skips gracefully when the API client exposes a 404 status property', async () => {
  const error = new Error('Not Found');
  error.status = 404;
  const summary = await seedToolAccessForCompany({
    companyId: 'company-1',
    api: async () => {
      throw error;
    },
  });

  assert.equal(summary.skipped, true);
});

test('applies the default preset when the matrix endpoint returns a plain tool array', async () => {
  const state = {
    tools: [],
    presets: [],
    agents: [{ id: 'agent-1', adapterType: 'hermes_local', status: 'active' }],
    applyCalls: [],
  };

  const api = async (method, path, body) => {
    if (method === 'GET' && path === '/api/companies/company-1/tools') {
      return state.tools;
    }
    if (method === 'POST' && path === '/api/companies/company-1/tools') {
      const created = { id: `tool-${state.tools.length + 1}`, companyId: 'company-1', ...body };
      state.tools.push(created);
      return created;
    }
    if (method === 'GET' && path === '/api/companies/company-1/tool-presets') {
      return state.presets;
    }
    if (method === 'POST' && path === '/api/companies/company-1/tool-presets') {
      const created = { id: `preset-${state.presets.length + 1}`, companyId: 'company-1', ...body };
      state.presets.push(created);
      return created;
    }
    if (method === 'GET' && path === '/api/companies/company-1/agents') {
      return state.agents;
    }
    if (method === 'POST' && path === '/api/companies/company-1/tool-presets/apply') {
      state.applyCalls.push(body);
      return { ok: true };
    }
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };

  const summary = await seedToolAccessForCompany({ api, companyId: 'company-1' });
  assert.equal(summary.appliedPresets, 1);
  assert.equal(state.applyCalls.length, 1);
  assert.equal(state.applyCalls[0].agentId, 'agent-1');
});

test('does not apply the default preset when disabled', async () => {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path === '/api/companies/company-1/tools') return { tools: [], grants: [] };
    if (method === 'POST' && path === '/api/companies/company-1/tools') return { id: `tool-${calls.length}`, ...body };
    if (method === 'GET' && path === '/api/companies/company-1/tool-presets') return [];
    if (method === 'POST' && path === '/api/companies/company-1/tool-presets') return { id: `preset-${calls.length}`, ...body };
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };

  const summary = await seedToolAccessForCompany({
    api,
    companyId: 'company-1',
    applyDefaultPreset: false,
  });

  assert.equal(summary.appliedPresets, 0);
  assert.equal(calls.some((call) => call.path === '/api/companies/company-1/agents'), false);
  assert.equal(calls.some((call) => call.path === '/api/companies/company-1/tool-presets/apply'), false);
});

test('applies the default preset when the preset list omits inline grants', async () => {
  const state = {
    tools: DEFAULT_COMPANY_TOOLS.map((tool, index) => ({
      id: `tool-${index + 1}`,
      companyId: 'company-1',
      ...tool,
    })),
    presets: DEFAULT_TOOL_ACCESS_PRESETS.map((preset, index) => ({
      id: `preset-${index + 1}`,
      companyId: 'company-1',
      key: preset.key,
      label: preset.label,
    })),
    grants: [],
    agents: [{ id: 'agent-1', adapterType: 'hermes_local', status: 'active' }],
    applyCalls: [],
  };

  const api = async (method, path, body) => {
    if (method === 'GET' && path === '/api/companies/company-1/tools') {
      return { tools: state.tools, grants: state.grants };
    }
    if (method === 'GET' && path === '/api/companies/company-1/tool-presets') {
      return state.presets;
    }
    if (method === 'GET' && path === '/api/companies/company-1/agents') {
      return state.agents;
    }
    if (method === 'POST' && path === '/api/companies/company-1/tool-presets/apply') {
      state.applyCalls.push(body);
      return { ok: true };
    }
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };

  const summary = await seedToolAccessForCompany({ api, companyId: 'company-1' });
  assert.equal(summary.createdTools, 0);
  assert.equal(summary.createdPresets, 0);
  assert.equal(summary.appliedPresets, 1);
  assert.deepEqual(state.applyCalls, [{ agentId: 'agent-1', presetId: 'preset-1' }]);
});

test('logs and skips custom default preset application when grants are unavailable', async () => {
  const logs = [];
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path === '/api/companies/company-1/tools') {
      return {
        tools: DEFAULT_COMPANY_TOOLS.map((tool, index) => ({
          id: `tool-${index + 1}`,
          companyId: 'company-1',
          ...tool,
        })),
        grants: [],
      };
    }
    if (method === 'GET' && path === '/api/companies/company-1/tool-presets') {
      return [{ id: 'preset-custom', companyId: 'company-1', key: 'custom-default', label: 'Custom default' }];
    }
    if (method === 'POST' && path === '/api/companies/company-1/tool-presets') {
      return { id: `preset-${calls.length}`, companyId: 'company-1', ...body };
    }
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };

  const summary = await seedToolAccessForCompany({
    api,
    companyId: 'company-1',
    defaultPresetKey: 'custom-default',
    log: (line) => logs.push(line),
  });

  assert.equal(summary.appliedPresets, 0);
  assert.equal(calls.some((call) => call.path === '/api/companies/company-1/agents'), false);
  assert.match(logs[0], /custom-default has no grants/);
});
