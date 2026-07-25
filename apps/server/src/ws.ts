/**
 * Proma Server WebSocket 推送（生产级）
 *
 * M2 迭代 3：事件缓冲 / 多连接广播 / 断线重连事件补偿。
 * M2.5 迭代 6：文本 delta 聚合（50ms 窗口）+ 超长工具输出截断。
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
/** 文本 delta 聚合窗口（ms） */
const AGGREGATION_WINDOW_MS = 50
/** 工具输出截断阈值（字节） */
const TOOL_OUTPUT_MAX_BYTES = 10 * 1024
/** 是否启用 WS 聚合（可通过环境变量关闭） */
const WS_AGGREGATION_ENABLED = process.env.WS_AGGREGATION_ENABLED !== 'false'

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

// ===== 文本 Delta 聚合器 =====

/**
 * 文本 delta 聚合器：50ms 窗口内连续 text delta 合并为 text_batch 帧。
 *
 * - 仅聚合 proma_event 中 type='text' 的 delta 事件
 * - 非文本事件（tool_start / tool_result / done / error）立即发送
 * - 会话完成（done / error）时立即 flush 剩余缓冲
 * - 可通过 WS_AGGREGATION_ENABLED=false 环境变量关闭
 */
class TextDeltaAggregator {
  /** sessionId → 待聚合的 delta 文本数组 */
  private pending = new Map<string, string[]>()
  /** sessionId → 原始事件元数据（channel 等，用于 flush 时重建帧） */
  private meta = new Map<string, { channel: string }>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private sink: WsStreamSink) {
    if (WS_AGGREGATION_ENABLED) {
      this.timer = setInterval(() => this.flush(), AGGREGATION_WINDOW_MS)
    }
  }

  /**
   * 尝试聚合一个事件。
   * 返回 true 表示已聚合（调用方不再直接发送），false 表示需立即发送。
   */
  tryAggregate(sessionId: string, payload: unknown, channel: string): boolean {
    if (!WS_AGGREGATION_ENABLED) return false

    const p = payload as { kind?: string; event?: { type?: string; text?: string } }
    // 仅聚合 proma_event 中 type='text' 的 delta
    if (p.kind !== 'proma_event' || p.event?.type !== 'text' || typeof p.event?.text !== 'string') {
      return false
    }

    const buf = this.pending.get(sessionId) ?? []
    buf.push(p.event.text)
    this.pending.set(sessionId, buf)
    this.meta.set(sessionId, { channel })
    return true
  }

  /** 立即 flush 指定会话的缓冲（会话完成/错误时调用） */
  flushSession(sessionId: string): void {
    const deltas = this.pending.get(sessionId)
    if (!deltas || deltas.length === 0) return
    this.emitBatch(sessionId, deltas)
    this.pending.delete(sessionId)
    this.meta.delete(sessionId)
  }

  /** 定时 flush 所有会话的缓冲 */
  private flush(): void {
    for (const [sessionId, deltas] of this.pending) {
      if (deltas.length === 0) continue
      this.emitBatch(sessionId, deltas)
    }
    this.pending.clear()
    this.meta.clear()
  }

  /** 发射聚合后的 text_batch 事件 */
  private emitBatch(sessionId: string, deltas: string[]): void {
    const meta = this.meta.get(sessionId)
    const channel = meta?.channel ?? 'agent:stream-event'

    if (deltas.length === 1) {
      // 单条 delta 无需 batch，直接作为普通 text 事件发送
      this.sink.emitRaw(sessionId, {
        kind: 'proma_event',
        event: { type: 'text', text: deltas[0] },
      }, channel)
    } else {
      // 多条 delta 合并为 text_batch
      this.sink.emitRaw(sessionId, {
        kind: 'proma_event',
        event: { type: 'text_batch', deltas },
      }, channel)
    }
  }

  /** 销毁聚合器 */
  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flush()
  }
}

// ===== 工具输出截断 =====

/**
 * 截断超长工具输出
 *
 * 对 tool_result 类型事件中 stdout / stderr 超过 10KB 时截断，
 * 追加 truncated: true + originalSize 标记。
 */
function truncateToolOutput(payload: unknown): unknown {
  const p = payload as {
    kind?: string
    event?: {
      type?: string
      stdout?: string
      stderr?: string
      truncated?: boolean
      originalSize?: number
    }
  }

  if (p.kind !== 'proma_event' || p.event?.type !== 'tool_result') return payload

  let modified = false
  const event = { ...p.event }

  if (event.stdout && event.stdout.length > TOOL_OUTPUT_MAX_BYTES) {
    event.originalSize = event.stdout.length
    event.stdout = event.stdout.slice(0, TOOL_OUTPUT_MAX_BYTES) + '\n... [输出已截断]'
    event.truncated = true
    modified = true
  }

  if (event.stderr && event.stderr.length > TOOL_OUTPUT_MAX_BYTES) {
    event.originalSize = (event.originalSize ?? 0) + event.stderr.length
    event.stderr = event.stderr.slice(0, TOOL_OUTPUT_MAX_BYTES) + '\n... [输出已截断]'
    event.truncated = true
    modified = true
  }

  if (!modified) return payload
  return { ...p, event }
}

// ===== 对外接口 =====

/**
 * 生产级 StreamSink：缓冲 + 多连接广播 + 文本聚合 + 工具输出截断
 *
 * 由 engine.ts 实例化并注入 server-core。
 * eventBus 中间件将 AgentStreamPayload 转发到此处。
 */
export class WsStreamSink {
  private aggregator = new TextDeltaAggregator(this)

  /**
   * 发射事件：聚合 → 截断 → 缓冲 → 广播
   *
   * @param sessionId 会话 ID（全局事件传 '*'）
   * @param payload 事件负载
   * @param channel 事件通道（默认按 payload 推断）
   */
  emit(sessionId: string, payload: unknown, channel?: string): void {
    const resolvedChannel = channel ?? this.inferChannel(payload)

    // 尝试聚合文本 delta（聚合成功则不直接发送）
    if (this.aggregator.tryAggregate(sessionId, payload, resolvedChannel)) {
      return
    }

    // 会话完成/错误时先 flush 聚合缓冲
    const p = payload as { type?: string; kind?: string; event?: { type?: string } }
    const eventType = p.type ?? p.event?.type
    if (eventType === 'stream-complete' || eventType === 'stream-error' || eventType === 'complete' || eventType === 'error' || eventType === 'done') {
      this.aggregator.flushSession(sessionId)
    }

    // 工具输出截断
    const processedPayload = truncateToolOutput(payload)

    this.emitRaw(sessionId, processedPayload, resolvedChannel)
  }

  /**
   * 直接发射事件（跳过聚合和截断，由聚合器 flush 时调用）
   */
  emitRaw(sessionId: string, payload: unknown, channel?: string): void {
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
    if (p.kind === 'proma_event' || p.kind === 'sdk_message') return 'agent:stream-event'
    // 路由回调事件走独立通道
    switch (p.type) {
      case 'stream-complete': return 'agent:stream-complete'
      case 'stream-error': return 'agent:stream-error'
      case 'title-updated': return 'agent:title-updated'
      case 'run-started': return 'agent:run-started'
      case 'automation-changed': return 'automation:changed'
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
