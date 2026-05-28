import { pathToFileURL } from 'node:url';

const PAPERCLIP_URL_KEYS = [
  'PAPERCLIP_PUBLIC_URL',
  'PAPERCLIP_AUTH_PUBLIC_BASE_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_BASE_URL',
];

export function buildCoolifyPreviewEnv(env = process.env) {
  if (!isCoolifyPreview(env)) return {};

  const publicUrl = normalizePublicUrl(env.SERVICE_URL_PAPERCLIP);
  if (!publicUrl) return {};

  const allowedHostnames = mergeAllowedHostnames(
    env.PAPERCLIP_ALLOWED_HOSTNAMES,
    collectPreviewHostnames(env, publicUrl),
  );

  return {
    PAPERCLIP_PUBLIC_URL: publicUrl,
    PAPERCLIP_AUTH_PUBLIC_BASE_URL: publicUrl,
    BETTER_AUTH_URL: publicUrl,
    BETTER_AUTH_BASE_URL: publicUrl,
    PAPERCLIP_ALLOWED_HOSTNAMES: allowedHostnames,
  };
}

export function formatShellExports(updates) {
  return Object.entries(updates)
    .filter(([key]) => PAPERCLIP_URL_KEYS.includes(key) || key === 'PAPERCLIP_ALLOWED_HOSTNAMES')
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n');
}

function isCoolifyPreview(env) {
  const serviceName = unquote(env.SERVICE_NAME_PAPERCLIP);
  const branch = unquote(env.COOLIFY_BRANCH);

  return (
    /(?:^|-)pr-\d+(?:$|-)/.test(serviceName) ||
    /^pull\/\d+\/head$/.test(branch) ||
    isNonZero(env.COOLIFY_PULL_REQUEST_ID)
  );
}

function isNonZero(value) {
  return Boolean(value && value !== '0' && value !== 'false');
}

function normalizePublicUrl(value) {
  const raw = unquote(value);
  if (!raw) return '';

  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  url.hash = '';
  url.search = '';

  return url.toString().replace(/\/$/, '');
}

function collectPreviewHostnames(env, publicUrl) {
  const hostnames = new Set();
  addHostname(hostnames, publicUrl);
  addHostname(hostnames, env.SERVICE_FQDN_PAPERCLIP);
  return [...hostnames];
}

function mergeAllowedHostnames(existingValue, hostnames) {
  const merged = new Set(splitCsv(existingValue));

  for (const hostname of hostnames) {
    if (hostname) merged.add(hostname);
  }

  return [...merged].join(',');
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function addHostname(hostnames, value) {
  const raw = unquote(value);
  if (!raw) return;

  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (url.hostname) hostnames.add(url.hostname);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function unquote(value) {
  return String(value || '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const updates = buildCoolifyPreviewEnv(process.env);
  const output = formatShellExports(updates);

  if (output) {
    console.error(`[agent-stack] Coolify PR preview detected; using ${updates.PAPERCLIP_PUBLIC_URL}`);
    console.log(output);
  }
}
