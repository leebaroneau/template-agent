#!/usr/bin/env python3
"""Generate a Claude Code --mcp-config JSON from the active Hermes profile.

Reads mcp_servers from $HERMES_HOME/config.yaml (skipping disabled entries),
resolves ${VAR} placeholders in env values from the process environment, then
always injects the profile's holographic memory store at
$HERMES_HOME/memory_store.db.

Writes the config to a temp file and prints the path.
Caller is responsible for deleting the file after claude exits.
"""
from __future__ import annotations
import json, os, re, sys, tempfile

try:
    import yaml
    _HAVE_YAML = True
except ImportError:
    _HAVE_YAML = False

hermes_home = os.environ.get("HERMES_HOME", "/data/hermes")
servers: dict = {}

if _HAVE_YAML:
    try:
        with open(os.path.join(hermes_home, "config.yaml"), encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh) or {}
        for name, srv in (cfg.get("mcp_servers") or {}).items():
            if not isinstance(srv, dict):
                continue
            if srv.get("enabled") is False:
                continue
            entry: dict = {}
            if "command" in srv:
                entry["command"] = srv["command"]
            if "args" in srv:
                entry["args"] = srv["args"]
            raw_env = srv.get("env") or {}
            resolved_env = {}
            for k, v in raw_env.items():
                v = str(v)
                v = re.sub(r"\$\{(\w+)\}", lambda m: os.environ.get(m.group(1), m.group(0)), v)
                resolved_env[k] = v
            if resolved_env:
                entry["env"] = resolved_env
            servers[name] = entry
    except Exception as exc:
        print(f"[hermes-gen-mcp-config] warning: could not read config.yaml: {exc}", file=sys.stderr)

# Always inject holographic memory pointing at this profile's DB.
# HERMES_HOME is profile-aware and already set in the container environment.
servers["holographic-memory"] = {
    "command": "/usr/local/bin/hermes-holo-mcp-wrapper",
    "env": {
        "PAPERCLIP_HOLO_MEMORY_DB": os.path.join(hermes_home, "memory_store.db"),
        "PAPERCLIP_HOLO_MEMORY_RECALL_ENABLED": "true",
        "PAPERCLIP_HOLO_MEMORY_RETAIN_ENABLED": "true",
        "PAPERCLIP_HOLO_MEMORY_AUTO_EXTRACT": "true",
        "PAPERCLIP_HOLO_MEMORY_MIN_TRUST": "0.3",
        "PAPERCLIP_HOLO_MEMORY_MAX_RECALL": "20",
    },
}

tmp = tempfile.NamedTemporaryFile(
    mode="w", suffix=".json", prefix="hermes-mcp-", delete=False
)
json.dump({"mcpServers": servers}, tmp, indent=2)
tmp.close()
print(tmp.name)
