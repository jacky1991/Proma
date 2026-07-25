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
import { NodeAesGcmCryptoProvider, createNodeEnvProbe } from '@proma/server-core/node'
import { wsStreamSink } from './ws'

// ===== 注入服务端端口实现 =====

configureServerCore({
  crypto: new NodeAesGcmCryptoProvider(),
  envProbe: createNodeEnvProbe(),
  streamSink: wsStreamSink,
})

// ===== 引擎实例 =====

const eventBus = new AgentEventBus()
const adapter = new PiAgentAdapter()  // M2 仅 Pi runtime
const orchestrator = new AgentOrchestrator(adapter, eventBus)

// ===== eventBus → WsStreamSink 中间件 =====
// 将 orchestrator 发出的所有 AgentStreamPayload 转发到 WS 推送层

eventBus.use((sessionId, payload, next) => {
  wsStreamSink.emit(sessionId, payload)
  next()
})

export { eventBus, adapter, orchestrator, wsStreamSink as streamSink }
