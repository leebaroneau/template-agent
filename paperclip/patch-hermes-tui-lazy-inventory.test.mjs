import { test } from 'node:test';
import assert from 'node:assert/strict';

import { patchHermesTuiLazyInventorySource } from './patch-hermes-tui-lazy-inventory.mjs';

const SERVER_SOURCE = `from pathlib import Path


DESKTOP_BACKEND_CONTRACT = 2


def _session_info(agent, session: dict | None = None) -> dict:
    return {"tools": {}, "skills": {}}


def create_session():
    build_timer.daemon = True
    build_timer.start()

    return _ok(
        rid,
        {
            "session_id": sid,
            "stored_session_id": key,
            "message_count": len(history),
            "messages": _history_to_messages(history),
            "info": {
                # Reflect the per-session model override (desktop composer pick)
                # in the immediate response so the client doesn't briefly clobber
                # its sticky pick with the global default before the deferred
                # build's session.info lands.
                "model": (
                    session_model_override.get("model")
                    if session_model_override
                    else _resolve_model()
                ),
                **(
                    {"provider": session_model_override["provider"]}
                    if session_model_override and session_model_override.get("provider")
                    else {}
                ),
                "tools": {},
                "skills": {},
                "cwd": _sessions[sid]["cwd"],
                "branch": _git_branch_for_cwd(_sessions[sid]["cwd"]),
                "lazy": True,
                "desktop_contract": DESKTOP_BACKEND_CONTRACT,
                "profile_name": _current_profile_name(),
            },
        },
    )


def lazy_resume():
    return _ok(
        rid,
        {
                "info": {
                    "cwd": cwd,
                    "branch": _git_branch_for_cwd(cwd),
                    "model": _resolve_model(),
                    "tools": {},
                    "skills": {},
                    "lazy": True,
                    "desktop_contract": DESKTOP_BACKEND_CONTRACT,
                    "profile_name": _current_profile_name(),
                },
        },
    )


def set_cwd():
    info = _session_info(agent, session) if agent is not None else {
        "cwd": cwd,
        "branch": _git_branch_for_cwd(cwd),
        "lazy": True,
    }
    return info


def _fallback_session_info(session: dict) -> dict:
    agent = session.get("agent")
    if agent is not None:
        return _session_info(agent)
    return {
        "cwd": os.getenv("TERMINAL_CWD", os.getcwd()),
        "lazy": True,
        "model": _resolve_model(),
        "skills": {},
        "tools": {},
    }
`;

test('patchHermesTuiLazyInventorySource populates lazy session metadata paths', () => {
  const patched = patchHermesTuiLazyInventorySource(SERVER_SOURCE);

  assert.match(patched, /def _lazy_session_info\(/);
  assert.match(patched, /from hermes_cli\.banner import get_available_skills/);
  assert.match(patched, /from toolsets import get_all_toolsets, resolve_toolset/);
  assert.match(patched, /lazy_info = _lazy_session_info\(/);
  assert.match(patched, /"info": lazy_info/);
  assert.match(patched, /"info": _lazy_session_info\(\n\s+cwd=cwd,\n\s+profile_home=profile_home,/);
  assert.match(patched, /else _lazy_session_info\(\n\s+cwd=cwd,/);
  assert.match(
    patched,
    /return _lazy_session_info\(\n\s+cwd=session\.get\("cwd"\) or os\.getenv/,
  );
});

test('patchHermesTuiLazyInventorySource is idempotent', () => {
  const once = patchHermesTuiLazyInventorySource(SERVER_SOURCE);
  const twice = patchHermesTuiLazyInventorySource(once);
  assert.equal(twice, once);
});

test('patchHermesTuiLazyInventorySource hard-fails when upstream shape drifts', () => {
  const drifted = `DESKTOP_BACKEND_CONTRACT = 2


def _session_info(agent, session=None):
    return {}
`;
  assert.throws(() => patchHermesTuiLazyInventorySource(drifted), /expected .* needle not found/);
});
