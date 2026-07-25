/**
 * EventBus — 进程内发布/订阅事件总线
 *
 * 用于 Bridge 层向 UI 推送实时事件（打字指示器、在线状态、消息送达等）。
 * 纯内存实现，无持久化，进程退出即消失。
 */

/** 事件负载基础约束：必须是可 JSON 序列化的纯数据 */
export type EventPayload = Record<string, unknown>

/** 事件监听器 */
export type EventListener<T extends EventPayload = EventPayload> = (payload: T) => void

/** 取消订阅函数 */
export type Unsubscribe = () => void

/**
 * 进程内事件总线
 *
 * 用法：
 * ```ts
 * const bus = new EventBus()
 * const off = bus.on('typing', (p) => console.log(p))
 * bus.emit('typing', { conversationId: 'c1', userId: 'u1' })
 * off() // 取消订阅
 * ```
 */
export class EventBus {
  private listeners = new Map<string, Set<EventListener>>()

  /**
   * 订阅指定类型的事件
   * @returns 取消订阅函数
   */
  on<T extends EventPayload>(type: string, listener: EventListener<T>): Unsubscribe {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener as EventListener)

    return () => {
      set!.delete(listener as EventListener)
      if (set!.size === 0) this.listeners.delete(type)
    }
  }

  /**
   * 发布事件，同步通知所有该类型的监听器
   *
   * 单个监听器抛错不影响其他监听器（捕获并打印错误）
   */
  emit<T extends EventPayload>(type: string, payload: T): void {
    const set = this.listeners.get(type)
    if (!set) return
    for (const listener of set) {
      try {
        listener(payload)
      } catch (err) {
        console.error(`[EventBus] 监听器执行失败 (type=${type}):`, err)
      }
    }
  }

  /** 移除指定类型的所有监听器；不传参数则清空全部 */
  off(type?: string): void {
    if (type) {
      this.listeners.delete(type)
    } else {
      this.listeners.clear()
    }
  }

  /** 当前指定类型的监听器数量（调试用） */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }
}
