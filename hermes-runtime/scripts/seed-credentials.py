#!/usr/bin/env python3
"""
Seed API keys from container env vars into the Hermes credential pool.

Runs at container startup from hermes-entrypoint.sh. Only adds credentials
that are (a) set in the environment and (b) not already in the pool — so
keys managed via the Hermes UI survive redeploys unchanged.
"""
import os
import sys
import uuid

# Hermes venv must be active before calling this script.
try:
    from agent.credential_pool import load_pool, PooledCredential
except ImportError:
    print("[seed-credentials] agent.credential_pool not available — skipping", flush=True)
    sys.exit(0)

# Map env var → Hermes provider ID (matches PROVIDER_REGISTRY in hermes_cli/auth.py)
PROVIDER_MAP = {
    "ANTHROPIC_API_KEY":   "anthropic",
    "OPENAI_API_KEY":      "openai",
    "GEMINI_API_KEY":      "gemini",
    "GOOGLE_API_KEY":      "gemini",
    "OPENROUTER_API_KEY":  "openrouter",
    "NOUS_API_KEY":        "nous",
    "TOGETHER_API_KEY":    "together",
    "GROQ_API_KEY":        "groq",
    "MISTRAL_API_KEY":     "mistral",
    "COHERE_API_KEY":      "cohere",
    "DEEPSEEK_API_KEY":    "deepseek",
    "XAI_API_KEY":         "xai",
    "PERPLEXITY_API_KEY":  "perplexity",
}

seeded = []
for env_var, provider in PROVIDER_MAP.items():
    api_key = os.environ.get(env_var, "").strip()
    if not api_key:
        continue
    try:
        pool = load_pool(provider)
        if pool.has_credentials():
            continue  # already configured — don't overwrite
        entry = PooledCredential(
            provider=provider,
            id=str(uuid.uuid4()),
            label=f"{provider} (env)",
            auth_type="api_key",
            priority=0,
            source="env_seed",
            access_token=api_key,
        )
        pool.add_entry(entry)
        seeded.append(f"{provider} (from {env_var})")
    except Exception as e:
        print(f"[seed-credentials] {provider}: {e}", flush=True)

if seeded:
    print(f"[seed-credentials] Seeded: {', '.join(seeded)}", flush=True)
