/**
 * 服务端版本号解析
 *
 * 优先读 PROMA_SERVER_VERSION 环境变量（与 server-core EnvProbe 约定一致）；
 * 未设置时回退到 @proma/server 包的 package.json 版本（模块加载时读一次缓存）。
 *
 * 用于 /api/health 与 /api/metrics，避免版本硬编码与实际不符（M4 迭代 10）。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let cachedVersion: string | undefined

/** 读取 @proma/server 包版本（首次调用缓存） */
function readPackageVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    // apps/server/src/utils/version.ts → apps/server/package.json
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgPath = join(here, '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    cachedVersion = pkg.version ?? 'unknown'
    return cachedVersion
  } catch {
    return 'unknown'
  }
}

/**
 * 获取服务端版本号
 *
 * PROMA_SERVER_VERSION env 优先；否则回退 package.json 版本。
 */
export function getServerVersion(): string {
  return process.env.PROMA_SERVER_VERSION ?? readPackageVersion()
}
