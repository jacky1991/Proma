#!/bin/sh
# Proma 容器入口：首启播种 proxy-settings.json（含 adminPassword），然后 exec 启动服务端
# 用 /bin/sh（debian 镜像自带，免装 bash）
set -e

DATA_ROOT="${PROMA_DATA_ROOT:-/data}"
SETTINGS_FILE="$DATA_ROOT/proxy-settings.json"

# 确保 /data 目录存在（K8s 下 PVC 已挂载，本地 docker 下首次创建）
mkdir -p "$DATA_ROOT"

# 仅首启空 volume 时播种；已存在则永不覆盖（保留运维改过的密码 / enabled 状态）
if [ ! -f "$SETTINGS_FILE" ]; then
  # admin 密码：env > 随机生成（16 字节 hex）
  if [ -z "$PROMA_ADMIN_PASSWORD" ]; then
    # POSIX 随机：/dev/urandom + od，免依赖 openssl
    PROMA_ADMIN_PASSWORD="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
    echo "=========================================================="
    echo "[Proma] 首次启动：已生成随机 admin 密码（请妥善保存）："
    echo "[Proma]   $PROMA_ADMIN_PASSWORD"
    echo "[Proma] 后续重启不会再次显示，登录后请尽快修改。"
    echo "=========================================================="
  else
    echo "[Proma] 使用 PROMA_ADMIN_PASSWORD 环境变量初始化 admin 密码"
  fi

  # 格式与 index.ts hint 一致：{"adminPassword":"...","enabled":false}
  # 密码串只含 hex 字符，无需 JSON 转义
  printf '{"adminPassword":"%s","enabled":false}\n' "$PROMA_ADMIN_PASSWORD" > "$SETTINGS_FILE"
fi

# exec 让 CMD（bun ...）成为 PID 1，正确响应 SIGTERM
exec "$@"
