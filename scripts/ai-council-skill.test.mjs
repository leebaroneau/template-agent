import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function file(path) {
  return readFile(join(repoRoot, path), 'utf8');
}

test('ai-council skill has valid frontmatter and no moa dependency', async () => {
  const md = await file('hermes-runtime/skills/ai-council/SKILL.md');

  assert.match(md, /^---\n/);
  assert.match(md, /\nname: ai-council\n/);
  assert.match(md, /\ndescription: Use when a Hermes profile receives/);
  assert.match(md, /\n---\n\n# AI Council/);
  assert.match(md, /Claude Haiku/);
  assert.match(md, /references\/protocol\.md/);
  assert.doesNotMatch(md, /mixture_of_agents/);
});

test('ai-council protocol defines cost and latency gates', async () => {
  const md = await file('hermes-runtime/skills/ai-council/references/protocol.md');

  assert.match(md, /Do not use `moa` or `mixture_of_agents`/);
  assert.match(md, /Latency Tiers/);
  assert.match(md, /\| none \|/);
  assert.match(md, /\| fast \|/);
  assert.match(md, /\| lite \|/);
  assert.match(md, /\| full \|/);
  assert.match(md, /Opus at the beginning/);
  assert.match(md, /Opus at the end/);
  assert.match(md, /Claude Haiku/);
  assert.match(md, /Do not guess a DeepSeek model slug/);
});

test('delegation protocol teaches managed profiles when to use ai-council', async () => {
  const md = await file('paperclip/delegation-protocol.md');

  assert.match(md, /## 7\. Cognitive Expansion Engine/);
  assert.match(md, /Use the `ai-council` skill/);
  assert.match(md, /Do not use Hermes `moa`/);
  assert.match(md, /## 8\. Runtime Self-Management Boundaries/);
});
