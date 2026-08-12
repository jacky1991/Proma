# Proma 单镜像同源部署（amd64 / Bun + Hono + 前端静态资源）
# 源码运行（不走 bun build --compile，保留 default-skills 的 import.meta.url 相对路径定位）

# ─── 阶段 1：deps（全量 hoisted node_modules，供 web-build 与 runtime 复用）───
FROM oven/bun:1.3.9-debian AS deps
WORKDIR /app
USER root
# 显式指定 bun install 缓存目录，与下方 --mount=type=cache 的 target 一致，
# 使本阶段下载缓存可被 web-build 阶段复用（同 BUN_INSTALL_CACHE_DIR）。
ENV BUN_INSTALL_CACHE_DIR=/proma-bun-cache

# 1) 先 COPY 安装元信息 + bun.lock，最大化层缓存（源码改动不破坏 deps 缓存层）
COPY docker/bunfig.docker.toml ./bunfig.toml
COPY package.json bun.lock ./
COPY patches/ ./patches/

# 2) 所有 workspace 成员的 package.json（满足 workspace:* 解析）
COPY packages/shared/package.json       ./packages/shared/
COPY packages/core/package.json         ./packages/core/
COPY packages/ui/package.json           ./packages/ui/
COPY packages/server-core/package.json  ./packages/server-core/
COPY packages/session-core/package.json ./packages/session-core/
COPY apps/server/package.json           ./apps/server/
COPY apps/web/package.json              ./apps/web/
COPY apps/cli/package.json              ./apps/cli/

# 3) 安装全量依赖（含 devDependencies，供 vite build）。
#    关键：保留 bun.lock（bunfig 不设 lockfile=false）→ bun 1.3.9 采用 hoisted node_modules 布局，
#    workspace 成员与传递依赖（pi-ai 的 typebox 等）提升到顶层，运行时可直接解析。
#    若 lockfile=false 会退化为 isolated 布局，server-core 的幽灵依赖 + apps/server 未声明的
#    pi-* peer 全部解析失败。bunfig 的 registry 覆盖下载源，与 lockfile 不冲突。
#    --network-concurrency 限制并发，避免经代理出境时连接被关（本机构建用 --network=host 直连）。
#    镜像瘦身：运行时基础镜像是 debian(glibc)，claude-agent-sdk 的 *-linux-*-musl 平台二进制（~231MB）
#    只在 alpine(musl) 下被加载，glibc 环境用不上。在此阶段直接剔除，让它根本不进 runtime 的 COPY 层
#    （事后在 runtime 里 rm 省不了体积——Docker 层叠加，旧层仍含数据）。
RUN --mount=type=cache,target=/proma-bun-cache \
    bun install --network-concurrency=8 \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

# ─── 阶段 2：web-build（构建前端产物）───
FROM deps AS web-build
WORKDIR /app

# 拷 vite 构建所需的全部源码（apps/web + packages workspace 源码 + 根 tsconfig.json 供 extends）
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/  ./apps/web/

# 仅构建前端：apps/web build = vite build，root=apps/web/src/renderer，base='/'，输出到 src/renderer/dist
RUN --mount=type=cache,target=/proma-bun-cache \
    bun run --filter='@proma/web' build

# ─── 阶段 3：runtime（复用 deps 的 hoisted node_modules，不重跑 install）───
# 不在 runtime 重跑 bun install：复用 deps 阶段已装好的完整 hoisted node_modules（含 @proma/* workspace
# 链接、typebox 等传递依赖、已应用的 patches）。重跑会因 runtime 仅含 apps/server（缺 apps/web、apps/cli）
# 导致 workspace 不完整、lockfile 漂移。
FROM oven/bun:1.3.9-debian AS runtime
WORKDIR /app

# 镜像瘦身：所有 COPY 用 --chown=bun:bun 直接以 bun 属主落地，避免事后 `chown -R /app`。
# 后者会因 Docker copy-on-write 把整个 /app（含 ~1.3GB node_modules）复制成新层，凭空多出 ~1.3GB。
# oven/bun 镜像内置 bun 用户 UID/GID=1000:1000。

# 1) 复用 deps 的 hoisted node_modules（已含全部依赖与 @proma/* 链接，musl 二进制已在 deps 阶段剔除）
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules

# 2) 运行时源码：workspace 源码（server 闭包依赖）+ server 自身 + 安装元信息（patches 已在 node_modules 生效）
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun patches/ ./patches/
COPY --chown=bun:bun packages/ ./packages/
COPY --chown=bun:bun apps/server/ ./apps/server/

# 3) 前端构建产物（来自 web-build 阶段）
COPY --from=web-build --chown=bun:bun /app/apps/web/src/renderer/dist ./apps/web/src/renderer/dist

# 4) entrypoint 脚本（首启播种 proxy-settings.json）；--chmod 直接给可执行位，免去后续 RUN chmod
COPY --chmod=755 --chown=bun:bun docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV PROMA_DATA_ROOT=/data \
    PORT=3000 \
    PROMA_WEB_DIST=/app/apps/web/src/renderer/dist

# 仅创建并赋权数据卷目录：/data 为空目录，chown 只影响目录自身，不触发大面积层复制。
# 必须由 root 预建——entrypoint 以 bun 身份运行，无权在 / 创建目录。
USER root
RUN mkdir -p /data && chown bun:bun /data

USER bun
EXPOSE 3000

# 健康检查：bun 镜像无 curl，用 bun -e 一行 fetch（K8s 另用 Pod 探针，此处供本地 docker run）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/health');if(!r.ok)process.exit(1)" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "apps/server/src/index.ts"]
