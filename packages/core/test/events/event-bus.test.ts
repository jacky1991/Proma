import { test, expect, describe } from 'bun:test'
import { EventBus } from '../../src/events/event-bus.ts'

describe('EventBus', () => {
  test('emit 触发已订阅的监听器', () => {
    const bus = new EventBus()
    const received: unknown[] = []
    bus.on('typing', (p) => received.push(p))

    bus.emit('typing', { conversationId: 'c1' })

    expect(received).toEqual([{ conversationId: 'c1' }])
  })

  test('不同 type 互不干扰', () => {
    const bus = new EventBus()
    const typingEvents: unknown[] = []
    const presenceEvents: unknown[] = []
    bus.on('typing', (p) => typingEvents.push(p))
    bus.on('presence', (p) => presenceEvents.push(p))

    bus.emit('typing', { userId: 'u1' })

    expect(typingEvents).toHaveLength(1)
    expect(presenceEvents).toHaveLength(0)
  })

  test('unsubscribe 后不再收到事件', () => {
    const bus = new EventBus()
    const received: unknown[] = []
    const off = bus.on('typing', (p) => received.push(p))

    bus.emit('typing', { n: 1 })
    off()
    bus.emit('typing', { n: 2 })

    expect(received).toEqual([{ n: 1 }])
  })

  test('同一监听器不会重复触发（Set 语义）', () => {
    const bus = new EventBus()
    let count = 0
    const listener = () => { count++ }
    bus.on('x', listener)
    bus.on('x', listener) // 重复订阅同一引用

    bus.emit('x', {})

    expect(count).toBe(1)
  })

  test('监听器抛错不影响其他监听器', () => {
    const bus = new EventBus()
    const received: unknown[] = []
    bus.on('x', () => { throw new Error('boom') })
    bus.on('x', (p) => received.push(p))

    bus.emit('x', { ok: true })

    expect(received).toEqual([{ ok: true }])
  })

  test('off(type) 移除该类型全部监听器', () => {
    const bus = new EventBus()
    let count = 0
    bus.on('x', () => { count++ })
    bus.on('x', () => { count++ })

    bus.off('x')
    bus.emit('x', {})

    expect(count).toBe(0)
    expect(bus.listenerCount('x')).toBe(0)
  })

  test('off() 无参数清空所有监听器', () => {
    const bus = new EventBus()
    bus.on('a', () => {})
    bus.on('b', () => {})

    bus.off()

    expect(bus.listenerCount('a')).toBe(0)
    expect(bus.listenerCount('b')).toBe(0)
  })

  test('listenerCount 返回正确数量', () => {
    const bus = new EventBus()
    expect(bus.listenerCount('x')).toBe(0)

    const off1 = bus.on('x', () => {})
    bus.on('x', () => {})
    expect(bus.listenerCount('x')).toBe(2)

    off1()
    expect(bus.listenerCount('x')).toBe(1)
  })

  test('unsubscribe 最后一个监听器后自动清理 type 条目', () => {
    const bus = new EventBus()
    const off = bus.on('x', () => {})
    off()

    // 内部 Map 应已删除该 key，listenerCount 为 0
    expect(bus.listenerCount('x')).toBe(0)
  })
})
