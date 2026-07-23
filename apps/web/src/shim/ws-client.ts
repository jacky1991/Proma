import type { ShimConfig } from './http-client'

/**
 * WebSocket 订阅客户端骨架
 *
 * 契约：shim 将 onXxx(callback) → () => unsubscribe 映射为单条 WS 连接上的 channel 多路复用。
 *
 * 本迭代为骨架：不建立真实连接，所有订阅返回 noop unsubscribe。
 *   真实 WS 推送（AgentEventBus → server → client）在 M2 迭代 3 落地，
 *   届时启用 Bun.serve({ websocket }) 并按 channel 分发。
 */

export type Unsubscribe = () => void

export interface WsClient {
  /** 订阅指定通道，返回取消订阅函数 */
  on: (channel: string, cb: (payload: unknown) => void) => Unsubscribe
  /** 关闭底层连接 */
  close: () => void
}

export function createWsClient(_config: ShimConfig): WsClient {
  // TODO（M2 迭代 3）：建立单条 WebSocket，按 channel 多路复用
  return {
    on: (_channel, _cb) => () => {},
    close: () => {},
  }
}
