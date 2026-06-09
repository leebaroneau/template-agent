# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim

ARG PAPERCLIP_VERSION=2026.525.0
ARG PAPERCLIP_GIT_REPO=https://github.com/paperclipai/paperclip.git
ARG PAPERCLIP_GIT_REF=refs/pull/6243/head
ARG HERMES_AGENT_REF=v2026.6.5

ENV DEBIAN_FRONTEND=noninteractive
ENV PAPERCLIP_HOME=/data
ENV PAPERCLIP_TELEMETRY_DISABLED=1
ENV PAPERCLIP_UI_DEV_MIDDLEWARE=false
ENV PAPERCLIP_SOURCE_DIR=/opt/paperclip-src
ENV HERMES_DATA_ROOT=/data/hermes
ENV HERMES_HOME=/data/hermes
ENV HF_HOME=/data/hermes/model-cache
ENV TORCH_HOME=/data/hermes/model-cache
ENV HERMES_TUI_DIR=/usr/local/lib/hermes-agent/ui-tui
ENV PATH="/usr/local/bin:/root/.local/bin:/root/.bun/bin:${PATH}"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    ffmpeg \
    git \
    jq \
    openssh-client \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    tini \
    unzip \
    libmagic1 \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-osd

RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    curl -fsSL https://bun.sh/install | bash \
  && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    --mount=type=cache,target=/root/.npm,sharing=locked \
    curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_AGENT_REF}/scripts/install.sh" \
    | bash -s -- --skip-browser --branch "${HERMES_AGENT_REF}" --hermes-home /opt/hermes-bootstrap \
  && HERMES_SRC="/usr/local/lib/hermes-agent" \
  && cd "$HERMES_SRC" \
  && git fetch --depth 1 origin "${HERMES_AGENT_REF}" \
  && git checkout FETCH_HEAD \
  && python3 -m py_compile "$HERMES_SRC/run_agent.py" \
  && export PATH="/opt/hermes-bootstrap/bin:${PATH}" \
  && (uv pip install --python ./venv/bin/python -e ".[all,messaging]" \
        || uv pip install --python ./venv/bin/python -e ".[all]" \
        || uv pip install --python ./venv/bin/python -e .) \
  && uv pip install --python ./venv/bin/python "anthropic>=0.39.0" faster-whisper \
       pymupdf pytesseract python-docx openpyxl pandas tabulate python-magic \
  && cd "$HERMES_SRC/web" \
  && npm install \
  && npm run build \
  && rm -rf node_modules \
  && cd "$HERMES_SRC/ui-tui" \
  && npm install --silent --no-fund --no-audit --progress=false \
  && npm run build \
  && ln -sf "$HERMES_SRC/venv/bin/hermes" /usr/local/bin/hermes

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    if [ -n "${PAPERCLIP_GIT_REF}" ]; then \
      git clone --filter=blob:none "${PAPERCLIP_GIT_REPO}" "${PAPERCLIP_SOURCE_DIR}" \
      && cd "${PAPERCLIP_SOURCE_DIR}" \
      && git fetch --depth 1 origin "${PAPERCLIP_GIT_REF}" \
      && git checkout FETCH_HEAD \
      && npm install -g pnpm@9.15.4 \
      && pnpm config set store-dir /opt/pnpm-store \
      && pnpm install --frozen-lockfile \
      && pnpm build \
      && PAPERCLIP_RELEASE_REUSE_UI_DIST=1 pnpm --filter @paperclipai/server prepare:ui-dist \
      && printf '%s\n' '#!/usr/bin/env bash' 'exec node /opt/paperclip-src/cli/node_modules/tsx/dist/cli.mjs /opt/paperclip-src/cli/src/index.ts "$@"' > /usr/local/bin/paperclipai \
      && chmod +x /usr/local/bin/paperclipai \
      && npm uninstall -g pnpm \
      && paperclipai --version; \
    else \
      npm install -g "paperclipai@${PAPERCLIP_VERSION}"; \
    fi

# Coding CLIs available to all agent profiles with terminal toolset enabled.
# gh: repo/PR/issue ops; claude-code + codex: coding agent delegation.
ARG GH_VERSION=2.52.0
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    | tar xz --strip-components=2 -C /usr/local/bin "gh_${GH_VERSION}_linux_amd64/bin/gh" \
  && npm install -g --no-audit --no-fund \
       @anthropic-ai/claude-code \
       @openai/codex \
       @shopify/cli

# Browser backend for the Hermes `browser` toolset. The Hermes installer is run
# with --skip-browser (above), so install agent-browser + Chromium explicitly here.
# Without this the browser tool silently fails: agents fall back to ad-hoc
# Playwright (not installed) and time out on any portal/scrape task.
#
# Two correctness requirements (both were broken before — the CLI installed but
# Chromium never launched at runtime):
#  1. System libs. `agent-browser install --with-deps` shells out to `sudo apt-get`,
#     but this slim image ships no `sudo`, so --with-deps was a silent no-op and
#     Chromium's runtime libs were never installed. Install Chromium's declared
#     deps (chrome-for-testing deb.deps set) directly via apt as root instead.
#  2. Cache path. agent-browser caches Chromium under $HOME/.agent-browser. The
#     build runs as root, but the runtime runs as the `node` user (HOME=/home/node,
#     via `runuser -u node` in the entrypoints). So install with HOME=/home/node and
#     chown the cache to node — otherwise node looks in /home/node/.agent-browser,
#     finds nothing, and silently re-downloads into the ephemeral home (wiped on
#     redeploy), which is the exact failure this layer is meant to prevent.
# Runtime launches must pass --no-sandbox (no user namespaces in-container); brand
# skills set AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage or pass --args.
# NOTE: Salesforce-Lightning-class pages need swap or >=1GB free RAM to render
# headless, or agent-browser returns "os error 11".
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
       libdbus-1-3 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
       libpango-1.0-0 libudev1 libvulkan1 libx11-6 libxcb1 libxcomposite1 \
       libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
       fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --no-audit --no-fund agent-browser@0.27.0 \
  && HOME=/home/node agent-browser install \
  && chown -R node:node /home/node/.agent-browser

# Pre-install obra/superpowers methodology skills for Claude Code and Codex subagents.
# Baked into the image because /home/node/.claude and /home/node/.codex are NOT on the
# /data volume — runtime installs are wiped on every redeploy.
# Claude Code loads the plugin via --plugin-dir on each invocation (see claude-code skill).
# Codex discovers skills from ~/.codex/skills/ — symlink each skill directory there.
RUN git clone --depth 1 https://github.com/obra/superpowers /opt/plugins/superpowers \
 && mkdir -p /home/node/.codex/skills \
 && for skill_dir in /opt/plugins/superpowers/skills/*/; do \
      ln -sfn "$skill_dir" "/home/node/.codex/skills/$(basename "$skill_dir")"; \
    done \
 && chown -R node:node /home/node/.codex

COPY hermes-runtime/scripts /opt/hermes-runtime/scripts
COPY hermes-runtime/templates /opt/hermes-runtime/templates
COPY hermes-runtime/skills /opt/hermes-runtime/skills
COPY paperclip/delegation-protocol.md /opt/paperclip/delegation-protocol.md
COPY paperclip/learning-protocol.md /opt/paperclip/learning-protocol.md
COPY paperclip/important-information-index.md /opt/paperclip/important-information-index.md
COPY paperclip/entrypoint.sh /opt/paperclip/entrypoint.sh
COPY paperclip/hermes-entrypoint.sh /opt/paperclip/hermes-entrypoint.sh
COPY paperclip/coolify-preview-env.mjs /opt/paperclip/coolify-preview-env.mjs
COPY paperclip/pre-deploy-backup.sh /opt/paperclip/pre-deploy-backup.sh
COPY paperclip/patch-hermes-adapter-env.mjs /opt/paperclip/patch-hermes-adapter-env.mjs
COPY paperclip/patch-hermes-adapter-skills-home.mjs /opt/paperclip/patch-hermes-adapter-skills-home.mjs
COPY paperclip/patch-hermes-profile-skill-count.mjs /opt/paperclip/patch-hermes-profile-skill-count.mjs
COPY paperclip/patch-paperclip-company-prefix.mjs /opt/paperclip/patch-paperclip-company-prefix.mjs
COPY paperclip/patch-invite-auth-flow.mjs /opt/paperclip/patch-invite-auth-flow.mjs
COPY paperclip/repair-paperclip-config.mjs /opt/paperclip/repair-paperclip-config.mjs
COPY paperclip/profile-sync.mjs /opt/paperclip/profile-sync.mjs
COPY paperclip/seed-tool-access.mjs /opt/paperclip/seed-tool-access.mjs
COPY paperclip/narrow-grants.mjs /opt/paperclip/narrow-grants.mjs
COPY paperclip/mcp-paperclip /opt/paperclip/mcp-paperclip
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    cd /opt/paperclip/mcp-paperclip \
  && npm install --omit=dev --no-audit --no-fund --silent \
  && chmod +x /opt/paperclip/mcp-paperclip/server.mjs

RUN mkdir -p /data /opt/work \
  && rm -rf /opt/hermes-bootstrap /root/.hermes /data/* /data/.[!.]* /data/..?* /tmp/* \
  && rm -f /usr/local/bin/bun \
  && cp /root/.bun/bin/bun /usr/local/bin/bun \
  && chown -R node:node /data /opt/work \
  && chmod +x /opt/hermes-runtime/scripts/*.sh \
  && chmod +x /usr/local/bin/bun \
  && chmod +x /opt/paperclip/entrypoint.sh /opt/paperclip/hermes-entrypoint.sh /opt/paperclip/pre-deploy-backup.sh

EXPOSE 3100 9119

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fs http://localhost:3100/api/health >/dev/null 2>&1 \
      || curl -fs http://localhost:9119/ >/dev/null 2>&1 \
      || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/paperclip/entrypoint.sh"]
