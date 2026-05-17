# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim

ARG PAPERCLIP_VERSION=2026.513.0
ARG HERMES_AGENT_REF=v2026.5.16
ARG GBRAIN_REF=eval-run-v0.35.1.0-baseline

ENV DEBIAN_FRONTEND=noninteractive
ENV PAPERCLIP_HOME=/data
ENV PAPERCLIP_TELEMETRY_DISABLED=1
ENV HERMES_DATA_ROOT=/data/hermes
ENV GBRAIN_DATA_ROOT=/data/gbrain
ENV HERMES_HOME=/data/hermes
ENV HERMES_TUI_DIR=/usr/local/lib/hermes-agent/ui-tui
ENV GBRAIN_HOME=/data/gbrain/default
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
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    tini \
    unzip

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
  && (uv pip install --python ./venv/bin/python -e ".[all,messaging]" \
        || uv pip install --python ./venv/bin/python -e ".[all]" \
        || uv pip install --python ./venv/bin/python -e .) \
  && cd "$HERMES_SRC/web" \
  && npm install \
  && npm run build \
  && rm -rf node_modules \
  && cd "$HERMES_SRC/ui-tui" \
  && npm install --silent --no-fund --no-audit --progress=false \
  && npm run build \
  && ln -sf "$HERMES_SRC/venv/bin/hermes" /usr/local/bin/hermes

RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    git clone https://github.com/garrytan/gbrain.git /opt/gbrain \
  && cd /opt/gbrain \
  && git fetch --depth 1 origin "${GBRAIN_REF}" \
  && git checkout FETCH_HEAD \
  && bun install --production

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install -g "paperclipai@${PAPERCLIP_VERSION}"

COPY hermes-runtime/scripts /opt/hermes-runtime/scripts
COPY hermes-runtime/templates /opt/hermes-runtime/templates
COPY hermes-runtime/skills /opt/hermes-runtime/skills
COPY paperclip/delegation-protocol.md /opt/paperclip/delegation-protocol.md
COPY paperclip/learning-protocol.md /opt/paperclip/learning-protocol.md
COPY paperclip/important-information-index.md /opt/paperclip/important-information-index.md
COPY paperclip/gbrain-wrapper.sh /usr/local/bin/gbrain
COPY paperclip/entrypoint.sh /opt/paperclip/entrypoint.sh
COPY paperclip/hermes-entrypoint.sh /opt/paperclip/hermes-entrypoint.sh
COPY paperclip/patch-hermes-adapter-env.mjs /opt/paperclip/patch-hermes-adapter-env.mjs
COPY paperclip/patch-hermes-adapter-skills-home.mjs /opt/paperclip/patch-hermes-adapter-skills-home.mjs
COPY paperclip/patch-paperclip-company-prefix.mjs /opt/paperclip/patch-paperclip-company-prefix.mjs
COPY paperclip/patch-paperclip-hermes-defaults.mjs /opt/paperclip/patch-paperclip-hermes-defaults.mjs
COPY paperclip/profile-sync.mjs /opt/paperclip/profile-sync.mjs
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
  && chmod +x /usr/local/bin/gbrain \
  && chmod +x /opt/paperclip/entrypoint.sh /opt/paperclip/hermes-entrypoint.sh

EXPOSE 3100 9119

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fs http://localhost:3100/api/health >/dev/null 2>&1 \
      || curl -fs http://localhost:9119/ >/dev/null 2>&1 \
      || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/paperclip/entrypoint.sh"]
