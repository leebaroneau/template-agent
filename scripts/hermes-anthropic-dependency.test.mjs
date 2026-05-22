import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('image installs the Anthropic provider dependency for Claude-backed Hermes', async () => {
  const dockerfile = await readFile(new URL('../paperclip/Dockerfile', import.meta.url), 'utf8');

  assert.match(dockerfile, /anthropic>=0\.39\.0/);
});
