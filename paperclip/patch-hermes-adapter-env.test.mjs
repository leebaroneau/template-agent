import test from 'node:test';
import assert from 'node:assert/strict';

import { patchHermesAdapterExecuteSource } from './patch-hermes-adapter-env.mjs';

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
