import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function writeCrontabStub(bin, store) {
  await mkdir(bin, { recursive: true });
  const crontab = join(bin, 'crontab');
  await writeFile(crontab, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'store="$CRONTAB_STORE"',
    'case "${1:-}" in',
    '  -l)',
    '    [[ -f "$store" ]] || exit 1',
    '    cat "$store"',
    '    ;;',
    '  -)',
    '    cat > "$store"',
    '    ;;',
    '  *)',
    '    exit 64',
    '    ;;',
    'esac',
  ].join('\n'));
  await execFileAsync('chmod', ['+x', crontab]);
}

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

test('host nightly installer writes env, refreshes scripts, removes legacy artifacts, and replaces cron idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-state-installer-'));
  const target = join(root, 'target');
  const bin = join(root, 'bin');
  const crontabStore = join(root, 'crontab');
  const scriptPath = resolve('scripts/host/install-nightly-backup.sh');

  try {
    await mkdir(join(target, 'repo'), { recursive: true });
    await writeFile(join(target, 'git-askpass.sh'), 'legacy');
    await writeFile(join(target, 'github-token'), 'token\n');
    await writeFile(crontabStore, [
      'MAILTO=""',
      `0 1 * * * ${target}/nightly-backup.sh >> /tmp/old.log 2>&1`,
      '15 2 * * * /usr/local/bin/other-job',
      '',
    ].join('\n'));
    await writeCrontabStub(bin, crontabStore);

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CRONTAB_STORE: crontabStore,
    };
    const args = [
      scriptPath,
      '--repo', 'Example/agent-example',
      '--brand', 'example',
      '--compose-filter', 'coolify-filter',
      '--retention-days', '14',
      '--target-dir', target,
      '--cron-schedule', '5 4 * * *',
    ];

    await execFileAsync('bash', args, { env });
    await execFileAsync('bash', args, { env });

    assert.equal(await readFile(join(target, 'nightly-backup.sh'), 'utf8'), await readFile(resolve('scripts/host/nightly-backup.sh'), 'utf8'));
    assert.equal(await readFile(join(target, 'release-backup.sh'), 'utf8'), await readFile(resolve('paperclip/lib/release-backup.sh'), 'utf8'));
    assert.equal((await stat(join(target, 'nightly-backup.sh'))).mode & 0o777, 0o755);
    assert.equal((await stat(join(target, 'release-backup.sh'))).mode & 0o777, 0o755);
    assert.equal((await stat(join(target, 'github-token'))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(target, 'backup.env'), 'utf8'), [
      'AGENT_STATE_REPO=Example/agent-example',
      'AGENT_STATE_BRAND=example',
      `AGENT_STATE_TOKEN_FILE=${target}/github-token`,
      'AGENT_STATE_COMPOSE_FILTER=coolify-filter',
      'AGENT_STATE_RETENTION_DAYS=14',
      '',
    ].join('\n'));

    await assert.rejects(stat(join(target, 'repo')), { code: 'ENOENT' });
    await assert.rejects(stat(join(target, 'git-askpass.sh')), { code: 'ENOENT' });

    const crontab = await readFile(crontabStore, 'utf8');
    assert.match(crontab, /^MAILTO=""/m);
    assert.match(crontab, /^15 2 \* \* \* \/usr\/local\/bin\/other-job$/m);
    assert.equal(crontab.split(`${target}/nightly-backup.sh`).length - 1, 1);
    assert.match(
      crontab,
      new RegExp(`^5 4 \\* \\* \\* AGENT_STATE_ENV_FILE=${target}/backup\\.env ${target}/nightly-backup\\.sh >> /var/log/agent-state-backup\\.log 2>&1$`, 'm'),
    );
    assert.doesNotMatch(crontab, /\/tmp\/old\.log/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('host nightly installer verify runs copied nightly script with AGENT_STATE_ENV_FILE set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-state-installer-verify-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  const bin = join(root, 'bin');
  const crontabStore = join(root, 'crontab');
  const verifyCapture = join(root, 'verify-env-file');
  const scriptPath = resolve('scripts/host/install-nightly-backup.sh');

  try {
    await mkdir(join(source, 'scripts/host'), { recursive: true });
    await mkdir(join(source, 'paperclip/lib'), { recursive: true });
    await writeFile(join(source, 'scripts/host/nightly-backup.sh'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'printf "%s\\n" "$AGENT_STATE_ENV_FILE" > "$VERIFY_CAPTURE"',
    ].join('\n'));
    await writeFile(join(source, 'paperclip/lib/release-backup.sh'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
    ].join('\n'));
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'github-token'), 'token\n');
    await writeCrontabStub(bin, crontabStore);

    await execFileAsync('bash', [
      scriptPath,
      '--repo', 'Example/agent-example',
      '--brand', 'example',
      '--compose-filter', 'coolify-filter',
      '--source-dir', source,
      '--target-dir', target,
      '--verify',
    ], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CRONTAB_STORE: crontabStore,
        VERIFY_CAPTURE: verifyCapture,
      },
    });

    assert.equal((await readFile(verifyCapture, 'utf8')).trim(), join(target, 'backup.env'));
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
