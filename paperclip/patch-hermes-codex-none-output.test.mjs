import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const patchScript = join(repoRoot, 'paperclip/patch-hermes-codex-none-output.py');

const runAgentExcerpt = String.raw`
    def _run_codex_stream(self, api_kwargs: dict, client: Any = None, on_first_delta: callable = None):
        """Execute one streaming Responses API request and return the final response."""
        import httpx as _httpx

        active_client = client or self._ensure_primary_openai_client(reason="codex_stream_direct")
        max_stream_retries = 1
        has_tool_calls = False
        first_delta_fired = False
        self._codex_streamed_text_parts: list = []
        for attempt in range(max_stream_retries + 1):
            if self._interrupt_requested:
                raise InterruptedError("Agent interrupted before Codex stream retry")
            collected_output_items: list = []
            try:
                with active_client.responses.stream(**api_kwargs) as stream:
                    for event in stream:
                        event_type = getattr(event, "type", "")
                        if event_type == "response.output_item.done":
                            done_item = getattr(event, "item", None)
                            if done_item is not None:
                                collected_output_items.append(done_item)
                    final_response = stream.get_final_response()
                    _out = getattr(final_response, "output", None)
                    if isinstance(_out, list) and not _out:
                        if collected_output_items:
                            final_response.output = list(collected_output_items)
                            logger.debug(
                                "Codex stream: backfilled %d output items from stream events",
                                len(collected_output_items),
                            )
                        elif self._codex_streamed_text_parts and not has_tool_calls:
                            assembled = "".join(self._codex_streamed_text_parts)
                            final_response.output = [SimpleNamespace(
                                type="message",
                                role="assistant",
                                status="completed",
                                content=[SimpleNamespace(type="output_text", text=assembled)],
                            )]
                            logger.debug(
                                "Codex stream: synthesized output from %d text deltas (%d chars)",
                                len(self._codex_streamed_text_parts), len(assembled),
                            )
                    return final_response
            except (_httpx.RemoteProtocolError, _httpx.ReadTimeout, _httpx.ConnectError, ConnectionError) as exc:
                raise
`;

test('Hermes Codex none-output patch is applied idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'template-agent-codex-patch-'));
  try {
    const target = join(dir, 'run_agent.py');
    await writeFile(target, runAgentExcerpt);

    await execFileAsync('python3', [patchScript, target], { cwd: repoRoot });
    const patched = await readFile(target, 'utf8');

    assert.match(patched, /def _recover_collected_codex_output\(reason: str\):/);
    assert.match(patched, /SDK parser returned response\.output=None/);
    assert.match(patched, /not isinstance\(_out, list\) or not _out/);

    await execFileAsync('python3', [patchScript, target], { cwd: repoRoot });
    const patchedAgain = await readFile(target, 'utf8');
    assert.equal(patchedAgain, patched);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Dockerfile runs the Hermes Codex none-output patch during image build', async () => {
  const dockerfile = await readFile(join(repoRoot, 'paperclip/Dockerfile'), 'utf8');

  assert.match(dockerfile, /COPY paperclip\/patch-hermes-codex-none-output\.py/);
  assert.match(dockerfile, /patch-hermes-codex-none-output\.py "\$HERMES_SRC\/run_agent\.py"/);
});
