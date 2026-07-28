/**
 * stopByUser 单元测试（BDD，纯单测，不启动 HTTP 服务）
 *
 * 覆盖 M4 迭代 9 验收标准 AC-10（删除用户终止运行中会话）的核心逻辑。
 *
 * 降级说明：在 E2E 中稳定构造「运行中的真实 SDK 会话」需要有效 LLM 渠道与 hang 住的
 * 流式响应，易抖动。故按任务约定降级为对 stopByUser 的白盒单元断言：
 * 直接驱动编排器的归属表（sessionOwners）与活跃表（activeSessions），
 * 验证其「仅终止归属该用户且活跃的会话、正确计数、并调用 adapter.abort」的契约。
 * E2E 侧的删除编排顺序（stopByUser → disconnectUser → deleteUser）由
 * tests/e2e/user-lifecycle.test.ts 的 AC-9 / AC-11 间接保障。
 */

import { test, expect } from 'bun:test'
import { AgentOrchestrator } from '@proma/server-core/agent-orchestrator'
import { AgentEventBus } from '@proma/server-core/agent-event-bus'
import type { AgentProviderAdapter } from '@proma/shared'

/**
 * 白盒测试接口：仅暴露 stopByUser 契约所需的内部结构。
 * 不使用 any；sessionOwners / activeSessions 的实际类型即 Map<string, string> / Map<string, number>。
 */
interface StopByUserTestable {
  sessionOwners: Map<string, string>
  activeSessions: Map<string, number>
  stopByUser(userId: string): number
}

/** 将编排器视为可驱动内部状态的可测对象 */
function asTestable(orchestrator: AgentOrchestrator): StopByUserTestable {
  return orchestrator as unknown as StopByUserTestable
}

/** 记录 abort 调用的桩适配器（stop 内部会调 adapter.abort） */
function createRecordingAdapter(aborted: string[]): AgentProviderAdapter {
  return {
    abort: (sessionId: string) => {
      aborted.push(sessionId)
    },
  } as unknown as AgentProviderAdapter
}

test('AC-10 stopByUser：仅终止归属该用户且活跃的会话，并正确计数', () => {
  const aborted: string[] = []
  const orchestrator = new AgentOrchestrator(createRecordingAdapter(aborted), new AgentEventBus())
  const internal = asTestable(orchestrator)

  // 构造归属与活跃状态：
  // - s1: alice 所有 + 活跃      → 应被终止
  // - s2: alice 所有 + 非活跃    → 不终止（历史会话，随数据目录级联清理）
  // - s3: bob 所有 + 活跃        → 不终止（非目标用户）
  internal.sessionOwners.set('s1', 'alice')
  internal.sessionOwners.set('s2', 'alice')
  internal.sessionOwners.set('s3', 'bob')
  internal.activeSessions.set('s1', 1)
  internal.activeSessions.set('s3', 1)

  const stopped = internal.stopByUser('alice')

  // 计数：仅 s1 命中（alice 所有且活跃）
  expect(stopped).toBe(1)
  // adapter.abort 仅对 s1 调用
  expect(aborted).toEqual(['s1'])
  // s1 已移出活跃表（stop 的副作用），s3 不受影响仍活跃
  expect(internal.activeSessions.has('s1')).toBe(false)
  expect(internal.activeSessions.has('s3')).toBe(true)
})

test('AC-10 stopByUser：目标用户无活跃会话时返回 0 且不触发 abort', () => {
  const aborted: string[] = []
  const orchestrator = new AgentOrchestrator(createRecordingAdapter(aborted), new AgentEventBus())
  const internal = asTestable(orchestrator)

  // 仅有非活跃会话归属 alice
  internal.sessionOwners.set('s2', 'alice')

  expect(internal.stopByUser('alice')).toBe(0)
  expect(aborted).toEqual([])
})
