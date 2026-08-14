# Proma single-image build (amd64 / Bun + Hono + frontend static assets)
# Run from source (no bun build --compile) so default-skills can keep using
# import.meta.url relative path resolution.

# --- Stage 1: deps (full hoisted node_modules, reused by web-build and runtime) ---
FROM oven/bun:1.3.9-debian AS deps
WORKDIR /app
USER root
# Explicit bun install cache dir, matching the --mount=type=cache target below,
# so the download cache of this stage can be reused by the web-build stage.
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

# 3) Install all deps (incl. devDependencies for vite build).
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
RUN --mount=type=cache,target=/proma-bun-cache \
    bun install --network-concurrency=8 \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

# --- Stage 2: web-build (frontend bundle) ---
FROM deps AS web-build
WORKDIR /app

# COPY all sources needed by vite (apps/web + packages workspace sources +
# root tsconfig.json for extends)
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/  ./apps/web/

# Build the frontend only: apps/web build = vite build, root=apps/web/src/renderer,
# base='/', output to src/renderer/dist
RUN --mount=type=cache,target=/proma-bun-cache \
    bun run --filter='@proma/web' build

# --- Stage 3: runtime (reuse deps hoisted node_modules, no reinstall) ---
# Do NOT re-run bun install in runtime: reuse the complete hoisted node_modules
# installed in deps (with @proma/* workspace links, transitive deps like
# typebox, and applied patches). Reinstalling would fail because runtime only
# contains apps/server (no apps/web or apps/cli), leaving the workspace
# incomplete and drifting from the lockfile.
FROM oven/bun:1.3.9-debian AS runtime
WORKDIR /app

# Slimming: all COPY use --chown=bun:bun to land files directly owned by bun,
# avoiding a later `chown -R /app` (Docker copy-on-write would duplicate the
# whole /app including ~1.3GB node_modules into a new layer, adding ~1.3GB).
# oven/bun images ship a bun user with UID/GID=1000:1000.

# 1) Reuse deps hoisted node_modules (all deps + @proma/* links; musl binaries
#    already removed in the deps stage)
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules

# 2) Runtime sources: workspace sources (server closure deps) + server itself +
#    install metadata (patches already applied inside node_modules)
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun patches/ ./patches/
COPY --chown=bun:bun packages/ ./packages/
COPY --chown=bun:bun apps/server/ ./apps/server/

# 3) Frontend bundle (from web-build stage)
COPY --from=web-build --chown=bun:bun /app/apps/web/src/renderer/dist ./apps/web/src/renderer/dist

# 4) entrypoint script (seeds proxy-settings.json on first boot); --chmod sets
#    the exec bit directly, avoiding a later RUN chmod
COPY --chmod=755 --chown=bun:bun docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV PROMA_DATA_ROOT=/data \
    PORT=3000 \
    PROMA_WEB_DIST=/app/apps/web/src/renderer/dist

# Create and chown the data volume dir only: /data is empty, so chown touches
# just the dir itself without triggering a large layer copy. Must be created by
# root -- entrypoint runs as bun and cannot create dirs under /.
USER root
RUN mkdir -p /data && chown bun:bun /data

USER bun
EXPOSE 3000

# Healthcheck: the bun image has no curl; use a one-line bun -e fetch
# (K8s uses its own Pod probes; this is for local docker run)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/health');if(!r.ok)process.exit(1)" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "apps/server/src/index.ts"]
