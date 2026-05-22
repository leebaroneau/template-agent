import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

const scripts = [
  'paperclip/pre-deploy-backup.sh',
  'scripts/host/nightly-backup.sh',
];

for (const script of scripts) {
  test(`${script} splits oversized snapshot archives into restorable parts`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-state-split-'));
    const source = join(root, 'source.bin');
    const snapshot = join(root, 'snapshot');
    const rejoined = join(root, 'rejoined.bin');
    const scriptPath = resolve(script);

    try {
      await writeFile(source, Buffer.alloc(2500, 7));
      await execFileAsync('bash', ['-lc', [
        'set -euo pipefail',
        `export AGENT_STATE_TEST_SOURCE_ONLY=1`,
        `source "${scriptPath}"`,
        `export AGENT_STATE_ARCHIVE_SPLIT_BYTES=1024`,
        `mkdir -p "${snapshot}"`,
        `stage_snapshot_file "${source}" "${snapshot}" "gbrain.tar.gz"`,
        `test ! -e "${snapshot}/gbrain.tar.gz"`,
        `cat "${snapshot}"/gbrain.tar.gz.part-* > "${rejoined}"`,
      ].join('\n')]);

      const parts = (await readdir(snapshot)).filter((name) => name.startsWith('gbrain.tar.gz.part-')).sort();
      assert.deepEqual(parts, [
        'gbrain.tar.gz.part-0000',
        'gbrain.tar.gz.part-0001',
        'gbrain.tar.gz.part-0002',
      ]);
      assert.equal((await stat(join(snapshot, parts[0]))).size, 1024);
      assert.equal((await stat(join(snapshot, parts[1]))).size, 1024);
      assert.equal((await stat(join(snapshot, parts[2]))).size, 452);
      assert.deepEqual(await readFile(rejoined), Buffer.alloc(2500, 7));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test(`${script} keeps small snapshot archives as a single file`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-state-small-'));
    const source = join(root, 'source.bin');
    const snapshot = join(root, 'snapshot');
    const scriptPath = resolve(script);

    try {
      await writeFile(source, Buffer.alloc(10, 3));
      await execFileAsync('bash', ['-lc', [
        'set -euo pipefail',
        `export AGENT_STATE_TEST_SOURCE_ONLY=1`,
        `source "${scriptPath}"`,
        `export AGENT_STATE_ARCHIVE_SPLIT_BYTES=1024`,
        `mkdir -p "${snapshot}"`,
        `stage_snapshot_file "${source}" "${snapshot}" "paperclip-db.sql.gz"`,
      ].join('\n')]);

      const files = await readdir(snapshot);
      assert.deepEqual(files, ['paperclip-db.sql.gz']);
      assert.deepEqual(await readFile(join(snapshot, 'paperclip-db.sql.gz')), Buffer.alloc(10, 3));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
