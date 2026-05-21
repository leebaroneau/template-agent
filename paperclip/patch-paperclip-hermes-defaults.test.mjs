import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatShellExports,
  parseHermesModelConfig,
  patchAgentsRouteSource,
} from './patch-paperclip-hermes-defaults.mjs';

test('parseHermesModelConfig reads default model provider from Hermes config', () => {
  const config = `
model:
  default: gpt-5.5
  provider: openai-codex
`;

  assert.deepEqual(parseHermesModelConfig(config), {
    model: 'gpt-5.5',
    provider: 'openai-codex',
  });
});

test('formatShellExports preserves explicit env and emits safe exports', () => {
  const output = formatShellExports({
    config: { model: 'gpt-5.5', provider: 'openai-codex' },
    env: { HERMES_MODEL: 'existing-model' },
  });

  assert.match(output, /export HERMES_MODEL='existing-model'/);
  assert.match(output, /export HERMES_PROVIDER='openai-codex'/);
});

test('patchAgentsRouteSource adds hermes_local creation defaults', () => {
  const source = `
    function applyCreateDefaultsByAdapterType(adapterType, adapterConfig) {
        const next = { ...adapterConfig };
        if (adapterType === "codex_local") {
            if (!asNonEmptyString(next.model)) {
                next.model = DEFAULT_CODEX_LOCAL_MODEL;
            }
            return ensureGatewayDeviceKey(adapterType, next);
        }
        if (adapterType === "gemini_local" && !asNonEmptyString(next.model)) {
            next.model = DEFAULT_GEMINI_LOCAL_MODEL;
            return ensureGatewayDeviceKey(adapterType, next);
        }
        return ensureGatewayDeviceKey(adapterType, next);
    }
`;

  const patched = patchAgentsRouteSource(source);

  assert.match(patched, /adapterType === "hermes_local"/);
  assert.match(patched, /Object\.prototype\.hasOwnProperty\.call\(next, "model"\)/);
  assert.match(patched, /Object\.prototype\.hasOwnProperty\.call\(next, "provider"\)/);
  assert.match(patched, /process\.env\.HERMES_MODEL/);
  assert.match(patched, /process\.env\.HERMES_PROVIDER/);
});

test('patchAgentsRouteSource is idempotent', () => {
  const source = `
    function applyCreateDefaultsByAdapterType(adapterType, adapterConfig) {
        const next = { ...adapterConfig };
        if (adapterType === "hermes_local") {
            const hasModel = Object.prototype.hasOwnProperty.call(next, "model");
            const hasProvider = Object.prototype.hasOwnProperty.call(next, "provider");
            if (!hasModel && asNonEmptyString(process.env.HERMES_MODEL)) {
                next.model = process.env.HERMES_MODEL;
            }
            if (!hasProvider && asNonEmptyString(process.env.HERMES_PROVIDER)) {
                next.provider = process.env.HERMES_PROVIDER;
            }
            return ensureGatewayDeviceKey(adapterType, next);
        }
        return ensureGatewayDeviceKey(adapterType, next);
    }
`;

  assert.equal(patchAgentsRouteSource(source), source);
});

test('patchAgentsRouteSource upgrades the older Hermes defaults patch', () => {
  const source = `
    function applyCreateDefaultsByAdapterType(adapterType, adapterConfig) {
        const next = { ...adapterConfig };
        // agent-stack Hermes defaults
        if (adapterType === "hermes_local") {
            if (!asNonEmptyString(next.model) && asNonEmptyString(process.env.HERMES_MODEL)) {
                next.model = process.env.HERMES_MODEL;
            }
            if (!asNonEmptyString(next.provider) && asNonEmptyString(process.env.HERMES_PROVIDER)) {
                next.provider = process.env.HERMES_PROVIDER;
            }
            return ensureGatewayDeviceKey(adapterType, next);
        }
        return ensureGatewayDeviceKey(adapterType, next);
    }
`;

  const patched = patchAgentsRouteSource(source);

  assert.match(patched, /Object\.prototype\.hasOwnProperty\.call\(next, "model"\)/);
  assert.doesNotMatch(patched, /!asNonEmptyString\\(next\\.model\\) && asNonEmptyString\\(process\\.env\\.HERMES_MODEL\\)/);
});
