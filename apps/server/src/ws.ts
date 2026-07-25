/**
 * Proma Server WebSocket 推送（生产级）
 *
 * M2 迭代 3：事件缓冲 / 多连接广播 / 断线重连事件补偿。
 *
 * 协议：
 * - 客户端 → 服务端：
 *   { type: 'subscribe', sessionId, lastEventId? }   订阅指定会话（'*' 表示全部）
 *   { type: 'unsubscribe', sessionId }                取消订阅
 *
 * - 服务端 → 客户端：
 *   { id, sessionId, channel, payload, timestamp }    带全局序号的事件帧
 *
 * M2 单用户：renderer 启动时 subscribe '*' 接收所有会话事件。
 * M3 多用户：按需订阅具体 sessionId。
 */

import type { ServerWebSocket } from 'bun'

// ===== 类型 =====

/** 缓冲事件 */
interface BufferedEvent {
  /** 全局单调递增序号 */
  id: number
  /** 事件通道 */
  channel: string
  /** 所属会话（全局事件为 '*'） */
  sessionId: string
  /** 事件负载 */
  payload: unknown
  /** 时间戳 */
  timestamp: number
}

/** 客户端上行消息 */
interface WsMessage {
  type: 'subscribe' | 'unsubscribe'
  sessionId: string
  lastEventId?: number
}

/** 连接状态 */
interface WsState {
  /** 已订阅的 sessionId 集合（'*' 表示全部） */
  sessions: Set<string>
}

// ===== 常量 =====

/** 每会话最大缓冲条数 */
const BUFFER_MAX_EVENTS = 500
/** 缓冲最大存活时间（ms） */
const BUFFER_MAX_AGE_MS = 60_000
/** 会话完成后缓冲延迟清理时间（ms） */
const BUFFER_CLEANUP_DELAY_MS = 5 * 60_000
/** 全局事件缓冲最大条数 */
const GLOBAL_BUFFER_MAX = 200

// ===== 状态 =====

/** 全局事件序号 */
let seq = 0

/** 按 sessionId 的环形事件缓冲（'*' 键为全局事件缓冲） */
const buffers = new Map<string, BufferedEvent[]>()

/** 会话 → 连接集合（多 tab / 多设备） */
const sessionConnections = new Map<string, Set<ServerWebSocket<WsState>>>()

/** 所有活跃连接 */
const allConnections = new Set<ServerWebSocket<WsState>>()

/** 延迟清理定时器 */
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

// ===== 核心函数 =====

/** 追加事件到环形缓冲 */
function appendToBuffer(key: string, event: BufferedEvent, maxEvents: number): void {
  let buf = buffers.get(key)
  if (!buf) {
    buf = []
    buffers.set(key, buf)
  }
  buf.push(event)

  // 淘汰策略：超过上限或过老的事件
  const cutoff = Date.now() - BUFFER_MAX_AGE_MS
  while (buf.length > maxEvents || (buf.length > 0 && buf[0]!.timestamp < cutoff)) {
    buf.shift()
  }
}

/** 序列化事件帧 */
function serializeEvent(event: BufferedEvent): string {
  return JSON.stringify(event)
}

/** 向指定会话的所有连接广播 */
function broadcastToSession(sessionId: string, frame: string): void {
  const connections = sessionConnections.get(sessionId)
  if (!connections) return
  for (const ws of connections) {
    try {
      ws.send(frame)
    } catch (err) {
      console.error('[WS] 推送失败:', err)
    }
  }
}

/** 补发 lastEventId 之后的事件（从指定缓冲） */
function replayFrom(bufferKey: string, lastEventId: number, ws: ServerWebSocket<WsState>): void {
  const buf = buffers.get(bufferKey)
  if (!buf) return
  const missed = buf.filter((e) => e.id > lastEventId)
  for (const event of missed) {
    try {
      ws.send(serializeEvent(event))
    } catch (err) {
      console.error('[WS] replay 推送失败:', err)
    }
  }
  if (missed.length > 0) {
    console.log(`[WS] replay: buffer=${bufferKey}, lastEventId=${lastEventId}, 补发 ${missed.length} 条`)
  }
}

// ===== 对外接口 =====

/**
 * 生产级 StreamSink：缓冲 + 多连接广播
 *
 * 由 engine.ts 实例化并注入 server-core。
 * eventBus 中间件将 AgentStreamPayload 转发到此处。
 */
export class WsStreamSink {
  /**
   * 发射事件：缓冲 + 广播
   *
   * @param sessionId 会话 ID（全局事件传 '*'）
   * @param payload 事件负载
   * @param channel 事件通道（默认按 payload 推断）
   */
  emit(sessionId: string, payload: unknown, channel?: string): void {
    const resolvedChannel = channel ?? this.inferChannel(payload)
    const event: BufferedEvent = {
      id: ++seq,
      channel: resolvedChannel,
      sessionId,
      payload,
      timestamp: Date.now(),
    }

    const frame = serializeEvent(event)

    // 追加到会话缓冲
    appendToBuffer(sessionId, event, BUFFER_MAX_EVENTS)
    // 同时追加到全局缓冲（供 '*' 订阅者 replay）
    appendToBuffer('*', event, GLOBAL_BUFFER_MAX)

    // 广播到该会话的订阅者
    broadcastToSession(sessionId, frame)
    // 广播到通配符 '*' 订阅者（M2 单用户全量接收）
    if (sessionId !== '*') {
      broadcastToSession('*', frame)
    }

    // 会话完成/错误后安排延迟清理
    const p = payload as { type?: string; kind?: string; event?: { type?: string } }
    const eventType = p.type ?? p.event?.type
    if (eventType === 'stream-complete' || eventType === 'stream-error' || eventType === 'complete' || eventType === 'error') {
      this.scheduleCleanup(sessionId)
    }
  }

  /** 按 payload 推断 WS 通道 */
  private inferChannel(payload: unknown): string {
    const p = payload as { type?: string; kind?: string }
    // eventBus 事件（sdk_message / proma_event）统一走 stream-event 通道
    // renderer 的 useGlobalAgentListeners 通过 onAgentStreamEvent 接收并分发
    if (p.kind === 'proma_event' || p.kind === 'sdk_message') return 'agent:stream-event'
    // 路由回调事件走独立通道
    switch (p.type) {
      case 'stream-complete': return 'agent:stream-complete'
      case 'stream-error': return 'agent:stream-error'
      case 'title-updated': return 'agent:title-updated'
      case 'run-started': return 'agent:run-started'
      default: return 'agent:stream-event'
    }
  }

  /** 延迟清理已完成会话的缓冲 */
  private scheduleCleanup(sessionId: string): void {
    if (cleanupTimers.has(sessionId)) return
    cleanupTimers.set(sessionId, setTimeout(() => {
      buffers.delete(sessionId)
      cleanupTimers.delete(sessionId)
      console.log(`[WS] 清理会话缓冲: ${sessionId}`)
    }, BUFFER_CLEANUP_DELAY_MS))
  }
}

/** 全局 StreamSink 实例 */
export const wsStreamSink = new WsStreamSink()

// ===== Bun WebSocket 处理器 =====

export const websocketHandlers = {
  open(ws: ServerWebSocket<WsState>) {
    ws.data.sessions = new Set()
    allConnections.add(ws)
    console.log('[WS] 新连接建立')
  },

  message(ws: ServerWebSocket<WsState>, message: string | Buffer) {
    try {
      const msg = JSON.parse(message.toString()) as WsMessage

      if (msg.type === 'subscribe') {
        const sessionId = msg.sessionId
        if (!sessionId) return

        ws.data.sessions.add(sessionId)
        if (!sessionConnections.has(sessionId)) {
          sessionConnections.set(sessionId, new Set())
        }
        sessionConnections.get(sessionId)!.add(ws)

        // 断线重连事件补偿
        if (typeof msg.lastEventId === 'number' && msg.lastEventId > 0) {
          // '*' 订阅者从全局缓冲 replay；具体会话从会话缓冲 replay
          replayFrom(sessionId === '*' ? '*' : sessionId, msg.lastEventId, ws)
        }

        console.log(`[WS] 订阅: ${sessionId}${msg.lastEventId ? ` (lastEventId=${msg.lastEventId})` : ''}`)
      } else if (msg.type === 'unsubscribe') {
        const sessionId = msg.sessionId
        if (!sessionId) return
        ws.data.sessions.delete(sessionId)
        sessionConnections.get(sessionId)?.delete(ws)
        console.log(`[WS] 取消订阅: ${sessionId}`)
      }
    } catch (err) {
      console.error('[WS] 消息解析失败:', err)
    }
  },

  close(ws: ServerWebSocket<WsState>) {
    allConnections.delete(ws)
    for (const sessionId of ws.data.sessions) {
      sessionConnections.get(sessionId)?.delete(ws)
    }
    console.log('[WS] 连接关闭')
  },
}
