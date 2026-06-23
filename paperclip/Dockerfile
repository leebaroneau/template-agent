# syntax=docker/dockerfile:1.7
# Tier 3: template-agent
# Publishes: ghcr.io/leebaroneau/template-agent:latest
# Rebuild when: any file in this repo changes (~1-2 min, every commit)
ARG PAPERCLIP_BASE_TAG=latest
FROM ghcr.io/leebaroneau/paperclip-base:${PAPERCLIP_BASE_TAG}

# Pre-install obra/superpowers methodology skills for Claude Code and Codex subagents.
# Baked into the image because /home/node/.claude and /home/node/.codex are NOT on the
# /data volume — runtime installs are wiped on every redeploy.
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
COPY paperclip/lib /opt/paperclip/lib
COPY paperclip/pre-deploy-backup.sh /opt/paperclip/pre-deploy-backup.sh
COPY paperclip/restore-backup.sh /opt/paperclip/restore-backup.sh
COPY paperclip/patch-hermes-adapter-env.mjs /opt/paperclip/patch-hermes-adapter-env.mjs
COPY paperclip/patch-hermes-adapter-skills-home.mjs /opt/paperclip/patch-hermes-adapter-skills-home.mjs
COPY paperclip/patch-hermes-profile-skill-count.mjs /opt/paperclip/patch-hermes-profile-skill-count.mjs
COPY paperclip/patch-hermes-tui-lazy-inventory.mjs /opt/paperclip/patch-hermes-tui-lazy-inventory.mjs
COPY paperclip/patch-paperclip-company-prefix.mjs /opt/paperclip/patch-paperclip-company-prefix.mjs
COPY paperclip/patch-invite-auth-flow.mjs /opt/paperclip/patch-invite-auth-flow.mjs
COPY paperclip/patch-hermes-update-message.mjs /opt/paperclip/patch-hermes-update-message.mjs
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
  && chmod +x /opt/paperclip/entrypoint.sh /opt/paperclip/hermes-entrypoint.sh /opt/paperclip/pre-deploy-backup.sh /opt/paperclip/restore-backup.sh

EXPOSE 3100 9119

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fs http://localhost:3100/api/health >/dev/null 2>&1 \
      || curl -fs http://localhost:9119/ >/dev/null 2>&1 \
      || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/paperclip/entrypoint.sh"]
