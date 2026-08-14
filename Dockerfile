# Proma single-image build (amd64/arm64 / Bun + Hono + frontend static assets)
# Run from source (no bun build --compile) so default-skills can keep using
# import.meta.url relative path resolution.
#
# NOTE: keep this file pure ASCII -- the Jenkins docker-build-step reads it
# with the agent's default charset (GBK on the CI node) and UTF-8 comments
# throw MalformedInputException. This overrides the repo's "Chinese comments
# preferred" rule for this file only.

# --- Stage 0: base (install metadata + workspace manifests, shared by all
#    install stages so the COPY layers are cached once) ---
FROM oven/bun:1.3.9-debian AS base
WORKDIR /app
USER root
# Explicit bun install cache dir, still used within each install stage.
# No BuildKit cache mount (--mount=type=cache) here -- the Jenkins CI daemon
# runs the classic builder and rejects it, so install caches are not persisted
# across builds on that node. GitHub Actions persists them via the buildx
# layer cache instead.
ENV BUN_INSTALL_CACHE_DIR=/proma-bun-cache

# 1) COPY install metadata + bun.lock first to maximize layer caching.
COPY docker/bunfig.docker.toml ./bunfig.toml
COPY package.json bun.lock ./
COPY patches/ ./patches/

# 2) All workspace member package.json files (for workspace:* resolution)
COPY packages/shared/package.json       ./packages/shared/
COPY packages/core/package.json         ./packages/core/
COPY packages/ui/package.json           ./packages/ui/
COPY packages/server-core/package.json  ./packages/server-core/
COPY packages/session-core/package.json ./packages/session-core/
COPY apps/server/package.json           ./apps/server/
COPY apps/web/package.json              ./apps/web/
COPY apps/cli/package.json              ./apps/cli/

# --- Stage 1: deps (full hoisted node_modules incl. devDependencies, used by
#    web-build for vite) ---
FROM base AS deps
#    --frozen-lockfile: CI must never drift from bun.lock.
#    Keep bun.lock (bunfig does NOT set lockfile=false) so bun 1.3.9 uses the
#    hoisted node_modules layout: workspace members and transitive deps
#    (e.g. typebox from pi-ai) are hoisted to the top level and resolvable at
#    runtime. lockfile=false would fall back to an isolated layout and break
#    server-core ghost deps + undeclared pi-* peers of apps/server.
#    --network-concurrency limits parallelism to avoid connections being
#    dropped when going through a proxy (local builds use --network=host).
#    Slimming: the runtime base image is debian (glibc); the claude-agent-sdk
#    *-linux-*-musl platform binaries (~231MB) are only loaded under
#    alpine(musl), so remove them here so they never enter the runtime COPY
#    layer (removing them in runtime would not save space -- layers stack).
RUN bun install --frozen-lockfile --network-concurrency=8 \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

# --- Stage 2: prod-deps (production-only node_modules for the runtime image,
#    keeping devDependencies like vite/typescript/eslint out of the ~1.3GB
#    node_modules that runtime COPYs) ---
FROM base AS prod-deps
RUN bun install --omit=dev --frozen-lockfile --network-concurrency=8 \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

# --- Stage 3: web-build (frontend bundle) ---
FROM deps AS web-build
WORKDIR /app

# Build with bun directly: this public-line Dockerfile targets the GitHub
# Actions runner (16GB+ RAM), where bun's ~4GB peak is no problem and apt is
# avoided entirely (apt node install proved flaky under load). The orm/Jenkins
# line (main branch) keeps the node workaround for its low-memory CI node.

# COPY all sources needed by vite (apps/web + packages workspace sources +
# root tsconfig.json for extends)
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/  ./apps/web/

# Build the frontend only: apps/web build = vite build, root=apps/web/src/renderer,
# base='/', output to src/renderer/dist
RUN bun run --filter='@proma/web' build

# --- Stage 4: runtime (prod node_modules, no reinstall) ---
# Do NOT re-run bun install in runtime: reuse the prod-deps node_modules (with
# @proma/* workspace links and applied patches). Reinstalling would fail
# because runtime only contains apps/server (no apps/web or apps/cli), leaving
# the workspace incomplete and drifting from the lockfile.
FROM oven/bun:1.3.9-debian AS runtime
WORKDIR /app

# Slimming: all COPY use --chown=bun:bun to land files directly owned by bun,
# avoiding a later `chown -R /app` (Docker copy-on-write would duplicate the
# whole /app including ~1GB node_modules into a new layer). oven/bun images
# ship a bun user with UID/GID=1000:1000.

# 1) Reuse prod-deps hoisted node_modules (production deps + @proma/* links;
#    musl binaries already removed in the prod-deps stage)
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules

# 2) Runtime sources: workspace sources (server closure deps) + server itself +
#    install metadata (patches already applied inside node_modules)
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun patches/ ./patches/
COPY --chown=bun:bun packages/ ./packages/
COPY --chown=bun:bun apps/server/ ./apps/server/

# 3) Frontend bundle (from web-build stage)
COPY --from=web-build --chown=bun:bun /app/apps/web/src/renderer/dist ./apps/web/src/renderer/dist

# 4) entrypoint script (seeds proxy-settings.json on first boot). Use plain
#    COPY --chown (classic-builder compatible); the exec bit is set by the
#    root RUN below, since COPY --chmod requires Docker >= 20.10.
COPY --chown=bun:bun docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV PROMA_DATA_ROOT=/data \
    PORT=3000 \
    PROMA_WEB_DIST=/app/apps/web/src/renderer/dist

# Create and chown the data volume dir only: /data is empty, so chown touches
# just the dir itself without triggering a large layer copy. Must be created by
# root -- entrypoint runs as bun and cannot create dirs under /.
USER root
RUN mkdir -p /data && chown bun:bun /data && chmod 755 /usr/local/bin/docker-entrypoint.sh

USER bun
EXPOSE 3000

# Healthcheck: the bun image has no curl; use a one-line bun -e fetch
# (K8s uses its own Pod probes; this is for local docker run)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/health');if(!r.ok)process.exit(1)" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "apps/server/src/index.ts"]
