/**
 * Proma Server 引擎 Bootstrap
 *
 * 实例化 Agent 引擎核心组件（EventBus / Adapter / Orchestrator），
 * 替代 Electron 端 agent-service.ts 的 IPC 层。
 *
 * M2 迭代 3：eventBus 中间件将 AgentStreamPayload 转发到 WsStreamSink，
 * 实现事件缓冲 + 多连接广播 + 断线重连补偿。
 */

import '@proma/server-core/node'  // 注册降级默认依赖（AES-GCM / Node EnvProbe）
import { configureServerCore } from '@proma/server-core'
import { AgentEventBus } from '@proma/server-core/agent-event-bus'
import { AgentOrchestrator } from '@proma/server-core/agent-orchestrator'
import { PiAgentAdapter } from '@proma/server-core/adapters/pi-agent-adapter'
import type { PiBuiltinToolDeps } from '@proma/server-core/adapters/pi-builtin-tools'
import { buildWebTools } from '@proma/server-core/adapters/pi-web-tools'
import { isWebSearchEnabledForAgent } from '@proma/server-core/web-search-service'
import { NodeAesGcmCryptoProvider, createNodeEnvProbe } from '@proma/server-core/node'
import { wsStreamSink } from './ws'
import { startWorkspaceWatcher } from './workspace-watcher'
import { startChatToolsWatcher } from './chat-tools-watcher'
import { startScheduler } from './automation-scheduler'
import { createLogger } from '@proma/server-core/logger'

/** 模块日志器 */
const logger = createLogger('引擎')

// ===== 注入服务端端口实现 =====

configureServerCore({
  crypto: new NodeAesGcmCryptoProvider(),
  envProbe: createNodeEnvProbe(),
  streamSink: wsStreamSink,
})

// ===== 引擎实例 =====

const eventBus = new AgentEventBus()
const adapter = new PiAgentAdapter()  // M2 仅 Pi runtime

/**
 * 内置工具依赖注入
 *
 * web-search 已注入：buildWebTools（WebSearch/WebFetch，Tavily 实现）+ isWebSearchEnabled。
 * 开关 + 凭据齐全时，buildPiBuiltinTools 自动将其注册到 Pi runtime，Agent 工具列表可见。
 *
 * 仍未注入：
 * - automation：注入定时任务触发器（automation-scheduler 已服务端化，见 apps/server/src/automation-scheduler.ts；agent 内置工具注入仍待后续）
 * - collaboration：评估是否为 IM bridge 相关（已 🚫 Out），若是则不注入
 */
const piBuiltinToolDeps: PiBuiltinToolDeps = {
  // web-search：注入 Tavily 实现的 WebSearch/WebFetch（开关 + 凭据齐全时由 buildPiBuiltinTools 注册）
  buildWebTools,
  isWebSearchEnabled: isWebSearchEnabledForAgent,
}
logger.info('内置工具依赖: web-search 已注入；automation / collaboration 未注入（Agent 执行时不可用）')

const orchestrator = new AgentOrchestrator(adapter, eventBus, { piBuiltinToolDeps })

// ===== eventBus → WsStreamSink 中间件 =====
// 将 orchestrator 发出的所有 AgentStreamPayload 转发到 WS 推送层

eventBus.use((sessionId, payload, next, ownerUserId) => {
  // ownerUserId 由编排层按会话归属（scope.userId）透传，WS 层据此对 '*' 广播按用户过滤
  wsStreamSink.emit(sessionId, payload, undefined, ownerUserId)
  next()
})

export { eventBus, adapter, orchestrator, wsStreamSink as streamSink }

// ===== 工作区文件监听 → WS 广播 =====
// 监听工作区目录变化，广播 capabilities-changed / workspace-files-changed 事件

startWorkspaceWatcher(wsStreamSink)
startChatToolsWatcher(wsStreamSink)

// ===== 定时任务调度器 → 自动到期触发 =====
// 注入 orchestrator + wsStreamSink；手动 run-now 走 automation 路由调 runAutomationNow
startScheduler(orchestrator, wsStreamSink)
