# Proma single-image build (amd64/arm64 / Bun + Hono + frontend static assets)
# Keep this file pure ASCII: the Jenkins docker-build-step reads it with GBK
# on the CI node, UTF-8 comments throw MalformedInputException.

# --- base: install metadata + workspace manifests (COPY layers cached once) ---
FROM oven/bun:1.3.9-debian AS base
WORKDIR /app
USER root
# No BuildKit cache mount here -- the Jenkins daemon runs the classic builder.
ENV BUN_INSTALL_CACHE_DIR=/proma-bun-cache

# 1) Install metadata first to maximize layer caching.
COPY docker/bunfig.docker.toml ./bunfig.toml
COPY package.json bun.lock ./
COPY patches/ ./patches/

# 2) Workspace member package.json files (for workspace:* resolution)
COPY packages/shared/package.json       ./packages/shared/
COPY packages/core/package.json         ./packages/core/
COPY packages/ui/package.json           ./packages/ui/
COPY packages/server-core/package.json  ./packages/server-core/
COPY packages/session-core/package.json ./packages/session-core/
COPY apps/server/package.json           ./apps/server/
COPY apps/web/package.json              ./apps/web/
COPY apps/cli/package.json              ./apps/cli/

# --- deps: full node_modules (incl. devDependencies) for web-build ---
# --frozen-lockfile: CI must never drift from bun.lock. Keep bun.lock so bun
# uses the hoisted layout (isolated layout breaks server-core ghost deps).
# rm *-musl: glibc runtime never loads them (~231MB, would stack into layers).
FROM base AS deps
RUN bun install --frozen-lockfile --network-concurrency=8 \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

# --- prod-deps: production-only node_modules for runtime (slimmer image) ---
FROM base AS prod-deps
RUN bun install --omit=dev --frozen-lockfile --network-concurrency=8 \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

# --- web-build: frontend bundle ---
FROM deps AS web-build
WORKDIR /app
# Bun builds directly here (GitHub Actions runner has enough RAM); the
# orm/Jenkins line keeps the node workaround for its low-memory CI node.
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/  ./apps/web/

# apps/web build = vite build, output to src/renderer/dist
RUN bun run --filter='@proma/web' build

# --- runtime: prod node_modules, no reinstall (workspace incomplete here) ---
FROM oven/bun:1.3.9-debian AS runtime
WORKDIR /app

# --chown=bun:bun avoids a later chown -R duplicating /app via copy-on-write
# (would add ~1GB). bun user in oven/bun images is UID/GID 1000:1000.
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules

COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun patches/ ./patches/
COPY --chown=bun:bun packages/ ./packages/
COPY --chown=bun:bun apps/server/ ./apps/server/
COPY --from=web-build --chown=bun:bun /app/apps/web/src/renderer/dist ./apps/web/src/renderer/dist
# Plain COPY --chown (classic-builder compatible); exec bit set by RUN below
# (COPY --chmod needs Docker >= 20.10).
COPY --chown=bun:bun docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV PROMA_DATA_ROOT=/data \
    PORT=3000 \
    PROMA_WEB_DIST=/app/apps/web/src/renderer/dist

# /data is empty, so chown here is cheap; entrypoint runs as bun and cannot
# create dirs under /.
USER root
RUN mkdir -p /data && chown bun:bun /data && chmod 755 /usr/local/bin/docker-entrypoint.sh

USER bun
EXPOSE 3000

# No curl in the bun image; healthcheck via bun -e fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/health');if(!r.ok)process.exit(1)" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "apps/server/src/index.ts"]
