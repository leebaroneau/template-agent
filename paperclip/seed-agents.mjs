#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const apiBase = required('PAPERCLIP_API_BASE').replace(/\/+$/, '');
const apiKey = required('PAPERCLIP_API_KEY');
const companyId = required('PAPERCLIP_COMPANY_ID');
const explicitHermesModel = envValue('HERMES_MODEL');
const explicitHermesProvider = envValue('HERMES_PROVIDER');
const paperclipAgentServerUrl = withoutApiSuffix(
  envValue('PAPERCLIP_AGENT_API_URL') || envValue('PAPERCLIP_API_URL') || 'http://127.0.0.1:3100',
);
const paperclipAgentApiUrl = withApiSuffix(paperclipAgentServerUrl);
const DELEGATION_PROTOCOL_PATH = '/data/agent-stack/delegation-protocol.md';
const DELEGATION_PROTOCOL_FILE = 'DELEGATION_PROTOCOL.md';
const DELEGATION_PROTOCOL_POINTER = [
  `Delegation Protocol: Before doing or reassigning work, read ${DELEGATION_PROTOCOL_PATH}.`,
  `If that shared file is unavailable, read ${DELEGATION_PROTOCOL_FILE} in your HERMES_HOME.`,
  'Apply it before accepting, rerouting, creating, commenting on, or completing issues.',
].join(' ');
const ORG_CHART_MARKDOWN_PATH = '/data/agent-stack/org-chart.md';
const ORG_CHART_JSON_PATH = '/data/agent-stack/org-chart.json';
const ORG_CHART_POINTER = [
  `Org Chart: Before delegating across roles, read ${ORG_CHART_MARKDOWN_PATH}.`,
  `For structured routing details, use ${ORG_CHART_JSON_PATH}.`,
].join(' ');
const LEARNING_PROTOCOL_PATH = '/data/agent-stack/learning-protocol.md';
const LEARNING_PROTOCOL_FILE = 'LEARNING_PROTOCOL.md';
const LEARNING_PROTOCOL_POINTER = [
  `Learning Protocol: At task start and finish, read ${LEARNING_PROTOCOL_PATH}.`,
  `If that shared file is unavailable, read ${LEARNING_PROTOCOL_FILE} in your HERMES_HOME.`,
  'Use your role-specific GBRAIN_HOME for durable learned summaries; do not crawl all of /data.',
].join(' ');
const DEFAULT_HERMES_TOOLSETS = 'terminal,file,web,mcp';

const roles = [
  {
    profile: 'default',
    name: 'Hermes',
    role: 'assistant',
    title: 'Hermes Agent',
    capabilities: 'Runs Hermes with the default profile and shared GBrain home.',
  },
];

const hermesConfigByProfile = new Map();
for (const role of roles) {
  hermesConfigByProfile.set(role.profile, await readHermesModelConfig(role.profile));
}

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    console.error(`${key} is required`);
    process.exit(1);
  }
  return value;
}

function envValue(key) {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function withoutApiSuffix(url) {
  return url.replace(/\/+$/, '').replace(/\/api$/, '');
}

function withApiSuffix(url) {
  return `${withoutApiSuffix(url)}/api`;
}

async function api(method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

async function readHermesModelConfig(profile) {
  for (const configPath of hermesConfigPaths(profile)) {
    try {
      const content = await readFile(configPath, 'utf8');
      const config = parseHermesModelConfig(content);
      if (config.model || config.provider) return config;
    } catch {
      // Try the next likely Hermes config location.
    }
  }

  return {};
}

function hermesConfigPaths(profile) {
  const paths = [];
  const explicitConfigPath = envValue('HERMES_CONFIG_PATH');
  const hermesHome = envValue('HERMES_HOME');

  if (explicitConfigPath) paths.push(explicitConfigPath);
  if (hermesHome) paths.push(join(hermesHome, 'config.yaml'));

  if (profile === 'default') {
    paths.push('/data/hermes/config.yaml');
  } else {
    paths.push(`/data/hermes/profiles/${profile}/config.yaml`);
  }

  paths.push(join(homedir(), '.hermes', 'config.yaml'));
  return [...new Set(paths)];
}

function parseHermesModelConfig(content) {
  const lines = content.split('\n');
  let inModel = false;
  let modelIndent = 0;
  const config = {};

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;

    if (indent === 0 && /^model:\s*$/.test(trimmed)) {
      inModel = true;
      modelIndent = indent;
      continue;
    }

    if (inModel && trimmed && !trimmed.startsWith('#') && indent <= modelIndent) {
      inModel = false;
    }

    if (!inModel) continue;

    const match = trimmed.match(/^\s*(provider|default)\s*:\s*(.+)$/);
    if (!match) continue;

    const key = match[1] === 'default' ? 'model' : 'provider';
    config[key] = match[2].trim().replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
  }

  return config;
}

function adapterConfig(profile) {
  const hermesHome = profile === 'default'
    ? '/data/hermes'
    : `/data/hermes/profiles/${profile}`;
  const detectedConfig = hermesConfigByProfile.get(profile) || {};
  const hermesModel = explicitHermesModel || detectedConfig.model;
  const hermesProvider = explicitHermesProvider || detectedConfig.provider;
  const config = {
    timeoutSec: 1800,
    persistSession: true,
    quiet: true,
    toolsets: DEFAULT_HERMES_TOOLSETS,
    cwd: '/opt/work',
    paperclipApiUrl: paperclipAgentApiUrl,
    env: {
      HERMES_HOME: hermesHome,
      GBRAIN_HOME: `/data/gbrain/${profile}`,
      PAPERCLIP_API_URL: paperclipAgentServerUrl,
    },
  };

  if (hermesModel) config.model = hermesModel;
  if (hermesProvider) config.provider = hermesProvider;

  return config;
}

function createPayload(role) {
  return {
    name: role.name,
    role: role.role,
    title: role.title,
    capabilities: withSharedOperatingPointers(role.capabilities),
    adapterType: 'hermes_local',
    adapterConfig: adapterConfig(role.profile),
    runtimeConfig: {
      heartbeat: {
        enabled: false,
        wakeOnDemand: true,
      },
    },
    budgetMonthlyCents: 0,
    metadata: {
      hermesProfile: role.profile,
      managedBy: 'agent-stack seed-agents.mjs',
    },
  };
}

function withSharedOperatingPointers(capabilities) {
  let next = typeof capabilities === 'string' ? capabilities.trim() : '';

  if (!next.includes(DELEGATION_PROTOCOL_PATH) && !/Delegation Protocol:/i.test(next)) {
    next = appendCapabilityPointer(next, DELEGATION_PROTOCOL_POINTER);
  }

  if (!next.includes(ORG_CHART_MARKDOWN_PATH) && !/Org Chart:/i.test(next)) {
    next = appendCapabilityPointer(next, ORG_CHART_POINTER);
  }

  if (!next.includes(LEARNING_PROTOCOL_PATH) && !/Learning Protocol:/i.test(next)) {
    next = appendCapabilityPointer(next, LEARNING_PROTOCOL_POINTER);
  }

  return next;
}

function appendCapabilityPointer(capabilities, pointer) {
  return capabilities ? `${capabilities}\n\n${pointer}` : pointer;
}

const existing = await api('GET', `/api/companies/${companyId}/agents`);
const rows = [];

for (const role of roles) {
  const match = existing.find((agent) => agent.name === role.name);
  const payload = createPayload(role);
  let agent;
  if (match) {
    agent = await api('PATCH', `/api/agents/${match.id}`, payload);
  } else {
    agent = await api('POST', `/api/companies/${companyId}/agents`, payload);
  }
  rows.push({
    name: agent.name,
    profile: role.profile,
    adapterType: agent.adapterType,
    model: payload.adapterConfig.model || '',
    provider: payload.adapterConfig.provider || '',
    id: agent.id,
  });
}

console.table(rows);
