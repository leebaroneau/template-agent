#!/usr/bin/env python3
"""Patch Hermes Codex streaming recovery until upstream carries the fix.

This is intentionally deployment-neutral: it patches the bundled Hermes source
inside the template image and does not reference any company, profile, or model.
"""

from __future__ import annotations

import argparse
from pathlib import Path


PATCH_MARKER = "SDK parser returned response.output=None"

HELPER_NEEDLE = """            collected_output_items: list = []
            try:
"""

HELPER_INSERT = """            collected_output_items: list = []

            def _recover_collected_codex_output(reason: str):
                if collected_output_items:
                    recovered = SimpleNamespace(
                        output=list(collected_output_items),
                        usage=None,
                        status="completed",
                        model=api_kwargs.get("model"),
                    )
                    logger.warning(
                        "Codex stream recovered from collected output items after %s "
                        "(items=%d). %s",
                        reason,
                        len(collected_output_items),
                        self._client_log_context(),
                    )
                    return recovered
                if self._codex_streamed_text_parts and not has_tool_calls:
                    assembled = "".join(self._codex_streamed_text_parts)
                    if assembled:
                        recovered = SimpleNamespace(
                            output=[
                                SimpleNamespace(
                                    type="message",
                                    role="assistant",
                                    status="completed",
                                    content=[SimpleNamespace(type="output_text", text=assembled)],
                                )
                            ],
                            output_text=assembled,
                            usage=None,
                            status="completed",
                            model=api_kwargs.get("model"),
                        )
                        logger.warning(
                            "Codex stream recovered from text deltas after %s "
                            "(chars=%d). %s",
                            reason,
                            len(assembled),
                            self._client_log_context(),
                        )
                        return recovered
                return None

            try:
"""

FINAL_OUTPUT_OLD = """                    _out = getattr(final_response, "output", None)
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
"""

FINAL_OUTPUT_NEW = """                    _out = getattr(final_response, "output", None)
                    if not isinstance(_out, list) or not _out:
                        recovered = _recover_collected_codex_output("empty final response output")
                        if recovered is not None:
                            final_response.output = recovered.output
                            if getattr(recovered, "output_text", None) and not getattr(final_response, "output_text", None):
                                final_response.output_text = recovered.output_text
                    return final_response
            except TypeError as exc:
                err_text = str(exc)
                if "'NoneType' object is not iterable" in err_text or "NoneType" in err_text:
                    recovered = _recover_collected_codex_output("SDK parser returned response.output=None")
                    if recovered is not None:
                        return recovered
                raise
            except (_httpx.RemoteProtocolError, _httpx.ReadTimeout, _httpx.ConnectError, ConnectionError) as exc:
"""


def patch_run_agent(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if PATCH_MARKER in text and "_recover_collected_codex_output" in text:
        return False

    if HELPER_NEEDLE not in text:
        raise RuntimeError("Hermes Codex stream helper insertion point not found")
    text = text.replace(HELPER_NEEDLE, HELPER_INSERT, 1)

    if FINAL_OUTPUT_OLD not in text:
        raise RuntimeError("Hermes Codex final-output block not found")
    text = text.replace(FINAL_OUTPUT_OLD, FINAL_OUTPUT_NEW, 1)

    path.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "run_agent",
        nargs="?",
        default="/usr/local/lib/hermes-agent/run_agent.py",
        help="Path to Hermes run_agent.py",
    )
    args = parser.parse_args()

    target = Path(args.run_agent)
    changed = patch_run_agent(target)
    if changed:
        print(f"patched Hermes Codex none-output recovery: {target}")
    else:
        print(f"Hermes Codex none-output recovery already present: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
