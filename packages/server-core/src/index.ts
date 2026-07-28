/**
 * @proma/server-core — Proma 核心引擎共享包。
 *
 * 唯一真源：Electron 主进程与 Web 服务端共用本包。从 Electron 主进程剥离的
 * Agent 会话 / 渠道 / 工作区 / 对话管理等核心域逻辑。
 *
 * 零 Electron 依赖：所有 OS/Electron 能力（加密、环境探针、事件推送）经端口注入，
 * 由消费者在启动时调用 configureServerCore(...) 提供。
 *
 * - 主入口（'.'）：纯逻辑 + 类型 + 端口接口 + configure 机制。
 * - 子入口 '@proma/server-core/node'：端口的 Node 默认实现（AES-256-GCM 加密等），
 *   供服务端实例化与冒烟测试；不要从浏览器渲染层导入。
 * - 细粒度模块（如 '@proma/server-core/channel-manager'）：供 Electron 原模块文件 re-export，保持单一真源。
 */

// 端口接口
export * from './ports'

// 依赖注入机制
export {
  configureServerCore,
  getServerCoreDeps,
  getCryptoPort,
  getEnvProbe,
  getStreamSink,
  setDefaultDepsFactory,
  type ServerCoreDeps,
} from './config'

// 核心域模块（迁移完成陆续在此 re-export，便于整体导入）
export * from './safe-file'
export * from './fs-retry'
export * from './office-preview-service'
