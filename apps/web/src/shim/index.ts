import type { PromaClientAPI } from './types'
import type { ShimConfig } from './http-client'
import { createMigrated } from './migrated'
import { safeDefaults, notMigrated } from './stubs'

export type { PromaClientAPI, ShimConfig }

/**
 * 创建 electronAPI shim 实例
 *
 * 通过 Proxy 兜底覆盖全部 ~300 方法（无需逐个声明），按优先级分流：
 *   1. 已迁移（migrated 表）→ 走 HTTP/WS 实现
 *   2. 安全默认（safeDefaults）→ 返回不致 UI 崩溃的空值（纯展示类）
 *   3. 订阅器（onXxx）→ noop unsubscribe（真实 WS 见 M2 迭代 3）
 *   4. 同步方法（xxxSync）→ 降级为 resolve(undefined)（见 sync-shims）
 *   5. getPathForFile（webUtils）→ 返回空串占位
 *   6. 其余 invoke → reject「该能力暂未迁移到 Web 端」（AC-2）
 *
 * 关键：renderer 源码零改动——它读 window.electronAPI.*，拿到的是此 shim。
 */
export function createShim(config: ShimConfig): PromaClientAPI {
  const migrated = createMigrated(config)

  const proxy = new Proxy(migrated as Record<string, unknown>, {
    get(target, prop, receiver) {
      // 非 string 属性（Symbol 等）走默认，避免破坏内置行为
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      // then 显式返回 undefined，避免整个 shim 被误判为 thenable
      if (prop === 'then') return undefined

      // 1. 已迁移：走 HTTP/WS 实现
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop]
      // 2. 安全默认：纯展示类返回不致崩溃的空值
      if (Object.prototype.hasOwnProperty.call(safeDefaults, prop)) return safeDefaults[prop]
      // 3. 订阅器 onXxx：返回 noop unsubscribe
      if (/^on[A-Z]/.test(prop)) return () => () => {}
      // 4. 同步方法 xxxSync：降级为异步 resolve
      if (prop.endsWith('Sync')) return () => Promise.resolve()
      // 5. webUtils 同步语义：浏览器无文件系统
      if (prop === 'getPathForFile') return () => ''
      // 6. 未迁移：reject「暂未迁移」
      return notMigrated(prop)
    },
  })

  return proxy as unknown as PromaClientAPI
}
