#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_PRESET_KEY = 'agent-stack-hermes-default';

export const DEFAULT_COMPANY_TOOLS = Object.freeze([
  {
    key: 'adapter_toolset.terminal',
    label: 'Hermes terminal',
    source: 'adapter_toolset',
    adapter: 'hermes_local',
    risk: 'admin',
    supportedModes: ['off', 'admin'],
    render: { hermes: { toolset: 'terminal' } },
  },
  {
    key: 'adapter_toolset.file',
    label: 'Hermes file tools',
    source: 'adapter_toolset',
    adapter: 'hermes_local',
    risk: 'write',
    supportedModes: ['off', 'read', 'write'],
    render: { hermes: { toolset: 'file' } },
  },
  {
    key: 'adapter_toolset.web',
    label: 'Hermes web tools',
    source: 'adapter_toolset',
    adapter: 'hermes_local',
    risk: 'read',
    supportedModes: ['off', 'read'],
    render: { hermes: { toolset: 'web' } },
  },
  ...[
    ['mcp.paperclip.list_companies', 'Paperclip list companies', 'paperclip_list_companies', 'read'],
    ['mcp.paperclip.list_issues', 'Paperclip list issues', 'paperclip_list_issues', 'read'],
    ['mcp.paperclip.get_issue', 'Paperclip get issue', 'paperclip_get_issue', 'read'],
    ['mcp.paperclip.list_agents', 'Paperclip list agents', 'paperclip_list_agents', 'read'],
    ['mcp.paperclip.list_projects', 'Paperclip list projects', 'paperclip_list_projects', 'read'],
    ['mcp.paperclip.create_issue', 'Paperclip create issue', 'paperclip_create_issue', 'write'],
    ['mcp.paperclip.update_issue', 'Paperclip update issue', 'paperclip_update_issue', 'write'],
    ['mcp.paperclip.comment_on_issue', 'Paperclip comment on issue', 'paperclip_comment_on_issue', 'write'],
  ].map(([key, label, toolName, risk]) => ({
    key,
    label,
    source: 'mcp_tool',
    adapter: 'hermes_local',
    serverKey: 'paperclip',
    toolName,
    risk,
    supportedModes: risk === 'read' ? ['off', 'read'] : ['off', 'read', 'write'],
    render: { hermes: { mcpServer: 'paperclip', includeTool: toolName } },
  })),
]);

export const DEFAULT_TOOL_ACCESS_PRESETS = Object.freeze([
  {
    key: DEFAULT_PRESET_KEY,
    label: 'Hermes default',
    grants: [
      { toolKey: 'adapter_toolset.terminal', mode: 'admin' },
      { toolKey: 'adapter_toolset.file', mode: 'write' },
      { toolKey: 'adapter_toolset.web', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_companies', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_issues', mode: 'read' },
      { toolKey: 'mcp.paperclip.get_issue', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_agents', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_projects', mode: 'read' },
      { toolKey: 'mcp.paperclip.create_issue', mode: 'write' },
      { toolKey: 'mcp.paperclip.update_issue', mode: 'write' },
      { toolKey: 'mcp.paperclip.comment_on_issue', mode: 'write' },
    ],
  },
  {
    key: 'agent-stack-researcher',
    label: 'Researcher',
    grants: [
      { toolKey: 'adapter_toolset.file', mode: 'write' },
      { toolKey: 'adapter_toolset.web', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_issues', mode: 'read' },
      { toolKey: 'mcp.paperclip.get_issue', mode: 'read' },
      { toolKey: 'mcp.paperclip.comment_on_issue', mode: 'write' },
    ],
  },
  {
    key: 'agent-stack-manager',
    label: 'Manager',
    grants: [
      { toolKey: 'adapter_toolset.terminal', mode: 'admin' },
      { toolKey: 'adapter_toolset.file', mode: 'write' },
      { toolKey: 'adapter_toolset.web', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_companies', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_issues', mode: 'read' },
      { toolKey: 'mcp.paperclip.get_issue', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_agents', mode: 'read' },
      { toolKey: 'mcp.paperclip.list_projects', mode: 'read' },
      { toolKey: 'mcp.paperclip.create_issue', mode: 'write' },
      { toolKey: 'mcp.paperclip.update_issue', mode: 'write' },
      { toolKey: 'mcp.paperclip.comment_on_issue', mode: 'write' },
    ],
  },
]);
const DEFAULT_TOOL_ACCESS_PRESETS_BY_KEY = new Map(DEFAULT_TOOL_ACCESS_PRESETS.map((preset) => [preset.key, preset]));

export async function seedToolAccessForCompanies({
  api,
  companies,
  applyDefaultPreset = true,
  defaultPresetKey = DEFAULT_PRESET_KEY,
  log = () => {},
}) {
  const summaries = [];
  for (const company of companies) {
    summaries.push(await seedToolAccessForCompany({
      api,
      companyId: company.id,
      applyDefaultPreset,
      defaultPresetKey,
      log,
    }));
  }
  return summaries;
}

export async function seedToolAccessForCompany({
  api,
  companyId,
  applyDefaultPreset = true,
  defaultPresetKey = DEFAULT_PRESET_KEY,
  log = () => {},
}) {
  try {
    return await seedToolAccessForCompanyStrict({
      api,
      companyId,
      applyDefaultPreset,
      defaultPresetKey,
      log,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      log(`[agent-stack] tool access API unavailable for ${companyId}; skipping seed`);
      return { companyId, skipped: true, createdTools: 0, createdPresets: 0, appliedPresets: 0 };
    }
    throw error;
  }
}

async function seedToolAccessForCompanyStrict({
  api,
  companyId,
  applyDefaultPreset,
  defaultPresetKey,
  log = () => {},
}) {
  let matrix = await api('GET', `/api/companies/${companyId}/tools`);
  const existingToolsByKey = new Map(extractArray(matrix.tools ?? matrix).map((tool) => [tool.key, tool]));
  let createdTools = 0;

  for (const tool of DEFAULT_COMPANY_TOOLS) {
    if (existingToolsByKey.has(tool.key)) continue;
    const created = await api('POST', `/api/companies/${companyId}/tools`, tool);
    existingToolsByKey.set(created.key, created);
    createdTools += 1;
  }

  const existingPresets = extractArray(await api('GET', `/api/companies/${companyId}/tool-presets`));
  const existingPresetsByKey = new Map(existingPresets.map((preset) => [preset.key, preset]));
  let createdPresets = 0;

  for (const preset of DEFAULT_TOOL_ACCESS_PRESETS) {
    if (existingPresetsByKey.has(preset.key)) continue;
    const created = await api('POST', `/api/companies/${companyId}/tool-presets`, preset);
    existingPresetsByKey.set(created.key, created);
    createdPresets += 1;
  }

  let appliedPresets = 0;
  if (applyDefaultPreset) {
    matrix = await api('GET', `/api/companies/${companyId}/tools`);
    const toolsByKey = new Map(extractArray(matrix.tools ?? matrix).map((tool) => [tool.key, tool]));
    const grants = extractArray(matrix.grants ?? []);
    const preset = existingPresetsByKey.get(defaultPresetKey);
    if (preset) {
      const presetDefinition = DEFAULT_TOOL_ACCESS_PRESETS_BY_KEY.get(defaultPresetKey);
      const presetGrants = extractArray(preset.grants).length > 0 ? preset.grants : presetDefinition?.grants;
      if (extractArray(presetGrants).length === 0) {
        log(`[agent-stack] preset ${defaultPresetKey} has no grants; skipping default preset apply for ${companyId}`);
      } else {
        const agents = extractArray(await api('GET', `/api/companies/${companyId}/agents`))
          .filter((agent) => agent?.adapterType === 'hermes_local' && !isRetiredAgent(agent));
        for (const agent of agents) {
          if (presetAlreadyApplied({ agentId: agent.id, presetGrants, toolsByKey, grants })) continue;
          await api('POST', `/api/companies/${companyId}/tool-presets/apply`, {
            agentId: agent.id,
            presetId: preset.id,
          });
          appliedPresets += 1;
        }
      }
    }
  }

  return { companyId, skipped: false, createdTools, createdPresets, appliedPresets };
}

function presetAlreadyApplied({ agentId, presetGrants, toolsByKey, grants }) {
  return extractArray(presetGrants).every((grant) => {
    const tool = toolsByKey.get(grant.toolKey);
    if (!tool) return false;
    const existing = grants.find((row) => row.agentId === agentId && row.toolId === tool.id);
    return (existing?.mode || 'off') === grant.mode;
  });
}

function isNotFoundError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  if (status === 404) return true;
  return /\b404\b/.test(String(error?.message || error));
}

function isRetiredAgent(agent) {
  const status = String(agent?.status || '').toLowerCase();
  return ['archived', 'retired', 'deleted', 'disabled'].includes(status);
}

function extractArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.companies)) return value.companies;
  if (Array.isArray(value?.agents)) return value.agents;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function envValue(key, fallback) {
  const value = process.env[key]?.trim();
  return value || fallback;
}

function envBool(key, fallback = false) {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function parseCompanyIds(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function withoutApiSuffix(url) {
  return url.replace(/\/+$/, '').replace(/\/api$/, '');
}

function makeApiClient({ apiBase, apiKey }) {
  const serverUrl = withoutApiSuffix(apiBase);
  return async function api(method, path, body) {
    const response = await fetch(`${serverUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`${method} ${path} failed with ${response.status}: ${text}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return await response.json();
  };
}

async function resolveCompanies(api) {
  const ids = [
    ...parseCompanyIds(envValue('PAPERCLIP_COMPANY_IDS')),
    ...parseCompanyIds(envValue('PAPERCLIP_DEFAULT_COMPANY_ID')),
    ...parseCompanyIds(envValue('PAPERCLIP_COMPANY_ID')),
  ];
  if (ids.length > 0) return [...new Set(ids)].map((id) => ({ id }));
  return extractArray(await api('GET', '/api/companies')).map((company) => ({ id: company.id })).filter((company) => company.id);
}

async function main() {
  const apiKey = envValue('PAPERCLIP_PROFILE_SYNC_API_KEY') || envValue('PAPERCLIP_API_KEY');
  if (!apiKey) throw new Error('PAPERCLIP_PROFILE_SYNC_API_KEY or PAPERCLIP_API_KEY is required');
  const api = makeApiClient({
    apiBase: envValue('PAPERCLIP_API_BASE', 'http://127.0.0.1:3100'),
    apiKey,
  });
  const summaries = await seedToolAccessForCompanies({
    api,
    companies: await resolveCompanies(api),
    applyDefaultPreset: envBool('TOOL_ACCESS_APPLY_DEFAULT_PRESET', true),
    defaultPresetKey: envValue('TOOL_ACCESS_DEFAULT_PRESET', DEFAULT_PRESET_KEY),
    log: console.log,
  });
  console.log(JSON.stringify({ companies: summaries.length, summaries }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
