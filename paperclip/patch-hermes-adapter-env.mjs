#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const LEGACY_HERMES_EXECUTE_PATH =
  '/usr/local/lib/node_modules/paperclipai/node_modules/hermes-paperclip-adapter/dist/server/execute.js';

const DEFAULT_RESOLVE_ANCHORS = [
  '/opt/paperclip-src/server/src/index.ts',
  '/opt/paperclip-src/server/dist/index.js',
  '/usr/local/lib/node_modules/paperclipai/dist/index.js',
  '/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/dist/index.js',
];

export function resolveHermesAdapterServerFile(fileName, options = {}) {
  const candidates = options.candidates ?? [
    LEGACY_HERMES_EXECUTE_PATH,
    `/opt/paperclip-src/server/node_modules/hermes-paperclip-adapter/dist/server/${fileName}`,
  ];
  const anchors = options.anchors ?? DEFAULT_RESOLVE_ANCHORS;
  const checked = [];

  for (const candidate of candidates) {
    checked.push(candidate);
    if (existsSync(candidate)) return candidate;
  }

  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor);
      const serverIndexPath = require.resolve('hermes-paperclip-adapter/server');
      const candidate = join(dirname(serverIndexPath), fileName);
      checked.push(candidate);
      if (existsSync(candidate)) return candidate;
    } catch {
      checked.push(`${anchor} -> hermes-paperclip-adapter/server`);
    }
  }

  throw new Error(
    `[agent-stack] Could not locate hermes-paperclip-adapter dist/server/${fileName}. Checked: ${checked.join(', ')}`,
  );
}

export function patchHermesAdapterExecuteSource(source) {
  let patched = source;
  let changed = false;

  const originalEnvHandling = `    const userEnv = config.env;
    if (userEnv && typeof userEnv === "object") {
        Object.assign(env, userEnv);
    }`;

  const replacementEnvHandling = `    const userEnv = config.env;
    if (userEnv && typeof userEnv === "object") {
        // agent-stack unwrap Paperclip env wrappers
        for (const [key, value] of Object.entries(userEnv)) {
            if (typeof value === "string") {
                env[key] = value;
            }
            else if (value && typeof value === "object" && typeof value.value === "string") {
                env[key] = value.value;
            }
        }
    }`;

  if (!patched.includes('// agent-stack unwrap Paperclip env wrappers')) {
    const next = patched.replace(originalEnvHandling, replacementEnvHandling);
    if (next !== patched) {
      patched = next;
      changed = true;
    }
  }

  const originalLegacySessionRegex =
    'const SESSION_ID_REGEX_LEGACY = /session[_ ](?:id|saved)[:\\s]+([a-zA-Z0-9_-]+)/i;';
  const replacementLegacySessionRegex =
    'const SESSION_ID_REGEX_LEGACY = /session[_ ](?:id|saved)[:=]\\s*([a-zA-Z0-9_-]+)/i;';
  if (patched.includes(originalLegacySessionRegex)) {
    patched = patched.replace(originalLegacySessionRegex, replacementLegacySessionRegex);
    changed = true;
  }

  const helper = `function isHermesSessionId(value) {
    return typeof value === "string" && /^\\d{8}_\\d{6}_[a-zA-Z0-9_-]+$/.test(value);
}
`;
  const staleSessionHelper = `function shouldRetryWithoutResume(result) {
    if (!result || result.exitCode === 0) {
        return false;
    }
    const output = \`\${result.stdout || ""}\\n\${result.stderr || ""}\`;
    return /Session not found:/i.test(output) || /database disk image is malformed/i.test(output);
}
`;

  const originalPreviousSession = `    const prevSessionId = cfgString(ctx.runtime?.sessionParams?.sessionId);
    if (persistSession && prevSessionId) {
        args.push("--resume", prevSessionId);
    }`;
  const replacementPreviousSession = `    const prevSessionIdCandidate = cfgString(ctx.runtime?.sessionParams?.sessionId);
    const prevSessionId = isHermesSessionId(prevSessionIdCandidate) ? prevSessionIdCandidate : "";
    if (persistSession && prevSessionId) {
        args.push("--resume", prevSessionId);
    }`;
  if (patched.includes(originalPreviousSession)) {
    if (!patched.includes('function isHermesSessionId(value)')) {
      const helperAnchor = 'const COST_REGEX = /(?:cost|spent)[:\\s]*\\$?([\\d.]+)/i;\n';
      if (patched.includes(helperAnchor)) {
        patched = patched.replace(helperAnchor, `${helperAnchor}${helper}`);
      } else {
        patched = `${helper}${patched}`;
      }
    }
    patched = patched.replace(originalPreviousSession, replacementPreviousSession);
    changed = true;
  }

  const originalPersistSession = `    if (persistSession && parsed.sessionId) {
        executionResult.sessionParams = { sessionId: parsed.sessionId };
        executionResult.sessionDisplayId = parsed.sessionId.slice(0, 16);
    }`;
  const replacementPersistSession = `    if (persistSession && parsed.sessionId && isHermesSessionId(parsed.sessionId)) {
        executionResult.sessionParams = { sessionId: parsed.sessionId };
        executionResult.sessionDisplayId = parsed.sessionId.slice(0, 16);
    }`;
  if (patched.includes(originalPersistSession)) {
    if (!patched.includes('function isHermesSessionId(value)')) {
      const helperAnchor = 'const COST_REGEX = /(?:cost|spent)[:\\s]*\\$?([\\d.]+)/i;\n';
      if (patched.includes(helperAnchor)) {
        patched = patched.replace(helperAnchor, `${helperAnchor}${helper}`);
      } else {
        patched = `${helper}${patched}`;
      }
    }
    patched = patched.replace(originalPersistSession, replacementPersistSession);
    changed = true;
  }

  const originalRunChildProcess = `    const result = await runChildProcess(ctx.runId, hermesCmd, args, {
        cwd,
        env,
        timeoutSec,
        graceSec,
        onLog: wrappedOnLog,
    });
    // ── Parse output ───────────────────────────────────────────────────────`;
  const replacementRunChildProcess = `    let result = await runChildProcess(ctx.runId, hermesCmd, args, {
        cwd,
        env,
        timeoutSec,
        graceSec,
        onLog: wrappedOnLog,
    });
    if (prevSessionId && shouldRetryWithoutResume(result)) {
        await ctx.onLog("stdout", \`[paperclip] Saved Hermes session \${prevSessionId} could not be resumed; retrying without --resume.\\n\`);
        const retryArgs = args.slice();
        const resumeIndex = retryArgs.indexOf("--resume");
        if (resumeIndex >= 0) {
            retryArgs.splice(resumeIndex, 2);
        }
        result = await runChildProcess(ctx.runId, hermesCmd, retryArgs, {
            cwd,
            env,
            timeoutSec,
            graceSec,
            onLog: wrappedOnLog,
        });
    }
    // ── Parse output ───────────────────────────────────────────────────────`;
  if (patched.includes(originalRunChildProcess)) {
    if (!patched.includes('function shouldRetryWithoutResume(result)')) {
      const helperAnchor = 'const COST_REGEX = /(?:cost|spent)[:\\s]*\\$?([\\d.]+)/i;\n';
      if (patched.includes(helperAnchor)) {
        patched = patched.replace(helperAnchor, `${helperAnchor}${staleSessionHelper}`);
      } else {
        patched = `${staleSessionHelper}${patched}`;
      }
    }
    patched = patched.replace(originalRunChildProcess, replacementRunChildProcess);
    changed = true;
  }

  if (!changed) {
    return source;
  }

  return patched;
}

export async function patchHermesAdapterExecuteFile(
  filePath = process.env.HERMES_ADAPTER_EXECUTE_PATH || resolveHermesAdapterServerFile('execute.js'),
) {
  const source = await readFile(filePath, 'utf8');
  const patched = patchHermesAdapterExecuteSource(source);
  if (patched === source) {
    console.log('[agent-stack] Hermes adapter env patch already applied');
    return { changed: false, filePath };
  }

  await writeFile(filePath, patched);
  console.log('[agent-stack] Applied Hermes adapter env patch');
  return { changed: true, filePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await patchHermesAdapterExecuteFile();
}
