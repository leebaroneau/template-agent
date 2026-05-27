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
        `stage_snapshot_file "${source}" "${snapshot}" "hermes-profiles.tar.gz"`,
        `test ! -e "${snapshot}/hermes-profiles.tar.gz"`,
        `cat "${snapshot}"/hermes-profiles.tar.gz.part-* > "${rejoined}"`,
      ].join('\n')]);

      const parts = (await readdir(snapshot)).filter((name) => name.startsWith('hermes-profiles.tar.gz.part-')).sort();
      assert.deepEqual(parts, [
        'hermes-profiles.tar.gz.part-0000',
        'hermes-profiles.tar.gz.part-0001',
        'hermes-profiles.tar.gz.part-0002',
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

test('paperclip/pre-deploy-backup.sh exits cleanly after a successful mocked backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-state-main-'));
  const bin = join(root, 'bin');
  const workdir = join(root, 'repo');
  const scriptPath = resolve('paperclip/pre-deploy-backup.sh');

  try {
    await execFileAsync('mkdir', ['-p', bin]);
    await writeFile(join(bin, 'paperclipai'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'dir=""',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --dir) dir="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'mkdir -p "$dir"',
      'printf db > "$dir/paperclip-test.sql.gz"',
    ].join('\n'));
    await writeFile(join(bin, 'tar'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "${1:-}" == "czf" ]]; then',
      '  printf archive > "$2"',
      'fi',
    ].join('\n'));
    await writeFile(join(bin, 'git'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'for arg in "$@"; do',
      '  if [[ "$arg" == "clone" ]]; then',
      '    mkdir -p "${@: -1}"',
      '    exit 0',
      '  fi',
      '  if [[ "$arg" == "diff" ]]; then',
      '    exit 1',
      '  fi',
      'done',
      'exit 0',
    ].join('\n'));
    await execFileAsync('chmod', ['+x', join(bin, 'paperclipai'), join(bin, 'tar'), join(bin, 'git')]);

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_STATE_REPO: 'Example/agent-example',
      AGENT_STATE_BRAND: 'example',
      AGENT_STATE_TOKEN: 'dummy',
      AGENT_STATE_WORKDIR: workdir,
    };

    const result = await execFileAsync('bash', [scriptPath], { env });
    assert.match(result.stderr, /Done\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
