import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { repairPaperclipConfigFile } from './repair-paperclip-config.mjs';

test('repairPaperclipConfigFile normalizes invalid metadata source and writes a backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paperclip-config-'));
  const configPath = join(dir, 'config.json');
  const config = {
    $meta: {
      version: 1,
      updatedAt: '2026-05-20T06:05:38.202Z',
      source: 'manual-cleanup',
    },
    database: { mode: 'embedded-postgres' },
  };

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = await repairPaperclipConfigFile({
      configPath,
      now: () => new Date('2026-05-20T06:09:14.320Z'),
    });

    assert.equal(result.changed, true);
    assert.equal(result.backupPath, `${configPath}.pre-agent-stack-config-repair`);
    assert.deepEqual(JSON.parse(await readFile(result.backupPath, 'utf8')), config);

    const repaired = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(repaired.$meta.source, 'configure');
    assert.equal(repaired.$meta.updatedAt, '2026-05-20T06:09:14.320Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('repairPaperclipConfigFile leaves valid config metadata unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paperclip-config-'));
  const configPath = join(dir, 'config.json');
  const config = {
    $meta: {
      version: 1,
      updatedAt: '2026-05-20T06:05:38.202Z',
      source: 'configure',
    },
  };

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = await repairPaperclipConfigFile({ configPath });

    assert.equal(result.changed, false);
    await assert.rejects(stat(`${configPath}.pre-agent-stack-config-repair`), { code: 'ENOENT' });
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
