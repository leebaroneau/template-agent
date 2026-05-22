import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('seeds the Hermes agent with model and provider from Hermes config', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'paperclip-seed-'));
  const configPath = join(tempDir, 'config.yaml');
  await writeFile(configPath, [
    'model:',
    '  provider: openai-codex',
    '  base_url: https://chatgpt.com/backend-api/codex',
    '  default: gpt-5.5',
    '',
  ].join('\n'));

  let capturedPayload;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/companies/company-1/agents') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
      return;
    }

    if (req.method === 'POST' && req.url === '/api/companies/company-1/agents') {
      let body = '';
      for await (const chunk of req) body += chunk;
      capturedPayload = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'agent-1',
        name: capturedPayload.name,
        adapterType: capturedPayload.adapterType,
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const scriptPath = fileURLToPath(new URL('./seed-agents.mjs', import.meta.url));
    const result = await runNode(scriptPath, {
      env: {
        ...process.env,
        PAPERCLIP_API_BASE: `http://127.0.0.1:${port}`,
        PAPERCLIP_API_KEY: 'test-api-key',
        PAPERCLIP_COMPANY_ID: 'company-1',
        HERMES_CONFIG_PATH: configPath,
        HERMES_MODEL: '',
        HERMES_PROVIDER: '',
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(capturedPayload.adapterConfig.model, 'gpt-5.5');
    assert.equal(capturedPayload.adapterConfig.provider, 'openai-codex');
    assert.equal(capturedPayload.adapterConfig.toolsets, 'terminal,file,web,mcp');
    assert.equal(capturedPayload.adapterConfig.paperclipApiUrl, 'http://127.0.0.1:3100/api');
    assert.equal(capturedPayload.adapterConfig.env.PAPERCLIP_API_URL, 'http://127.0.0.1:3100');
    assert.match(capturedPayload.capabilities, /Delegation Protocol/);
    assert.match(capturedPayload.capabilities, /\/data\/agent-stack\/delegation-protocol\.md/);
    assert.match(capturedPayload.capabilities, /Org Chart/);
    assert.match(capturedPayload.capabilities, /\/data\/agent-stack\/org-chart\.md/);
    assert.match(capturedPayload.capabilities, /Learning Protocol/);
    assert.match(capturedPayload.capabilities, /\/data\/agent-stack\/learning-protocol\.md/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function runNode(scriptPath, options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], options);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
