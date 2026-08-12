#!/usr/bin/env bash
# Proma Docker 镜像本地构建脚本
# 示例: bun run docker:build | bun run docker:build:prod | bash scripts/build-docker.sh --prod
set -euo pipefail

# 切到项目根（脚本位于 scripts/ 下）
cd "$(dirname "$0")/.."

# ─── 默认值 ───
IMAGE_NAME="proma"
PLATFORM=""          # 空 = native（当前平台，构建最快）
TAG=""               # 空 = 按模式自动决定
MODE="local"         # local | prod
NO_CACHE=""
HOST_NET="--network=host"

usage() {
  cat <<'EOF'
用法: bash scripts/build-docker.sh [选项]

选项:
  --prod                 生产构建（默认 linux/amd64，tag = <git-sha> + latest）
  --platform <os/arch>   指定目标平台（如 linux/amd64、linux/arm64）
  --tag <name>           自定义镜像 tag（默认: 本地=local，生产=<git-sha>）
  --image <name>         自定义镜像名（默认 proma）
  --no-cache             不使用构建缓存
  --no-host-network      不用 --network=host（若你的 Docker 环境 host 模式异常）
  -h, --help             显示本帮助

说明:
  - 默认 --network=host 直连 npmjs 下载依赖（bun.lock 锁版本，docker/bunfig.docker.toml 指定 npmjs 源）。
    若直连境外较慢或失败，可先在 shell 设 HTTP_PROXY / HTTPS_PROXY 后重试。
  - 前端产物由 Dockerfile 内 web-build 阶段构建，无需事先 bun run build。
EOF
  exit 0
}

# ─── 参数解析 ───
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod)             MODE="prod"; shift ;;
    --platform)         PLATFORM="${2:?--platform 缺少参数}"; shift 2 ;;
    --tag)              TAG="${2:?--tag 缺少参数}"; shift 2 ;;
    --image)            IMAGE_NAME="${2:?--image 缺少参数}"; shift 2 ;;
    --no-cache)         NO_CACHE="--no-cache"; shift ;;
    --no-host-network)  HOST_NET=""; shift ;;
    -h|--help)          usage ;;
    *)                  echo "❌ 未知参数: $1（--help 查看用法）" >&2; exit 1 ;;
  esac
done

# ─── 前置检查 ───
command -v docker >/dev/null 2>&1 || { echo "❌ 未找到 docker，请先安装 Docker" >&2; exit 1; }

# ─── 平台与 tag 决策 ───
# 生产模式默认 amd64（ACK 节点为 amd64）；本地模式默认 native（空，构建最快）
if [[ "$MODE" == "prod" && -z "$PLATFORM" ]]; then
  PLATFORM="linux/amd64"
fi

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
if [[ -z "$TAG" ]]; then
  if [[ "$MODE" == "prod" ]]; then TAG="$GIT_SHA"; else TAG="local"; fi
fi

# ─── 组装构建参数 ───
export DOCKER_BUILDKIT=1   # 启用 BuildKit（Dockerfile 的 cache mount 依赖）

BUILD_ARGS=(-t "$IMAGE_NAME:$TAG")
[[ "$MODE" == "prod" ]] && BUILD_ARGS+=(-t "$IMAGE_NAME:latest")
[[ -n "$PLATFORM" ]] && BUILD_ARGS+=(--platform "$PLATFORM")
[[ -n "$HOST_NET" ]] && BUILD_ARGS+=("$HOST_NET")
[[ -n "$NO_CACHE" ]] && BUILD_ARGS+=("$NO_CACHE")

# ─── 构建 ───
echo "🔧 构建 ${IMAGE_NAME}:${TAG}（平台: ${PLATFORM:-native}，模式: ${MODE}）"
echo ""
docker build "${BUILD_ARGS[@]}" .

# ─── 结果 ───
echo ""
echo "✅ 构建完成"
docker images "$IMAGE_NAME:$TAG" --format "   {{.Repository}}:{{.Tag}}  ({{.Size}})"
echo ""
echo "本地运行: docker run --rm -d -p 3000:3000 -e PROMA_DEV=1 -v proma-data:/data $IMAGE_NAME:$TAG"
echo "访问 http://localhost:3000 ，admin 密码见 docker logs"
