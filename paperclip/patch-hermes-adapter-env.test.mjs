import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  patchHermesAdapterExecuteSource,
  resolveHermesAdapterServerFile,
} from './patch-hermes-adapter-env.mjs';

async function createFakeHermesAdapterPackage() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paperclip-hermes-adapter-'));
  const packageRoot = path.join(root, 'server', 'node_modules', 'hermes-paperclip-adapter');
  const serverDir = path.join(packageRoot, 'dist', 'server');
  await mkdir(serverDir, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'hermes-paperclip-adapter',
      type: 'module',
      exports: {
        './server': './dist/server/index.js',
      },
    }),
  );
  await writeFile(path.join(serverDir, 'index.js'), 'export {};\n');
  await writeFile(path.join(serverDir, 'execute.js'), 'export {};\n');
  return {
    anchor: path.join(root, 'server', 'src', 'index.ts'),
    executePath: await realpath(path.join(serverDir, 'execute.js')),
  };
}

test('patchHermesAdapterExecuteSource unwraps Paperclip env value objects', () => {
  const source = `
    const userEnv = config.env;
    if (userEnv && typeof userEnv === "object") {
        Object.assign(env, userEnv);
    }
`;

  const patched = patchHermesAdapterExecuteSource(source);

  assert.match(patched, /Object\.entries\(userEnv\)/);
  assert.match(patched, /typeof value\.value === "string"/);
  assert.match(patched, /env\[key\] = value\.value/);
});

test('patchHermesAdapterExecuteSource avoids parsing session help text as a session id', () => {
  const source = `
const SESSION_ID_REGEX_LEGACY = /session[_ ](?:id|saved)[:\\s]+([a-zA-Z0-9_-]+)/i;
`;

  const patched = patchHermesAdapterExecuteSource(source);

  assert.doesNotMatch(patched, /\[:\\s\]\+/);
  assert.match(patched, /session\[_ \]\(\?:id\|saved\)\[:=\]/);
});

test('patchHermesAdapterExecuteSource ignores invalid previous session ids', () => {
  const source = `
    const prevSessionId = cfgString(ctx.runtime?.sessionParams?.sessionId);
    if (persistSession && prevSessionId) {
        args.push("--resume", prevSessionId);
    }
`;

  const patched = patchHermesAdapterExecuteSource(source);

  assert.match(patched, /isHermesSessionId\(prevSessionIdCandidate\)/);
  assert.match(patched, /const prevSessionId = isHermesSessionId\(prevSessionIdCandidate\) \? prevSessionIdCandidate : "";/);
});

test('patchHermesAdapterExecuteSource retries once without a stale Hermes session', () => {
  const source = `
    const result = await runChildProcess(ctx.runId, hermesCmd, args, {
        cwd,
        env,
        timeoutSec,
        graceSec,
        onLog: wrappedOnLog,
    });
    // ── Parse output ───────────────────────────────────────────────────────
`;

  const patched = patchHermesAdapterExecuteSource(source);

  assert.match(patched, /shouldRetryWithoutResume\(result\)/);
  assert.match(patched, /retryArgs\.splice\(resumeIndex, 2\)/);
  assert.match(patched, /retrying without --resume/);
});

test('patchHermesAdapterExecuteSource is idempotent', () => {
  const source = `
    const userEnv = config.env;
    if (userEnv && typeof userEnv === "object") {
        // agent-stack unwrap Paperclip env wrappers
        for (const [key, value] of Object.entries(userEnv)) {
            if (typeof value === "string") {
                env[key] = value;
            }
        }
    }
`;

  assert.equal(patchHermesAdapterExecuteSource(source), source);
});

test('resolveHermesAdapterServerFile resolves source workspace adapter installs', async () => {
  const fake = await createFakeHermesAdapterPackage();
  assert.equal(
    resolveHermesAdapterServerFile('execute.js', { anchors: [fake.anchor], candidates: [] }),
    fake.executePath,
  );
});
