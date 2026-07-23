import type { ElectronAPI } from './types'
import { createHttpClient, type ShimConfig } from './http-client'

/**
 * 已迁移方法注册表
 *
 * 结构：方法名 → 实现（走 invoke）。
 *   每完成一个域的迁移：
 *     1. 在此登记方法实现；
 *     2. 在 docs/plans/api-migration-board.md 将对应通道状态标「已迁移」。
 *
 * 迭代 0 仅登记 listAgentSessions，用于打通端到端链路（见计划 §3.5）。
 */
export function createMigrated(config: ShimConfig): Partial<ElectronAPI> {
  const invoke = createHttpClient(config.apiBase)

  return {
    // Agent 会话列表：POST /api/agent:list-sessions → AgentSessionMeta[]
    listAgentSessions: () => invoke('agent:list-sessions'),
  } as Partial<ElectronAPI>
}

/**
 * 已迁移方法名集合
 * 供 Proxy 快速判断，亦可作为看板自动校验来源
 */
export const migratedNames: ReadonlySet<string> = new Set(['listAgentSessions'])
