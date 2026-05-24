import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATCH = join(repoRoot, 'paperclip/patch-hermes-voice-mention-filter.py');

function findPython3() {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const PYTHON = findPython3();

function makeFakeTelegramPy(headShape = 'new') {
  // Minimal fake telegram.py with just enough shape for the patcher's anchors.
  const headNew = `
    async def _handle_media_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle incoming media messages, downloading images to local cache."""
        if not update.message:
            return
        if not self._should_process_message(update.message):
            return

        msg = update.message
        pass
`;
  const headOld = `
    async def _handle_media_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle incoming media messages, downloading images to local cache."""
        if not update.message:
            return
        if not self._should_process_message(update.message):
            return

        msg = update.message
        pass
`;
  const head = headShape === 'old' ? headOld : headNew;
  return `import asyncio
import logging
logger = logging.getLogger(__name__)
def cache_audio_from_bytes(b, ext='.ogg'): return '/tmp/x' + ext
class Message: pass
class ContextTypes:
    DEFAULT_TYPE = object
class Update:
    message: Message | None = None
class TelegramAdapter:
${head}
    def _is_guest_mention(self, message: Message) -> bool:
        return False
`;
}

test('patch script is a no-op when target file is missing', { skip: !PYTHON ? 'no python' : false }, () => {
  const r = spawnSync(PYTHON, [PATCH, '/this/does/not/exist'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `expected exit 0 on missing target, got ${r.status}: ${r.stderr}`);
});

test('patch script applies to a new-shape telegram.py and validates syntax', { skip: !PYTHON ? 'no python' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-patch-'));
  const target = join(dir, 'telegram.py');
  writeFileSync(target, makeFakeTelegramPy('new'));
  const r = spawnSync(PYTHON, [PATCH, target], { encoding: 'utf8' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  const out = readFileSync(target, 'utf8');
  assert.match(out, /_eager_transcribe_voice/);
  assert.match(out, /Voice accepted via transcript mention match/);
  // Patched file should still parse
  const ast = spawnSync(PYTHON, ['-c', `import ast; ast.parse(open('${target}').read())`], { encoding: 'utf8' });
  assert.equal(ast.status, 0, `post-patch parse failed: ${ast.stderr}`);
});

test('patch script is idempotent (second run is a no-op)', { skip: !PYTHON ? 'no python' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-patch-'));
  const target = join(dir, 'telegram.py');
  writeFileSync(target, makeFakeTelegramPy('new'));
  spawnSync(PYTHON, [PATCH, target]);
  const after1 = readFileSync(target, 'utf8');
  const r2 = spawnSync(PYTHON, [PATCH, target], { encoding: 'utf8' });
  assert.equal(r2.status, 0);
  const after2 = readFileSync(target, 'utf8');
  assert.equal(after1, after2, 'second run modified the file');
  assert.match(r2.stdout, /already applied/);
});

test('patch script refuses to patch a file missing the _is_guest_mention anchor', { skip: !PYTHON ? 'no python' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-patch-'));
  const target = join(dir, 'telegram.py');
  writeFileSync(target, 'print("not hermes telegram.py")\n');
  const r = spawnSync(PYTHON, [PATCH, target], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'expected non-zero exit on missing anchor');
  assert.match(r.stderr, /anchor.*_is_guest_mention/);
});
