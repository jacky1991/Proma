/**
 * server-core 运行时依赖注入
 *
 * 核心域模块不直接 import Electron，而是经端口（CryptoPort / EnvProbe / StreamSink）取能力。
 * 消费者在启动时调用 configureServerCore(...) 注入实现：
 * - Electron 桌面端：注入 SafeStorageCryptoProvider + Electron EnvProbe（app.isPackaged / pkg.version）。
 * - Web 服务端：注入 NodeAesGcmCryptoProvider + Node EnvProbe。
 *
 * 未显式配置时，由 node 子入口注册的降级默认工厂兜底（仅供开发/测试），避免冒烟测试层层传参。
 */

import type { CryptoPort, EnvProbe, StreamSink } from './ports'

export interface ServerCoreDeps {
  /** 加密端口（渠道 API Key 等）。 */
  crypto: CryptoPort
  /** 环境探针（isPackaged / version / openExternal）。 */
  envProbe: EnvProbe
  /** 事件流下沉（可选；M1 manager 层不强用，预留给 M2 orchestrator）。 */
  streamSink?: StreamSink
}

let deps: ServerCoreDeps | null = null
let defaultFactory: (() => ServerCoreDeps) | null = null

/**
 * 注册降级默认依赖工厂。
 * 由 '@proma/server-core/node' 在导入时调用，避免本主入口引入 node:crypto。
 */
export function setDefaultDepsFactory(factory: () => ServerCoreDeps): void {
  defaultFactory = factory
}

/**
 * 注入运行时依赖。Electron / Server 启动时各调用一次。
 * 显式配置优先于降级默认工厂。
 */
export function configureServerCore(d: ServerCoreDeps): void {
  deps = d
}

/** 当前生效的依赖；未配置时回退到降级默认工厂，仍无则抛错。 */
export function getServerCoreDeps(): ServerCoreDeps {
  if (deps) return deps
  if (defaultFactory) {
    deps = defaultFactory()
    console.warn('[server-core] 未显式 configureServerCore，使用降级默认依赖（仅供开发/测试）')
    return deps
  }
  throw new Error(
    '[server-core] 尚未配置运行时依赖。请在启动时调用 configureServerCore(...)，或在 Node 环境导入 @proma/server-core/node 启用降级默认实现。',
  )
}

/** 便捷取值：加密端口。 */
export function getCryptoPort(): CryptoPort {
  return getServerCoreDeps().crypto
}

/** 便捷取值：环境探针。 */
export function getEnvProbe(): EnvProbe {
  return getServerCoreDeps().envProbe
}

/** 便捷取值：事件流下沉（可能为 undefined）。 */
export function getStreamSink(): StreamSink | undefined {
  return getServerCoreDeps().streamSink
}
