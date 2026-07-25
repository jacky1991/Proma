import type { ShimConfig } from './http-client'

/**
 * WebSocket 订阅客户端（生产级）
 *
 * M2 迭代 3：断线重连 + lastEventId 事件补偿。
 *
 * 协议：
 * - 上行：{ type: 'subscribe', sessionId: '*', lastEventId? }
 * - 下行：{ id, sessionId, channel, payload, timestamp }
 *
 * M2 单用户：启动时订阅 '*' 接收所有会话事件，按 channel 分发到 renderer 回调。
 * 对 renderer 透明：onXxx(cb) 接口不变，内部处理重连 / 补偿。
 */

export type Unsubscribe = () => void

export interface WsClient {
  /** 订阅指定通道，返回取消订阅函数 */
  on: (channel: string, cb: (payload: unknown) => void) => Unsubscribe
  /** 关闭底层连接 */
  close: () => void
}

/** 简单指数退避重连 */
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 30000

/**
 * 将相对或绝对 wsBase 解析为浏览器可用的绝对 WebSocket URL。
 */
function resolveWsUrl(config: ShimConfig): string {
  if (config.wsBase?.startsWith('ws')) return config.wsBase
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = config.wsBase ?? '/ws'
  return `${proto}//${location.host}${path}`
}

export function createWsClient(config: ShimConfig): WsClient {
  const wsUrl = resolveWsUrl(config)

  let ws: WebSocket | null = null
  let reconnectDelay = RECONNECT_BASE_DELAY
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let subscribed = false

  /** 全局最后收到的事件 id（用于重连补偿） */
  let lastEventId = 0

  // channel → callbacks（renderer 注册的回调）
  const subscriptions = new Map<string, Set<(payload: unknown) => void>>()

  function connect() {
    if (closed) return

    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[WS] 连接建立')
      reconnectDelay = RECONNECT_BASE_DELAY

      // 订阅所有会话事件（携带 lastEventId 进行事件补偿）
      if (subscriptions.size > 0) {
        ws?.send(JSON.stringify({
          type: 'subscribe',
          sessionId: '*',
          lastEventId: lastEventId > 0 ? lastEventId : undefined,
        }))
        subscribed = true
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          id: number
          sessionId: string
          channel: string
          payload: unknown
          timestamp: number
        }

        // 更新全局 lastEventId
        if (msg.id > lastEventId) {
          lastEventId = msg.id
        }

        // 分发到对应 channel 的回调
        const callbacks = subscriptions.get(msg.channel)
        if (callbacks) {
          for (const cb of callbacks) {
            cb(msg.payload)
          }
        }
      } catch (err) {
        console.error('[WS] 消息解析失败:', err)
      }
    }

    ws.onclose = () => {
      console.log('[WS] 连接关闭')
      ws = null
      subscribed = false
      scheduleReconnect()
    }

    ws.onerror = (err) => {
      console.error('[WS] 连接错误:', err)
      ws?.close()
    }
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      console.log(`[WS] 尝试重连（延迟 ${reconnectDelay}ms）`)
      connect()
      // 指数退避
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY)
    }, reconnectDelay)
  }

  /** 确保已发送 subscribe '*' */
  function ensureSubscribed() {
    if (subscribed) return
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        sessionId: '*',
        lastEventId: lastEventId > 0 ? lastEventId : undefined,
      }))
      subscribed = true
    }
  }

  // 初始连接
  connect()

  return {
    on(channel: string, cb: (payload: unknown) => void): Unsubscribe {
      if (!subscriptions.has(channel)) {
        subscriptions.set(channel, new Set())
        // 首次注册任何通道时，发送 subscribe
        ensureSubscribed()
      }
      subscriptions.get(channel)!.add(cb)

      return () => {
        const callbacks = subscriptions.get(channel)
        if (callbacks) {
          callbacks.delete(cb)
          if (callbacks.size === 0) {
            subscriptions.delete(channel)
          }
        }
      }
    },

    close() {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      ws?.close()
      ws = null
      subscriptions.clear()
      lastEventId = 0
      subscribed = false
    },
  }
}
