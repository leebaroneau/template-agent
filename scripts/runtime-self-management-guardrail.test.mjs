import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function file(path) {
  return readFile(join(repoRoot, path), 'utf8');
}

test('delegation-protocol carries the Runtime Self-Management Boundaries section', async () => {
  const md = await file('paperclip/delegation-protocol.md');

  assert.match(md, /## 7\. Runtime Self-Management Boundaries/);
  assert.match(md, /hermes gateway restart\|stop\|run\|install/);
  assert.match(md, /systemctl restart hermes-gateway-\*/);
  assert.match(md, /Fix the YAML and restart\.`/);
  assert.match(md, /I can't restart my own gateway/);
});

test('SOUL.default.md carries the Runtime Self-Management Boundaries block', async () => {
  const md = await file('hermes-runtime/templates/SOUL.default.md');

  assert.match(md, /## Runtime Self-Management Boundaries/);
  assert.match(md, /hermes gateway restart\|stop\|run\|install/);
  assert.match(md, /Fix the YAML and restart\.`/);
  assert.match(md, /I can't restart my own gateway/);
});

test('SOUL.default.md tells the agent the delegation-protocol section 7 binds them', async () => {
  // This is the link that makes the guardrail propagate to every Paperclip-
  // managed role SOUL (which already reads delegation-protocol.md).
  const md = await file('hermes-runtime/templates/SOUL.default.md');
  assert.match(md, /delegation-protocol\.md/);
  assert.match(md, /section 7|Runtime Self-Management/);
});
