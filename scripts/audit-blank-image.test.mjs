import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts/audit-blank-image.sh');

async function withFakeDocker(mode, fn) {
  const tempDir = await mkdtemp(join(tmpdir(), 'blank-image-audit-'));
  const dockerPath = join(tempDir, 'docker');
  await writeFile(
    dockerPath,
    `#!/usr/bin/env bash
set -euo pipefail

mode="\${FAKE_DOCKER_MODE:-clean}"
cmd="\${1:-}"
subcmd="\${2:-}"

if [[ "$cmd $subcmd" == "image inspect" ]]; then
  echo '[{"Config":{"Env":["PAPERCLIP_HOME=/data","HERMES_HOME=/data/hermes"]}}]'
  exit 0
fi

if [[ "$cmd $subcmd" == "history --no-trunc" ]]; then
  if [[ "$mode" == "history" ]]; then
    echo 'RUN |19 COOLIFY_FQDN=paperclip.leebarone.dev HERMES_BRIDGE_TOKEN=super-secret'
  else
    echo 'RUN mkdir -p /data /opt/work'
  fi
  exit 0
fi

if [[ "$cmd" == "run" ]]; then
  if [[ "$mode" == "data" ]]; then
    echo '/data/instances/default'
    echo '/data/hermes/profiles/client-agent'
  fi
  exit 0
fi

echo "unexpected fake docker call: $*" >&2
exit 64
`,
  );
  await chmod(dockerPath, 0o755);

  try {
    return await fn({
      ...process.env,
      FAKE_DOCKER_MODE: mode,
      PATH: `${tempDir}:${process.env.PATH}`,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runAudit(mode) {
  try {
    const result = await withFakeDocker(mode, (env) =>
      execFileAsync(scriptPath, ['template-agent:test'], { env }),
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

test('passes when the image has empty /data and neutral metadata', async () => {
  const result = await runAudit('clean');

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Blank image audit passed/);
});

test('fails when image metadata contains live deployment values', async () => {
  const result = await runAudit('history');

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Forbidden image metadata/);
  assert.match(result.stderr, /paperclip\.leebarone\.dev/);
});

test('fails when /data contains runtime state', async () => {
  const result = await runAudit('data');

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Runtime data found/);
  assert.match(result.stderr, /\/data\/instances\/default/);
});
