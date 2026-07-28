/**
 * Chat 工具注册表（server-core）
 *
 * 管理所有可用的 Chat 工具元数据：
 * - 内置工具（联网搜索、Agent 模式推荐）
 * - 自定义工具（用户配置的 HTTP 工具）
 *
 * 提供统一接口获取工具列表（供路由层和 Electron 端共用）。
 */

import type { ChatToolInfo, ChatToolMeta } from '@proma/shared'
import { getChatToolsConfig } from './chat-tool-config'

// ===== 内置工具元数据 =====

export const BUILTIN_TOOL_METAS: ChatToolMeta[] = [
  {
    id: 'web-search',
    name: '联网搜索',
    description: '实时搜索互联网获取最新信息',
    params: [{ name: 'query', type: 'string', description: '搜索查询', required: true }],
    icon: 'Globe',
    category: 'builtin',
    executorType: 'builtin',
  },
  {
    id: 'agent-mode-recommend',
    name: 'Agent 模式推荐',
    description: '智能识别适合 Agent 模式的任务，推荐用户切换',
    params: [
      { name: 'reason', type: 'string', description: '推荐理由', required: true },
      { name: 'suggestedPrompt', type: 'string', description: '建议的 Agent 初始提示词', required: true },
    ],
    icon: 'Sparkles',
    category: 'builtin',
    executorType: 'builtin',
  },
]

/** 检查内置工具是否可用（凭据已配置） */
function checkBuiltinAvailable(toolId: string, credentials: Record<string, string>): boolean {
  // agent-mode-recommend 无需凭据，始终可用
  if (toolId === 'agent-mode-recommend') return true
  // web-search 需要 apiKey
  return !!credentials.apiKey
}

/**
 * 获取所有工具信息（内置 + 自定义）
 *
 * 返回所有工具的元数据、开关状态和可用性，供前端展示。
 */
export function getAllToolInfos(): ChatToolInfo[] {
  const config = getChatToolsConfig()
  const infos: ChatToolInfo[] = []

  // 内置工具
  for (const meta of BUILTIN_TOOL_METAS) {
    const state = config.toolStates[meta.id]
    const credentials = config.toolCredentials[meta.id] ?? {}
    infos.push({
      meta,
      enabled: state?.enabled ?? false,
      available: checkBuiltinAvailable(meta.id, credentials),
    })
  }

  // 自定义工具
  for (const customMeta of config.customTools) {
    const state = config.toolStates[customMeta.id]
    infos.push({
      meta: customMeta,
      enabled: state?.enabled ?? false,
      available: !!customMeta.httpConfig,
    })
  }

  return infos
}
