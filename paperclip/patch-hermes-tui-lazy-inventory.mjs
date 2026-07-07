#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_TUI_GATEWAY_SERVER_PATH =
  '/usr/local/lib/hermes-agent/tui_gateway/server.py';

// Hermes' TUI creates sessions lazily: session.create returns before AIAgent is
// built, then a later session.info event replaces the initial panel metadata.
// Stock Hermes returns empty tools/skills in that initial payload. If the later
// refresh is delayed, killed, or missed, a healthy profile visibly shows
// "0 tools / 0 skills". Patch the lazy payload to use fast inventory sources
// (configured toolsets + available skills), while keeping the full AIAgent
// session.info as the final source of truth once construction completes.

const PATCH_MARKER = 'def _lazy_session_info(';

const HELPER_NEEDLE = `DESKTOP_BACKEND_CONTRACT = 2


def _session_info`;

const LAZY_SESSION_INFO_HELPER = `def _lazy_session_info(
    *,
    cwd: str | None = None,
    model: str | None = None,
    provider: str | None = None,
    profile_home: str | Path | None = None,
    profile_name: str | None = None,
) -> dict:
    """Best-effort metadata for a not-yet-built agent.

    \`\`session.create\`\` returns before \`\`AIAgent\`\` construction so the TUI can
    paint immediately. Returning empty tools/skills there makes healthy profiles
    look broken if the later \`\`session.info\`\` refresh is delayed or missed.
    This stays on lightweight config/registry paths and lets the full agent
    snapshot replace it once construction completes.
    """
    cwd_value = cwd or os.getenv("TERMINAL_CWD", os.getcwd())
    info: dict = {
        "model": model or _resolve_model(),
        "tools": {},
        "skills": {},
        "cwd": cwd_value,
        "branch": _git_branch_for_cwd(cwd_value),
        "lazy": True,
        "desktop_contract": DESKTOP_BACKEND_CONTRACT,
        "profile_name": profile_name or _current_profile_name(),
    }
    if provider:
        info["provider"] = provider

    home_token = None
    try:
        if profile_home is not None:
            home_token = set_hermes_home_override(str(profile_home))

        try:
            from hermes_cli.banner import get_available_skills

            info["skills"] = get_available_skills()
        except Exception:
            pass

        try:
            from toolsets import get_all_toolsets, resolve_toolset

            enabled = _load_enabled_toolsets()
            toolset_names = (
                sorted(get_all_toolsets().keys())
                if enabled is None
                else [str(name) for name in enabled if str(name).strip()]
            )
            seen: set[str] = set()
            for toolset_name in toolset_names:
                names: list[str] = []
                for tool_name in resolve_toolset(toolset_name):
                    if not tool_name or tool_name in seen:
                        continue
                    seen.add(tool_name)
                    names.append(tool_name)
                if names:
                    info["tools"][toolset_name] = names
                else:
                    # MCP/plugin toolsets may not have registered concrete
                    # model functions before discovery; show the configured
                    # capability instead of collapsing the panel to zero.
                    info["tools"].setdefault("configured", []).append(toolset_name)
        except Exception:
            pass

        try:
            from tools.mcp_tool import get_mcp_status

            info["mcp_servers"] = get_mcp_status()
        except Exception:
            info["mcp_servers"] = []
    finally:
        if home_token is not None:
            reset_hermes_home_override(home_token)

    return info


def _session_info`;

const CREATE_INFO_NEEDLE = `    return _ok(
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
    )`;

const CREATE_INFO_REPLACEMENT = `    lazy_model = (
        session_model_override.get("model")
        if session_model_override
        else _resolve_model()
    )
    lazy_provider = (
        session_model_override["provider"]
        if session_model_override and session_model_override.get("provider")
        else None
    )
    lazy_info = _lazy_session_info(
        cwd=_sessions[sid]["cwd"],
        model=lazy_model,
        provider=lazy_provider,
        profile_home=profile_home,
        profile_name=profile,
    )

    return _ok(
        rid,
        {
            "session_id": sid,
            "stored_session_id": key,
            "message_count": len(history),
            "messages": _history_to_messages(history),
            "info": lazy_info,
        },
    )`;

const LAZY_RESUME_INFO_NEEDLE = `                "info": {
                    "cwd": cwd,
                    "branch": _git_branch_for_cwd(cwd),
                    "model": _resolve_model(),
                    "tools": {},
                    "skills": {},
                    "lazy": True,
                    "desktop_contract": DESKTOP_BACKEND_CONTRACT,
                    "profile_name": _current_profile_name(),
                },`;

const LAZY_RESUME_INFO_REPLACEMENT = `                "info": _lazy_session_info(
                    cwd=cwd,
                    profile_home=profile_home,
                    profile_name=profile,
                ),`;

const CWD_SET_INFO_NEEDLE = `    info = _session_info(agent, session) if agent is not None else {
        "cwd": cwd,
        "branch": _git_branch_for_cwd(cwd),
        "lazy": True,
    }`;

const CWD_SET_INFO_REPLACEMENT = `    info = (
        _session_info(agent, session)
        if agent is not None
        else _lazy_session_info(
            cwd=cwd,
            profile_home=session.get("profile_home"),
        )
    )`;

const FALLBACK_INFO_NEEDLE = `    return {
        "cwd": os.getenv("TERMINAL_CWD", os.getcwd()),
        "lazy": True,
        "model": _resolve_model(),
        "skills": {},
        "tools": {},
    }`;

const FALLBACK_INFO_REPLACEMENT = `    return _lazy_session_info(
        cwd=session.get("cwd") or os.getenv("TERMINAL_CWD", os.getcwd()),
        profile_home=session.get("profile_home"),
    )`;

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(
      `[template-agent] patch-hermes-tui-lazy-inventory: expected ${label} needle not found ` +
        'in tui_gateway/server.py. Re-audit this patch against the current Hermes release ' +
        'before bumping HERMES_AGENT_REF.',
    );
  }
  return source.replace(needle, replacement);
}

export function patchHermesTuiLazyInventorySource(source) {
  if (source.includes(PATCH_MARKER)) {
    return source;
  }

  // Apply all needles atomically: a partially patched server.py is worse than
  // an unpatched one. The patch is cosmetic (TUI lazy 0-tools/0-skills), so a
  // needle miss on a newer Hermes must never take the container down.
  let patched;
  try {
    patched = replaceOnce(
      source,
      HELPER_NEEDLE,
      `DESKTOP_BACKEND_CONTRACT = 2\n\n\n${LAZY_SESSION_INFO_HELPER}`,
      'helper insertion',
    );
    patched = replaceOnce(patched, CREATE_INFO_NEEDLE, CREATE_INFO_REPLACEMENT, 'session.create');
    patched = replaceOnce(
      patched,
      LAZY_RESUME_INFO_NEEDLE,
      LAZY_RESUME_INFO_REPLACEMENT,
      'lazy session.resume',
    );
    patched = replaceOnce(patched, CWD_SET_INFO_NEEDLE, CWD_SET_INFO_REPLACEMENT, 'session.cwd.set');
    patched = replaceOnce(
      patched,
      FALLBACK_INFO_NEEDLE,
      FALLBACK_INFO_REPLACEMENT,
      'fallback session info',
    );
  } catch (err) {
    console.warn(String(err?.message ?? err));
    console.warn(
      '[template-agent] Skipping Hermes TUI lazy inventory patch — upstream ' +
        'tui_gateway/server.py changed. Re-audit the patch against this Hermes release.',
    );
    return source;
  }
  return patched;
}

export async function patchHermesTuiLazyInventoryFile(
  filePath = process.env.HERMES_TUI_GATEWAY_SERVER_PATH || DEFAULT_TUI_GATEWAY_SERVER_PATH,
) {
  const source = await readFile(filePath, 'utf8');
  const patched = patchHermesTuiLazyInventorySource(source);
  if (patched === source) {
    console.log('[template-agent] Hermes TUI lazy inventory patch already applied');
    return { changed: false, filePath };
  }

  await writeFile(filePath, patched);
  console.log('[template-agent] Applied Hermes TUI lazy inventory patch');
  return { changed: true, filePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await patchHermesTuiLazyInventoryFile();
}
