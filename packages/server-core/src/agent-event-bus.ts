/**
 * AgentEventBus — Agent 事件总线
 *
 * 统一的事件分发中心，支持中间件链扩展。
 *
 * 核心方法：
 * - emit(sessionId, payload): 发射事件，经过中间件链后分发给所有监听器
 * - on(handler): 注册事件监听器，返回取消函数
 * - use(middleware): 注册中间件（事件经过中间件链后再分发）
 */

import type { AgentStreamPayload } from '@proma/shared'

/** 事件监听器 */
export type AgentEventHandler = (sessionId: string, payload: AgentStreamPayload) => void

/** 中间件：可修改事件或执行副作用，调用 next() 继续链路 */
export type AgentEventMiddleware = (
  sessionId: string,
  payload: AgentStreamPayload,
  next: () => void,
  /** 会话归属用户 ID（编排层传入；供 WS 层对 '*' 广播按用户过滤；桌面单用户场景为 undefined） */
  ownerUserId?: string,
) => void

export class AgentEventBus {
  private handlers: Set<AgentEventHandler> = new Set()
  private middlewares: AgentEventMiddleware[] = []

  /**
   * 发射事件
   *
   * 事件依次经过中间件链，最终分发给所有监听器。
   * 中间件可以通过不调用 next() 来拦截事件。
   *
   * @param ownerUserId 会话归属用户 ID（仅透传给中间件，供 WS 推送层做 '*' 广播过滤）
   */
  emit(sessionId: string, payload: AgentStreamPayload, ownerUserId?: string): void {
    const dispatch = (): void => {
      for (const handler of this.handlers) {
        try {
          handler(sessionId, payload)
        } catch (error) {
          console.error(`[AgentEventBus] 事件处理器错误:`, error)
        }
      }
    }

    if (this.middlewares.length === 0) {
      dispatch()
      return
    }

    // 构建中间件链：从最后一个中间件开始，逐层包装
    let index = this.middlewares.length - 1
    let chain = dispatch

    while (index >= 0) {
      const mw = this.middlewares[index]!
      const next = chain
      chain = () => {
        try {
          mw(sessionId, payload, next, ownerUserId)
        } catch (error) {
          console.error(`[AgentEventBus] 中间件错误:`, error)
          next()
        }
      }
      index--
    }

    try {
      chain()
    } catch (error) {
      console.error(`[AgentEventBus] 事件分发错误:`, error)
    }
  }

  /** 注册事件监听器，返回取消注册函数 */
  on(handler: AgentEventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /** 注册中间件（按注册顺序执行） */
  use(middleware: AgentEventMiddleware): void {
    this.middlewares.push(middleware)
  }

  /** 移除所有监听器和中间件 */
  dispose(): void {
    this.handlers.clear()
    this.middlewares = []
  }
}
