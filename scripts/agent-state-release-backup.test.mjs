import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('release backup helper writes a manifest with checksums and metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-state-manifest-'));
  const manifest = join(root, 'manifest.json');
  const db = join(root, 'paperclip-db.sql.gz');
  const profiles = join(root, 'hermes-profiles.tar.gz');
  const helperPath = resolve('paperclip/lib/release-backup.sh');

  try {
    await writeFile(db, 'db-dump');
    await writeFile(profiles, 'profile-archive');

    await execFileAsync('bash', ['-lc', [
      'set -euo pipefail',
      `source "${helperPath}"`,
      'release_backup_write_manifest \\',
      `  "${manifest}" \\`,
      '  "predeploy" \\',
      '  "predeploy-20260623T010203Z" \\',
      '  "2026-06-23T01:02:03Z" \\',
      '  "example" \\',
      '  "Example/agent-example" \\',
      '  "pre-deploy" \\',
      '  "sha-abc123" \\',
      `  "${db}" \\`,
      `  "${profiles}"`,
    ].join('\n')]);

    const json = JSON.parse(await readFile(manifest, 'utf8'));
    assert.equal(json.schema_version, 1);
    assert.deepEqual(json.metadata, {
      kind: 'predeploy',
      tag: 'predeploy-20260623T010203Z',
      created_at: '2026-06-23T01:02:03Z',
      brand: 'example',
      repository: 'Example/agent-example',
      source: 'pre-deploy',
      commit: 'sha-abc123',
    });
    assert.deepEqual(json.files.map((file) => file.name), [
      'paperclip-db.sql.gz',
      'hermes-profiles.tar.gz',
    ]);
    assert.deepEqual(json.files.map((file) => file.size), [7, 15]);
    assert.match(json.files[0].sha256, /^[0-9a-f]{64}$/);
    assert.match(json.files[1].sha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release backup helper creates a release when the tag is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-state-release-'));
  const bin = join(root, 'bin');
  const calls = join(root, 'curl-calls.log');
  const helperPath = resolve('paperclip/lib/release-backup.sh');

  try {
    await execFileAsync('mkdir', ['-p', bin]);
    await writeFile(join(bin, 'curl'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'method=GET',
      'out=',
      'url=',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    -X) method="$2"; shift 2 ;;',
      '    -o) out="$2"; shift 2 ;;',
      '    --data-binary) shift 2 ;;',
      '    -H|-w) shift 2 ;;',
      '    -s|-S|-L|-f) shift ;;',
      '    http*) url="$1"; shift ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'printf "%s %s\\n" "$method" "$url" >> "$CURL_CALLS"',
      'case "$method $url" in',
      '  "GET https://api.github.test/repos/Example/agent-example/releases/tags/predeploy-20260623T010203Z")',
      '    printf "%s" "{\\"message\\":\\"Not Found\\"}" > "$out"',
      '    printf "404"',
      '    ;;',
      '  "POST https://api.github.test/repos/Example/agent-example/releases")',
      '    printf "%s" "{\\"id\\":77,\\"tag_name\\":\\"predeploy-20260623T010203Z\\"}" > "$out"',
      '    printf "201"',
      '    ;;',
      '  *)',
      '    printf "%s" "{\\"message\\":\\"unexpected\\"}" > "$out"',
      '    printf "500"',
      '    ;;',
      'esac',
    ].join('\n'));
    await execFileAsync('chmod', ['+x', join(bin, 'curl')]);

    const { stdout } = await execFileAsync('bash', ['-c', [
      'set -euo pipefail',
      `source "${helperPath}"`,
      'release_backup_create_or_reuse_release \\',
      '  "Example/agent-example" \\',
      '  "token" \\',
      '  "predeploy-20260623T010203Z" \\',
      '  "Pre-deploy snapshot 20260623T010203Z" \\',
      '  "body"',
    ].join('\n')], {
      env: {
        ...process.env,
        CURL_CALLS: calls,
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_BACKUP_API_BASE: 'https://api.github.test',
      },
    });

    assert.equal(stdout.trim(), '77');
    assert.deepEqual((await readFile(calls, 'utf8')).trim().split('\n'), [
      'GET https://api.github.test/repos/Example/agent-example/releases/tags/predeploy-20260623T010203Z',
      'POST https://api.github.test/repos/Example/agent-example/releases',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pre-deploy backup no-ops when no state repo is configured', async () => {
  const scriptPath = resolve('paperclip/pre-deploy-backup.sh');
  const result = await execFileAsync('bash', [scriptPath], {
    env: {
      PATH: process.env.PATH,
    },
  });

  assert.match(result.stderr, /AGENT_STATE_REPO is unset/);
});

test('pre-deploy backup fails clearly when only a deploy key is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-state-key-only-'));
  const keyFile = join(root, 'agent-state-deploy');
  const scriptPath = resolve('paperclip/pre-deploy-backup.sh');

  try {
    await writeFile(keyFile, 'private-key');

    await assert.rejects(
      execFileAsync('bash', [scriptPath], {
        env: {
          ...process.env,
          AGENT_STATE_REPO: 'Example/agent-example',
          AGENT_STATE_BRAND: 'example',
          AGENT_STATE_KEY_FILE: keyFile,
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /AGENT_STATE_TOKEN/);
        assert.match(error.stderr, /Release assets/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('host nightly backup fails clearly when only an SSH key is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-state-host-key-only-'));
  const keyFile = join(root, 'agent-state-deploy');
  const scriptPath = resolve('scripts/host/nightly-backup.sh');

  try {
    await writeFile(keyFile, 'private-key');

    await assert.rejects(
      execFileAsync('bash', [scriptPath], {
        env: {
          ...process.env,
          AGENT_STATE_ENV_FILE: join(root, 'missing.env'),
          AGENT_STATE_REPO: 'Example/agent-example',
          AGENT_STATE_BRAND: 'example',
          AGENT_STATE_COMPOSE_FILTER: 'coolify-app',
          AGENT_STATE_KEY: keyFile,
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(`${error.stdout}\n${error.stderr}`, /AGENT_STATE_TOKEN/);
        assert.match(`${error.stdout}\n${error.stderr}`, /Release assets/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restore backup refuses to run without --force', async () => {
  const scriptPath = resolve('paperclip/restore-backup.sh');

  await assert.rejects(
    execFileAsync('bash', [scriptPath, '--tag', 'nightly-20260623T010203Z'], {
      env: {
        ...process.env,
        AGENT_STATE_REPO: 'Example/agent-example',
        AGENT_STATE_TOKEN: 'token',
      },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /--force/);
      assert.match(error.stderr, /overwrite live state/);
      return true;
    },
  );
});
