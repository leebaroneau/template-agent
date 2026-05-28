import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCoolifyPreviewEnv } from './coolify-preview-env.mjs';

test('buildCoolifyPreviewEnv adopts Coolify PR URL and hostname', () => {
  const updates = buildCoolifyPreviewEnv({
    SERVICE_NAME_PAPERCLIP: 'paperclip-pr-17',
    SERVICE_URL_PAPERCLIP: 'http://paperclip-pr-17.example.com',
    SERVICE_FQDN_PAPERCLIP: 'paperclip-pr-17.example.com',
    PAPERCLIP_PUBLIC_URL: 'http://paperclip.example.com',
    PAPERCLIP_AUTH_PUBLIC_BASE_URL: 'http://paperclip.example.com',
    BETTER_AUTH_URL: 'http://paperclip.example.com',
    BETTER_AUTH_BASE_URL: 'http://paperclip.example.com',
    PAPERCLIP_ALLOWED_HOSTNAMES: 'paperclip.example.com,localhost,127.0.0.1',
  });

  assert.deepEqual(updates, {
    PAPERCLIP_PUBLIC_URL: 'http://paperclip-pr-17.example.com',
    PAPERCLIP_AUTH_PUBLIC_BASE_URL: 'http://paperclip-pr-17.example.com',
    BETTER_AUTH_URL: 'http://paperclip-pr-17.example.com',
    BETTER_AUTH_BASE_URL: 'http://paperclip-pr-17.example.com',
    PAPERCLIP_ALLOWED_HOSTNAMES: 'paperclip.example.com,localhost,127.0.0.1,paperclip-pr-17.example.com',
  });
});

test('buildCoolifyPreviewEnv leaves production deploys unchanged', () => {
  const updates = buildCoolifyPreviewEnv({
    SERVICE_NAME_PAPERCLIP: 'paperclip',
    SERVICE_URL_PAPERCLIP: 'http://paperclip.example.com',
    SERVICE_FQDN_PAPERCLIP: 'paperclip.example.com',
    PAPERCLIP_PUBLIC_URL: 'http://paperclip.example.com',
    PAPERCLIP_ALLOWED_HOSTNAMES: 'paperclip.example.com,localhost,127.0.0.1',
  });

  assert.deepEqual(updates, {});
});

test('buildCoolifyPreviewEnv detects quoted Coolify pull request branch', () => {
  const updates = buildCoolifyPreviewEnv({
    COOLIFY_BRANCH: '"pull/17/head"',
    SERVICE_URL_PAPERCLIP: 'http://paperclip-pr-17.example.com',
    SERVICE_FQDN_PAPERCLIP: 'paperclip-pr-17.example.com',
    PAPERCLIP_ALLOWED_HOSTNAMES: 'paperclip.example.com',
  });

  assert.equal(updates.PAPERCLIP_PUBLIC_URL, 'http://paperclip-pr-17.example.com');
  assert.equal(updates.PAPERCLIP_ALLOWED_HOSTNAMES, 'paperclip.example.com,paperclip-pr-17.example.com');
});

test('buildCoolifyPreviewEnv strips quotes from Coolify URL and FQDN values', () => {
  const updates = buildCoolifyPreviewEnv({
    SERVICE_NAME_PAPERCLIP: 'paperclip-pr-17',
    SERVICE_URL_PAPERCLIP: '"http://paperclip-pr-17.example.com"',
    SERVICE_FQDN_PAPERCLIP: '"paperclip-pr-17.example.com"',
    PAPERCLIP_ALLOWED_HOSTNAMES: 'paperclip.example.com',
  });

  assert.equal(updates.PAPERCLIP_PUBLIC_URL, 'http://paperclip-pr-17.example.com');
  assert.equal(updates.PAPERCLIP_ALLOWED_HOSTNAMES, 'paperclip.example.com,paperclip-pr-17.example.com');
});
