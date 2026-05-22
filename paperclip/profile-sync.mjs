#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const MANAGED_BY = 'agent-stack profile-sync.mjs';
const DEFAULT_TEMPLATE_DIR = '/opt/hermes-runtime/templates';
const DEFAULT_MANIFEST_PATH = '/data/agent-stack/profile-sync/manifest.json';
const DEFAULT_SYNC_API_BASE = 'http://paperclip:3100';
const DEFAULT_AGENT_API_URL = 'http://127.0.0.1:3100';
const DEFAULT_ORG_MIRROR_ROOT = '/data/agent-stack';
const MIN_MANAGED_TIMEOUT_SEC = 1800;
const HERMES_MODEL_MODE_INHERIT = 'inherit';
const HERMES_MODEL_MODE_PAPERCLIP_DEFAULT = 'paperclip-default';
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
const HERMES_TEMPLATE_SKIP_DIRS = new Set([
  'profiles',
  'archive',
  'bootstrap',
  '.cache',
  'cache',
  'tmp',
  'logs',
  'sessions',
  'node_modules',
  '__pycache__',
]);
const HERMES_TEMPLATE_SKIP_FILES = new Set([
  '.hermes_history',
  '.update_check',
  'auth.lock',
  'context_length_cache.yaml',
  'gateway_state.json',
  'kanban.db',
  'models_dev_cache.json',
  'ollama_cloud_models_cache.json',
  'state.db',
]);
const HERMES_SQLITE_SIDECARE_RE = /^(?:state|kanban)\.db-(?:journal|shm|wal)$/;
const GBRAIN_TEMPLATE_PATHS = [
  'skills',
  '.gbrain/skills',
  '.gbrain/prompts',
  '.gbrain/conventions',
  'AGENTS.md',
  'RESOLVER.md',
  'gbrain.yml',
  'gbrain.yaml',
];

// Canonical list of Hermes well-known subdirs, mirroring upstream
// hermes_cli/config.py:ensure_hermes_home(). Pre-creating these with stable
// perms inside profile-sync eliminates the EACCES startup race where Paperclip
// can dispatch an agent run before Hermes' own lazy mkdir window settles.
//
// Keep this list in lock-step with upstream. If a Hermes release adds a new
// well-known subdir, append it here.
export const HERMES_WELL_KNOWN_SUBDIRS = Object.freeze([
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
]);

export function desiredProfileSlug(companyName, profileName, existingSlug) {
  if (existingSlug && isSafeSlug(existingSlug)) return existingSlug;

  const companySlug = slugPart(companyName || 'company');
  const profileSlug = slugPart(profileName || 'agent');
  const combined = `${companySlug}-${profileSlug}`;
  if (combined.length <= 96) return combined;

  const digest = createHash('sha1').update(combined).digest('hex').slice(0, 8);
  return `${combined.slice(0, 87).replace(/-+$/g, '')}-${digest}`;
}

export function buildManagedAgentPayload({
  agent,
  companyName,
  paperclipAgentServerUrl = DEFAULT_AGENT_API_URL,
  hermesDataRoot = '/data/hermes',
  gbrainDataRoot = '/data/gbrain',
  hermesModelConfig,
  hermesModelMode = HERMES_MODEL_MODE_INHERIT,
  capabilityContext,
  desiredSkills,
}) {
  const normalizedHermesModelMode = normalizeHermesModelMode(hermesModelMode);
  const usePaperclipModelDefault = normalizedHermesModelMode === HERMES_MODEL_MODE_PAPERCLIP_DEFAULT;
  const metadata = agent.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
  const profileSlug = desiredProfileSlug(
    companyName,
    metadata.profileName || metadata.hermesProfileName || agent.name,
    metadata.agentStackProfileSlug || metadata.hermesProfile,
  );
  assertSafeSlug(profileSlug);

  const paperclipServerUrl = withoutApiSuffix(paperclipAgentServerUrl);
  const hermesHome = join(hermesDataRoot, 'profiles', profileSlug);
  const gbrainHome = join(gbrainDataRoot, profileSlug);
  const existingConfig = agent.adapterConfig && typeof agent.adapterConfig === 'object'
    ? agent.adapterConfig
    : {};
  const existingEnv = existingConfig.env && typeof existingConfig.env === 'object'
    ? existingConfig.env
    : {};
  const {
    model: _existingModel,
    provider: _existingProvider,
    ...existingConfigWithoutModelDefaults
  } = existingConfig;
  const existingConfigForPayload = usePaperclipModelDefault
    ? existingConfigWithoutModelDefaults
    : existingConfig;

  const capabilities = capabilityContext
    ? withCapabilityDiscovery(agent.capabilities, agent, capabilityContext)
    : normalizedCapabilityText(agent.capabilities);
  const timeoutSec = managedTimeoutSec(existingConfigForPayload.timeoutSec);

  const adapterConfig = {
    ...(!usePaperclipModelDefault && hermesModelConfig?.model ? { model: hermesModelConfig.model } : {}),
    ...(!usePaperclipModelDefault && hermesModelConfig?.provider ? { provider: hermesModelConfig.provider } : {}),
    timeoutSec: MIN_MANAGED_TIMEOUT_SEC,
    persistSession: true,
    quiet: true,
    toolsets: 'terminal,file,web',
    cwd: '/opt/work',
    ...existingConfigForPayload,
    timeoutSec,
    toolsets: normalizeToolsets(existingConfig.toolsets),
    ...(Array.isArray(desiredSkills)
      ? { paperclipSkillSync: withDesiredPaperclipSkills(existingConfig.paperclipSkillSync, desiredSkills) }
      : {}),
    paperclipApiUrl: withApiSuffix(paperclipServerUrl),
    env: {
      ...existingEnv,
      HERMES_HOME: hermesHome,
      GBRAIN_HOME: gbrainHome,
      PAPERCLIP_API_URL: paperclipServerUrl,
    },
  };

  if (usePaperclipModelDefault) {
    adapterConfig.model = null;
    adapterConfig.provider = null;
  }

  return {
    capabilities: withSharedOperatingPointers(capabilities),
    adapterType: 'hermes_local',
    adapterConfig,
    metadata: {
      ...metadata,
      hermesProfile: profileSlug,
      agentStackProfileSlug: profileSlug,
      agentStackHermesHome: hermesHome,
      agentStackGbrainHome: gbrainHome,
      managedBy: MANAGED_BY,
    },
  };
}

function managedTimeoutSec(timeoutSec) {
  const numericTimeoutSec = Number(timeoutSec);
  if (!Number.isFinite(numericTimeoutSec)) return MIN_MANAGED_TIMEOUT_SEC;
  return Math.max(numericTimeoutSec, MIN_MANAGED_TIMEOUT_SEC);
}

function normalizeHermesModelMode(mode) {
  const normalized = String(mode || HERMES_MODEL_MODE_INHERIT).trim().toLowerCase();
  if (!normalized || normalized === HERMES_MODEL_MODE_INHERIT) return HERMES_MODEL_MODE_INHERIT;
  if (
    normalized === HERMES_MODEL_MODE_PAPERCLIP_DEFAULT
    || normalized === 'paperclip_default'
    || normalized === 'model-default'
    || normalized === 'model_default'
    || normalized === 'default'
  ) {
    return HERMES_MODEL_MODE_PAPERCLIP_DEFAULT;
  }
  throw new Error(
    `Invalid PROFILE_SYNC_HERMES_MODEL_MODE: ${mode}. Expected inherit or paperclip-default.`,
  );
}

function normalizeToolsets(toolsets) {
  const rawToolsets = typeof toolsets === 'string' && toolsets.trim()
    ? toolsets
    : 'terminal,file,web';
  const normalized = rawToolsets
    .split(',')
    .map((toolset) => toolset.trim())
    .filter((toolset) => toolset && toolset !== 'mcp');
  return [...new Set(normalized)].join(',') || 'terminal,file,web';
}

function withDesiredPaperclipSkills(existingSync, desiredSkills) {
  const current = existingSync && typeof existingSync === 'object' && !Array.isArray(existingSync)
    ? existingSync
    : {};
  const normalized = desiredSkills
    .filter((skill) => typeof skill === 'string')
    .map((skill) => skill.trim())
    .filter(Boolean);
  return {
    ...current,
    desiredSkills: [...new Set(normalized)],
  };
}

function withSharedOperatingPointers(capabilities) {
  let next = typeof capabilities === 'string' ? capabilities.trim() : '';

  if (!next.includes(DELEGATION_PROTOCOL_PATH) && !/Delegation Protocol:/i.test(next)) {
    next = appendCapabilityPointer(next, DELEGATION_PROTOCOL_POINTER);
  }

  if (!/Org Chart:/i.test(next)) {
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

function withCapabilityDiscovery(capabilities, agent, context = {}) {
  let next = normalizedCapabilityText(capabilities);
  if (/Capability Discovery:/i.test(next)) return next;

  const scope = roleRoutingScope(agent);
  const directReportCount = Number(context.directReportCount || 0);
  const managerLine = directReportCount > 0
    ? `This role has ${directReportCount} direct report${directReportCount === 1 ? '' : 's'} and should use Paperclip task assignment for team routing. Managers with direct reports assign cross-team child tasks to the appropriate peer manager, not directly to that manager's individual reports.`
    : 'This role should execute in its own scope and delegate work outside that scope to the appropriate peer manager.';

  const guidance = [
    'Capability Discovery:',
    `Own and accept ${scope.own}.`,
    `Route ${scope.routeToThis} through this role.`,
    `Route work outside this scope by reading ${ORG_CHART_MARKDOWN_PATH} and assigning/commenting to the appropriate peer manager with parent task context, deadline, links, and done criteria.`,
    managerLine,
  ].join(' ');

  return appendCapabilityPointer(next, guidance);
}

function normalizedCapabilityText(capabilities) {
  return typeof capabilities === 'string' ? capabilities.trim() : '';
}

function roleRoutingScope(agent) {
  const haystack = `${agent?.role || ''} ${agent?.name || ''} ${agent?.title || ''}`.toLowerCase();

  if (/\bceo\b|chief executive|orchestrator|intake/.test(haystack)) {
    return {
      own: 'company-level prioritization, executive escalation, final routing decisions, and unresolved cross-team blockers',
      routeToThis: 'ambiguous ownership, budget/prioritization conflicts, hiring approvals, and work outside existing manager scopes',
    };
  }

  if (/\bcto\b|chief technology|engineer|engineering|frontend|backend|devops|platform|security|qa|data|analytics|architect|technical|infrastructure|schema|deployment/.test(haystack)) {
    return {
      own: 'technical implementation, engineering investigation, infrastructure, data, QA, security, deployments, migrations, and product build work',
      routeToThis: 'code changes, technical investigations, architecture decisions, deployment work, schema changes, automation, QA, and engineering blockers',
    };
  }

  if (/\bcmo\b|chief marketing|marketing|growth|brand|creative|content|seo|paid|media|lifecycle|crm|demand|campaign|ecommerce|commerce|trading|cro|conversion/.test(haystack)) {
    return {
      own: 'brand, content, demand generation, lifecycle marketing, paid media, SEO, CRO, ecommerce trading, campaign planning, and commercial growth work',
      routeToThis: 'campaigns, copy, landing page briefs, content production, paid ad work, lifecycle/CRM, SEO, ecommerce trading, CRO, and marketing blockers',
    };
  }

  if (/\bcfo\b|finance|financial|budget|forecast|accounting/.test(haystack)) {
    return {
      own: 'finance, forecasting, budget, accounting, unit economics, and commercial analysis work',
      routeToThis: 'budget reviews, financial models, revenue analysis, cost controls, and finance blockers',
    };
  }

  if (/\bpm\b|product|program|project|operations|ops/.test(haystack)) {
    return {
      own: 'product coordination, project planning, operational follow-through, requirements, prioritization support, and delivery tracking',
      routeToThis: 'product requirements, project coordination, delivery planning, backlog grooming, and operational blockers',
    };
  }

  return {
    own: 'the work described by this role title and capabilities',
    routeToThis: 'tasks that match this role title, capabilities, team, routing keywords, or ownership notes',
  };
}

export async function ensureProfileHomes({
  profileSlug,
  hermesDataRoot = '/data/hermes',
  gbrainDataRoot = '/data/gbrain',
  templateDir = DEFAULT_TEMPLATE_DIR,
  configSourcePath,
  initGbrain = true,
}) {
  assertSafeSlug(profileSlug);

  const hermesHome = profileSlug === 'default'
    ? hermesDataRoot
    : join(hermesDataRoot, 'profiles', profileSlug);
  const gbrainHome = join(gbrainDataRoot, profileSlug);

  await mkdir(hermesHome, { recursive: true });
  await mkdir(gbrainHome, { recursive: true });
  await ensureHermesSubdirs(hermesHome);

  if (profileSlug !== 'default') {
    await cloneDefaultHermesProfile({ hermesDataRoot, hermesHome });
    await cloneDefaultGbrainTemplate({ gbrainDataRoot, gbrainHome });
  }

  // Always (re)install bundled Hermes skills so existing broken profiles self-heal.
  await installBundledHermesSkills(hermesHome);

  await copyFirstExistingIfMissing(
    [
      configSourcePath,
      profileSlug === 'default' ? undefined : join(hermesDataRoot, 'config.yaml'),
      join(templateDir, 'config.yaml'),
    ],
    join(hermesHome, 'config.yaml'),
  );

  await copyFirstExistingIfMissing(
    [
      join(templateDir, `SOUL.${profileSlug}.md`),
      join(templateDir, 'SOUL.default.md'),
    ],
    join(hermesHome, 'SOUL.md'),
  );

  await copyFirstExistingIfMissing(
    [
      join(templateDir, DELEGATION_PROTOCOL_FILE),
      join(hermesDataRoot, DELEGATION_PROTOCOL_FILE),
    ],
    join(hermesHome, DELEGATION_PROTOCOL_FILE),
  );

  await copyFirstExistingIfMissing(
    [
      join(templateDir, LEARNING_PROTOCOL_FILE),
      join(hermesDataRoot, LEARNING_PROTOCOL_FILE),
    ],
    join(hermesHome, LEARNING_PROTOCOL_FILE),
  );

  await copyIfSourceExists(join(hermesDataRoot, '.env'), join(hermesHome, '.env'));
  await writeProviderEnvFile(join(hermesHome, '.env'));

  if (initGbrain && !(await exists(join(gbrainHome, '.gbrain', 'config.json')))) {
    await runCommand('gbrain', ['init', '--pglite'], { GBRAIN_HOME: gbrainHome });
    await runCommand('gbrain', ['config', 'set', 'search.mode', 'conservative'], {
      GBRAIN_HOME: gbrainHome,
    }, { allowFailure: true });
  }

  return {
    hermesHome,
    gbrainHome,
    modelConfig: await readHermesModelConfig(join(hermesHome, 'config.yaml')),
  };
}

export async function retireProfileHomes({
  profileSlug,
  hermesDataRoot = '/data/hermes',
  gbrainDataRoot = '/data/gbrain',
  deleteMode = 'archive',
}) {
  assertSafeSlug(profileSlug);
  if (profileSlug === 'default' || deleteMode === 'ignore') return;

  const hermesHome = join(hermesDataRoot, 'profiles', profileSlug);
  const gbrainHome = join(gbrainDataRoot, profileSlug);

  if (deleteMode === 'purge') {
    await rm(hermesHome, { recursive: true, force: true });
    await rm(gbrainHome, { recursive: true, force: true });
    return;
  }

  if (deleteMode !== 'archive') {
    throw new Error(`Invalid PROFILE_SYNC_DELETE_MODE: ${deleteMode}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await moveIfExists(hermesHome, join(hermesDataRoot, 'archive', `${profileSlug}-${stamp}`));
  await moveIfExists(gbrainHome, join(gbrainDataRoot, 'archive', `${profileSlug}-${stamp}`));
}

export async function reconcileAgents({
  companies,
  listAgents,
  listCompanySkills,
  patchAgent,
  patchAgentPermissions,
  ensureHomes = ensureProfileHomes,
  retireHomes = retireProfileHomes,
  writeOrgMirror = writeOrgMirrorFiles,
  manifest = emptyManifest(),
  deleteMode = 'archive',
  paperclipAgentServerUrl = DEFAULT_AGENT_API_URL,
  hermesDataRoot = '/data/hermes',
  gbrainDataRoot = '/data/gbrain',
  templateDir = DEFAULT_TEMPLATE_DIR,
  orgMirrorRoot = DEFAULT_ORG_MIRROR_ROOT,
  initGbrain = true,
  grantManagerAssignTasks = true,
  hermesModelMode = HERMES_MODEL_MODE_INHERIT,
}) {
  const normalizedHermesModelMode = normalizeHermesModelMode(hermesModelMode);
  const now = new Date().toISOString();
  const previous = Array.isArray(manifest.managedAgents) ? manifest.managedAgents : [];
  const previousByAgent = new Map(previous.map((entry) => [entry.agentId, entry]));
  const previousPermissioned = Array.isArray(manifest.permissionedAgents) ? manifest.permissionedAgents : [];
  const previousPermissionedByAgent = new Map(previousPermissioned.map((entry) => [entry.agentId, entry]));
  const scannedCompanies = new Set();
  const activeAgentIds = new Set();
  const nextEntries = [];
  const nextPermissionedEntries = [];
  const orgCompanies = [];
  let patched = 0;
  let capabilityPatched = 0;
  let permissioned = 0;
  let revoked = 0;
  let provisioned = 0;

  for (const company of companies) {
    scannedCompanies.add(company.id);
    const agents = await listAgents(company.id);
    const companyName = company.name || company.shortName || company.id;
    const activeAgents = agents.filter((agent) => !isRetiredAgent(agent));
    const directReportCounts = countDirectReports(activeAgents);
    const listedSkills = typeof listCompanySkills === 'function'
      ? await listCompanySkills(company.id)
      : undefined;
    const desiredSkills = Array.isArray(listedSkills) ? normalizeSkillKeys(listedSkills) : undefined;
    const orgAgents = [];

    for (let agent of agents) {
      const managedAgent = shouldManageAgent(agent);
      const retiredAgent = isRetiredAgent(agent);
      const previousEntry = previousByAgent.get(agent.id);
      const existingSlug = previousEntry?.profileSlug
        || agent.metadata?.agentStackProfileSlug
        || agent.metadata?.hermesProfile;

      const profileSlug = managedAgent && !retiredAgent
        ? desiredProfileSlug(companyName, agent.name, existingSlug)
        : existingSlug;
      const capabilityContext = {
        companyName,
        directReportCount: directReportCounts.get(agent.id) || 0,
      };

      const qualifiesForManagerAssign = shouldGrantManagerAssignment(agent, capabilityContext);
      const wasPreviouslyPermissioned = previousPermissionedByAgent.has(agent.id);

      if (
        grantManagerAssignTasks
        && !retiredAgent
        && qualifiesForManagerAssign
        && patchAgentPermissions
      ) {
        const permissionsPayload = managerAssignmentPermissions(agent);
        const permissionsResult = await patchAgentPermissions(agent.id, permissionsPayload);
        agent = mergeAgentPatch(agent, permissionsResult);
        permissioned += 1;
        nextPermissionedEntries.push({
          companyId: company.id,
          agentId: agent.id,
          grantedAt: previousPermissionedByAgent.get(agent.id)?.grantedAt || now,
          lastSeenAt: now,
        });
      } else if (
        grantManagerAssignTasks
        && !retiredAgent
        && !isManagerAssignRolePassthrough(agent)
        && wasPreviouslyPermissioned
        && !qualifiesForManagerAssign
        && patchAgentPermissions
      ) {
        // Agent was granted canAssignTasks in a prior cycle but no longer
        // qualifies (lost direct reports, role change, etc.). Revoke so the
        // template's "managers only" rule stays enforced. Only triggers for
        // agents we tracked in the manifest — historical grants from before
        // this tracking shipped are left alone (cleaning them up is a manual
        // one-shot, not the steady-state reconcile's job).
        const permissionsPayload = revokeManagerAssignmentPermissions(agent);
        const permissionsResult = await patchAgentPermissions(agent.id, permissionsPayload);
        agent = mergeAgentPatch(agent, permissionsResult);
        revoked += 1;
      }

      if (!retiredAgent && !managedAgent) {
        const discoveryCapabilities = withCapabilityDiscovery(agent.capabilities, agent, capabilityContext);
        if (discoveryCapabilities !== normalizedCapabilityText(agent.capabilities)) {
          const capabilityResult = await patchAgent(agent.id, { capabilities: discoveryCapabilities });
          agent = mergeAgentPatch(agent, capabilityResult);
          capabilityPatched += 1;
          patched += 1;
        }
      }

      if (managedAgent && !retiredAgent) {
        const homes = await ensureHomes({
          profileSlug,
          hermesDataRoot,
          gbrainDataRoot,
          templateDir,
          initGbrain,
        });
        provisioned += 1;

        const payload = buildManagedAgentPayload({
          agent: {
            ...agent,
            metadata: {
              ...(agent.metadata || {}),
              agentStackProfileSlug: profileSlug,
            },
          },
          companyName,
          paperclipAgentServerUrl,
          hermesDataRoot,
          gbrainDataRoot,
          hermesModelConfig: homes.modelConfig,
          hermesModelMode: normalizedHermesModelMode,
          capabilityContext,
          desiredSkills,
        });
        const managedResult = await patchAgent(agent.id, payload);
        agent = mergeAgentPatch(agent, managedResult || payload);
        patched += 1;

        activeAgentIds.add(agent.id);
        nextEntries.push({
          companyId: company.id,
          companyName,
          agentId: agent.id,
          agentName: agent.name,
          profileSlug,
          hermesHome: homes.hermesHome || payload.metadata.agentStackHermesHome,
          gbrainHome: homes.gbrainHome || payload.metadata.agentStackGbrainHome,
          createdAt: previousEntry?.createdAt || now,
          lastSeenAt: now,
        });
      }

      if (!retiredAgent) {
        orgAgents.push(normalizeOrgAgent(agent, { profileSlug, directReportCount: capabilityContext.directReportCount }));
      }
    }

    orgCompanies.push(compactObject({
      id: company.id,
      name: companyName,
      shortName: company.shortName,
      agents: orgAgents,
    }));
  }

  let retired = 0;
  for (const entry of previous) {
    if (!scannedCompanies.has(entry.companyId) || activeAgentIds.has(entry.agentId)) continue;
    if (deleteMode === 'ignore') {
      nextEntries.push(entry);
      continue;
    }

    await retireHomes({
      ...entry,
      hermesDataRoot,
      gbrainDataRoot,
      deleteMode,
    });
    retired += 1;
  }

  await writeOrgMirror({
    root: orgMirrorRoot,
    generatedAt: now,
    companies: orgCompanies,
  });

  return {
    patched,
    capabilityPatched,
    permissioned,
    revoked,
    provisioned,
    retired,
    manifest: {
      version: 1,
      updatedAt: now,
      managedAgents: nextEntries,
      permissionedAgents: nextPermissionedEntries,
    },
  };
}

export async function writeOrgMirrorFiles({
  root = DEFAULT_ORG_MIRROR_ROOT,
  generatedAt = new Date().toISOString(),
  companies,
}) {
  await mkdir(root, { recursive: true });
  const normalized = {
    version: 1,
    generatedAt,
    source: 'paperclip',
    companies,
  };

  await atomicWriteFile(join(root, 'org-chart.json'), `${JSON.stringify(normalized, null, 2)}\n`);
  await atomicWriteFile(join(root, 'org-chart.md'), renderOrgChartMarkdown(normalized));
}

async function atomicWriteFile(destination, content) {
  await mkdir(dirname(destination), { recursive: true });
  const tmpPath = `${destination}.tmp`;
  await writeFile(tmpPath, content);
  await rename(tmpPath, destination);
}

function normalizeOrgAgent(agent, { profileSlug, directReportCount = 0 } = {}) {
  const metadata = agent.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
  return compactObject({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    title: agent.title,
    adapterType: agent.adapterType,
    profileSlug,
    directReports: directReportCount > 0 ? directReportCount : undefined,
    team: firstNonEmpty(agent.team, agent.department, metadata.team, metadata.department),
    reportsTo: firstNonEmpty(
      agent.reportsTo,
      agent.reportsToAgentId,
      agent.managerAgentId,
      agent.managerId,
      metadata.reportsTo,
      metadata.reportsToAgentId,
      metadata.managerAgentId,
      metadata.managerId,
    ),
    owns: normalizeStringList(firstNonEmpty(agent.owns, agent.ownerOf, metadata.owns, metadata.ownerOf)),
    routingKeywords: normalizeStringList(firstNonEmpty(
      agent.routingKeywords,
      agent.keywords,
      metadata.routingKeywords,
      metadata.keywords,
    )),
    permissions: normalizePermissions(agent.permissions),
    access: normalizeAccess(agent.access),
    capabilities: agent.capabilities,
  });
}

export function countDirectReports(agents) {
  const activeIds = new Set(agents.map((agent) => agent.id).filter(Boolean));
  const counts = new Map();

  for (const agent of agents) {
    const reportsTo = agentReportsTo(agent);
    if (!reportsTo || !activeIds.has(reportsTo)) continue;
    counts.set(reportsTo, (counts.get(reportsTo) || 0) + 1);
  }

  return counts;
}

function agentReportsTo(agent) {
  const metadata = agent?.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
  return firstNonEmpty(
    agent?.reportsTo,
    agent?.reportsToAgentId,
    agent?.managerAgentId,
    agent?.managerId,
    metadata.reportsTo,
    metadata.reportsToAgentId,
    metadata.managerAgentId,
    metadata.managerId,
  );
}

function shouldGrantManagerAssignment(agent, context) {
  return Boolean(
    agent?.id
    && !isManagerAssignRolePassthrough(agent)
    && Number(context?.directReportCount || 0) > 0,
  );
}

// CEOs (and any future role that Paperclip exposes via its built-in
// `taskAssignSource: ceo_role` derivation) get `canAssignTasks` from
// role-based permission system, not from the explicit-grant table. Issuing
// our own explicit-grant patch on top is a no-op on effective behavior but
// pollutes the manifest and the `grants` array. Skip them in both the grant
// and revoke paths so this mechanism only manages explicit grants for
// non-role-derived managers.
function isManagerAssignRolePassthrough(agent) {
  return String(agent?.role || '').toLowerCase() === 'ceo';
}

function managerAssignmentPermissions(agent) {
  return {
    canCreateAgents: Boolean(agent?.permissions?.canCreateAgents),
    canAssignTasks: true,
  };
}

export function revokeManagerAssignmentPermissions(agent) {
  // Preserve canCreateAgents — only revoke canAssignTasks. Mirrors the grant
  // payload shape so the API merges cleanly.
  return {
    canCreateAgents: Boolean(agent?.permissions?.canCreateAgents),
    canAssignTasks: false,
  };
}

function mergeAgentPatch(agent, patch) {
  if (!patch || typeof patch !== 'object') return agent;
  return {
    ...agent,
    ...patch,
    metadata: {
      ...(agent.metadata || {}),
      ...(patch.metadata || {}),
    },
    adapterConfig: {
      ...(agent.adapterConfig || {}),
      ...(patch.adapterConfig || {}),
    },
  };
}

function normalizePermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') return undefined;
  return compactObject({
    canCreateAgents: typeof permissions.canCreateAgents === 'boolean' ? permissions.canCreateAgents : undefined,
  });
}

function normalizeAccess(access) {
  if (!access || typeof access !== 'object') return undefined;
  return compactObject({
    canAssignTasks: typeof access.canAssignTasks === 'boolean' ? access.canAssignTasks : undefined,
    taskAssignSource: access.taskAssignSource,
  });
}

function renderOrgChartMarkdown(orgChart) {
  const lines = [
    '# Paperclip Org Chart',
    '',
    `Generated: ${orgChart.generatedAt}`,
    '',
    'Paperclip is the source of truth for these companies and roles. Use this file with the Delegation Protocol when routing or handing off work.',
    '',
  ];

  for (const company of orgChart.companies) {
    lines.push(`## ${company.name}${company.id ? ` (${company.id})` : ''}`, '');

    if (!company.agents?.length) {
      lines.push('- No active agents found.', '');
      continue;
    }

    for (const agent of company.agents) {
      const label = [agent.name, agent.title].filter(Boolean).join(' - ');
      lines.push(`- ${label}`);
      appendMarkdownDetail(lines, 'id', agent.id);
      appendMarkdownDetail(lines, 'role', agent.role);
      appendMarkdownDetail(lines, 'adapter', agent.adapterType);
      appendMarkdownDetail(lines, 'profile', agent.profileSlug);
      appendMarkdownDetail(lines, 'direct reports', agent.directReports);
      appendMarkdownDetail(lines, 'team', agent.team);
      appendMarkdownDetail(lines, 'reports to', agent.reportsTo);
      appendMarkdownDetail(lines, 'can assign tasks', agent.access?.canAssignTasks);
      appendMarkdownDetail(lines, 'task assign source', agent.access?.taskAssignSource);
      appendMarkdownDetail(lines, 'can create agents', agent.permissions?.canCreateAgents);
      appendMarkdownDetail(lines, 'owns', agent.owns?.join(', '));
      appendMarkdownDetail(lines, 'routing keywords', agent.routingKeywords?.join(', '));
      appendMarkdownDetail(lines, 'capabilities', agent.capabilities);
    }

    lines.push('');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function appendMarkdownDetail(lines, label, value) {
  if (value === undefined || value === null || value === '') return;
  lines.push(`  - ${label}: ${String(value).replace(/\s+/g, ' ').trim()}`);
}

function firstNonEmpty(...values) {
  return values.find((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

function normalizeSkillKeys(skills) {
  return [...new Set(skills
    .map((skill) => {
      if (typeof skill === 'string') return skill;
      if (!skill || typeof skill !== 'object') return '';
      return firstNonEmpty(skill.key, skill.slug, skill.name, skill.id) || '';
    })
    .map((skill) => String(skill).trim())
    .filter(Boolean))];
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }),
  );
}

export async function readManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  try {
    return normalizeManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyManifest();
    throw error;
  }
}

export async function writeManifest(manifest, manifestPath = DEFAULT_MANIFEST_PATH) {
  await mkdir(dirname(manifestPath), { recursive: true });
  const tmpPath = `${manifestPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`);
  await rename(tmpPath, manifestPath);
}

function shouldManageAgent(agent) {
  return agent?.adapterType === 'hermes_local'
    || agent?.metadata?.managedBy === MANAGED_BY
    || Boolean(agent?.metadata?.agentStackProfileSlug);
}

export function isRetiredAgent(agent) {
  if (agent?.terminatedAt || agent?.deletedAt || agent?.archivedAt || agent?.deactivatedAt) return true;

  const states = [
    agent?.status,
    agent?.state,
    agent?.lifecycleStatus,
    agent?.employmentStatus,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return states.some((state) => ['terminated', 'deleted', 'archived', 'deactivated'].includes(state));
}

function normalizeManifest(manifest) {
  return {
    version: 1,
    updatedAt: manifest?.updatedAt || null,
    managedAgents: Array.isArray(manifest?.managedAgents) ? manifest.managedAgents : [],
    permissionedAgents: Array.isArray(manifest?.permissionedAgents) ? manifest.permissionedAgents : [],
  };
}

function emptyManifest() {
  return { version: 1, updatedAt: null, managedAgents: [], permissionedAgents: [] };
}

function slugPart(value) {
  const slug = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return slug || 'unnamed';
}

function isSafeSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{0,127}$/.test(slug);
}

function assertSafeSlug(slug) {
  if (!isSafeSlug(slug)) {
    throw new Error(`Unsafe profile slug: ${slug}`);
  }
}

function withoutApiSuffix(url) {
  return url.replace(/\/+$/, '').replace(/\/api$/, '');
}

function withApiSuffix(url) {
  return `${withoutApiSuffix(url)}/api`;
}

async function readHermesModelConfig(configPath) {
  try {
    return parseHermesModelConfig(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseHermesModelConfig(content) {
  const result = {};
  const lines = content.split('\n');
  let inModelSection = false;
  let modelSectionIndent = 0;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;

    if (/^model:\s*$/.test(trimmed) && indent === 0) {
      inModelSection = true;
      modelSectionIndent = indent;
      continue;
    }

    if (inModelSection && indent <= modelSectionIndent && trimmed && !trimmed.startsWith('#')) {
      inModelSection = false;
    }

    if (!inModelSection) continue;

    const match = trimmed.match(/^\s*(provider|default)\s*:\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2].trim().replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
    if (!value) continue;
    if (key === 'provider') result.provider = value;
    if (key === 'default') result.model = value;
  }

  return result.model || result.provider ? result : null;
}

async function firstExisting(paths) {
  for (const path of paths.filter(Boolean)) {
    if (await exists(path)) return path;
  }
  throw new Error(`None of these source files exist: ${paths.filter(Boolean).join(', ')}`);
}

async function copyFirstExistingIfMissing(paths, destination) {
  if (await exists(destination)) return;
  const source = await firstExisting(paths);
  await cp(source, destination, { force: false });
}

async function cloneDefaultHermesProfile({ hermesDataRoot, hermesHome }) {
  if (!(await exists(hermesDataRoot))) return;

  await copyTreeMissing(hermesDataRoot, hermesHome, (relativePath) => {
    const firstSegment = pathSegments(relativePath)[0];
    if (!firstSegment) return false;
    if (HERMES_TEMPLATE_SKIP_DIRS.has(firstSegment)) return true;
    return isHermesRuntimeTemplateFile(relativePath);
  });
}

function isHermesRuntimeTemplateFile(relativePath) {
  const segments = pathSegments(relativePath);
  const fileName = segments[segments.length - 1] || '';
  return HERMES_TEMPLATE_SKIP_FILES.has(fileName)
    || HERMES_SQLITE_SIDECARE_RE.test(fileName)
    || fileName.endsWith('.lock')
    || fileName.endsWith('.log');
}

async function cloneDefaultGbrainTemplate({ gbrainDataRoot, gbrainHome }) {
  const defaultGbrainHome = join(gbrainDataRoot, 'default');
  if (defaultGbrainHome === gbrainHome || !(await exists(defaultGbrainHome))) return;

  for (const relativePath of GBRAIN_TEMPLATE_PATHS) {
    await copyTreeMissing(
      join(defaultGbrainHome, ...relativePath.split('/')),
      join(gbrainHome, ...relativePath.split('/')),
      () => false,
    );
  }
}

async function installBundledHermesSkills(hermesHome) {
  const src = process.env.HERMES_BUNDLED_SKILLS_SOURCE || '/usr/local/lib/hermes-agent/skills';
  if (!(await exists(src))) return;

  const skillsDir = join(hermesHome, 'skills');
  await mkdir(skillsDir, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const linkPath = join(skillsDir, entry.name);
    try {
      const st = await lstat(linkPath);
      if (!st.isSymbolicLink()) continue; // user-modified or Hermes-installed; leave alone
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    try { await rm(linkPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await symlink(join(src, entry.name), linkPath);
  }
}

async function copyTreeMissing(source, destination, shouldSkip, relativePath = '') {
  let stats;
  try {
    stats = await lstat(source);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  if (relativePath && shouldSkip(relativePath, stats)) return;

  if (stats.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const childRelativePath = relativePath ? join(relativePath, entry.name) : entry.name;
      await copyTreeMissing(
        join(source, entry.name),
        join(destination, entry.name),
        shouldSkip,
        childRelativePath,
      );
    }
    return;
  }

  if (await exists(destination)) return;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: false, preserveTimestamps: true });
}

function pathSegments(path) {
  return path.split(/[\\/]/).filter(Boolean);
}

async function copyIfSourceExists(source, destination) {
  if (source === destination || (await exists(destination)) || !(await exists(source))) return;
  await cp(source, destination, { force: false });
  await chmod(destination, 0o600);
}

async function writeProviderEnvFile(envPath) {
  if (await exists(envPath)) return;

  const lines = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']
    .map((key) => [key, process.env[key]?.trim()])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`);

  if (lines.length === 0) return;
  await writeFile(envPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  await chmod(envPath, 0o600);
}

async function moveIfExists(fromPath, toPath) {
  if (!(await exists(fromPath))) return;
  await mkdir(dirname(toPath), { recursive: true });
  await rename(fromPath, toPath);
}

async function ensureHermesSubdirs(hermesHome) {
  // Idempotent: every profile-sync iteration re-asserts the dir tree + perms,
  // so a half-created profile or a stray chmod gets healed on the next pass.
  await chmod(hermesHome, 0o700);
  for (const relative of HERMES_WELL_KNOWN_SUBDIRS) {
    const target = join(hermesHome, relative);
    await mkdir(target, { recursive: true });
    await chmod(target, 0o700);
  }
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args, env, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
  });

  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });

  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} exited with ${code}`);
  }
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

function envInt(key, fallback) {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseConfiguredCompanies(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [id, ...nameParts] = item.split(':');
      const name = nameParts.join(':').trim();
      return { id: id.trim(), name: name || id.trim() };
    });
}

function extractArray(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.companies)) return response.companies;
  if (Array.isArray(response?.agents)) return response.agents;
  if (Array.isArray(response?.skills)) return response.skills;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

async function makeApiClient({ apiBase, apiKey }) {
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
      throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
    }
    if (response.status === 204) return null;
    return await response.json();
  };
}

async function resolveCompanies({ api, companyIds, configuredCompanies }) {
  if (configuredCompanies.length > 0) return configuredCompanies;

  if (companyIds.length > 0) {
    return await Promise.all(companyIds.map(async (id) => {
      const company = await api('GET', `/api/companies/${id}`);
      return {
        id: company.id || id,
        name: company.name || company.shortName || company.slug || id,
        shortName: company.shortName || company.slug,
      };
    }));
  }

  return extractArray(await api('GET', '/api/companies')).map((company) => ({
    id: company.id,
    name: company.name || company.shortName || company.slug || company.id,
    shortName: company.shortName || company.slug,
  })).filter((company) => company.id);
}

async function runOnceFromEnv() {
  const apiKey = envValue('PAPERCLIP_PROFILE_SYNC_API_KEY') || envValue('PAPERCLIP_API_KEY');
  if (!apiKey) {
    throw new Error('PAPERCLIP_PROFILE_SYNC_API_KEY or PAPERCLIP_API_KEY is required when profile sync is enabled');
  }

  const api = await makeApiClient({
    apiBase: envValue('PAPERCLIP_API_BASE', DEFAULT_SYNC_API_BASE),
    apiKey,
  });
  const configuredCompanies = parseConfiguredCompanies(envValue('PAPERCLIP_COMPANIES'));
  const companyIds = (envValue('PAPERCLIP_COMPANY_IDS') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const companies = await resolveCompanies({ api, companyIds, configuredCompanies });
  const manifestPath = envValue('PROFILE_SYNC_MANIFEST_PATH', DEFAULT_MANIFEST_PATH);
  const manifest = await readManifest(manifestPath);

  const result = await reconcileAgents({
    companies,
    listAgents: async (companyId) => extractArray(await api('GET', `/api/companies/${companyId}/agents`)),
    listCompanySkills: async (companyId) => {
      try {
        return extractArray(await api('GET', `/api/companies/${companyId}/skills`));
      } catch (error) {
        if (String(error?.message || '').includes(`GET /api/companies/${companyId}/skills failed with 404:`)) {
          console.warn(`Company skills endpoint is unavailable for ${companyId}; leaving desired skill sync unchanged`);
          return undefined;
        }
        throw error;
      }
    },
    patchAgent: async (agentId, payload) => await api('PATCH', `/api/agents/${agentId}`, payload),
    patchAgentPermissions: async (agentId, payload) => await api('PATCH', `/api/agents/${agentId}/permissions`, payload),
    manifest,
    deleteMode: envValue('PROFILE_SYNC_DELETE_MODE', 'archive'),
    paperclipAgentServerUrl: envValue('PAPERCLIP_AGENT_API_URL', DEFAULT_AGENT_API_URL),
    hermesDataRoot: envValue('HERMES_DATA_ROOT', '/data/hermes'),
    gbrainDataRoot: envValue('GBRAIN_DATA_ROOT', '/data/gbrain'),
    templateDir: envValue('PROFILE_SYNC_TEMPLATE_DIR', DEFAULT_TEMPLATE_DIR),
    orgMirrorRoot: envValue('ORG_MIRROR_ROOT', DEFAULT_ORG_MIRROR_ROOT),
    initGbrain: !envBool('PROFILE_SYNC_SKIP_GBRAIN_INIT', false),
    grantManagerAssignTasks: envBool('PROFILE_SYNC_GRANT_MANAGER_ASSIGN_TASKS', true),
    hermesModelMode: envValue('PROFILE_SYNC_HERMES_MODEL_MODE', HERMES_MODEL_MODE_INHERIT),
  });

  await writeManifest(result.manifest, manifestPath);
  console.log(JSON.stringify({
    companies: companies.length,
    provisioned: result.provisioned,
    patched: result.patched,
    capabilityPatched: result.capabilityPatched,
    permissioned: result.permissioned,
    revoked: result.revoked,
    retired: result.retired,
    managedAgents: result.manifest.managedAgents.length,
    permissionedAgents: result.manifest.permissionedAgents.length,
  }));
}

async function sleep(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function idleWhenDisabled() {
  console.log('profile-sync disabled; set PROFILE_SYNC_ENABLED=1 to enable');
  await new Promise(() => {});
}

async function main() {
  const command = process.argv[2] || 'once';
  const enabled = envBool('PROFILE_SYNC_ENABLED', false);

  if (!enabled) {
    if (command === 'loop') return await idleWhenDisabled();
    console.log('profile-sync disabled; set PROFILE_SYNC_ENABLED=1 to run');
    return;
  }

  if (command === 'once') {
    await runOnceFromEnv();
    return;
  }

  if (command !== 'loop') {
    throw new Error(`Unknown profile-sync command: ${command}`);
  }

  const intervalMs = envInt('PROFILE_SYNC_INTERVAL_SEC', 60) * 1000;
  for (;;) {
    try {
      await runOnceFromEnv();
    } catch (error) {
      console.error(error.stack || error.message);
    }
    await sleep(intervalMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
