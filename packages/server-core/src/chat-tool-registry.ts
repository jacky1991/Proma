/**
 * Chat 工具注册表（server-core）
 *
 * 管理所有可用的 Chat 工具元数据：
 * - 内置工具（联网搜索）
 * - 自定义工具（用户配置的 HTTP 工具）
 *
 * 提供统一接口获取工具列表（供路由层和 Electron 端共用）。
 */

import type { ChatToolInfo, ChatToolMeta } from '@proma/shared'
import type { ToolDefinition } from '@proma/core'
import { getChatToolsConfig } from './chat-tool-config'
import { WEB_SEARCH_TOOL_DEFINITIONS, WEB_SEARCH_TOOL_META } from './chat-tools/web-search-tool'

// ===== 内置工具元数据 =====

/**
 * 内置工具元数据列表（供前端展示）。
 * 单源：直接复用各工具模块的 META，避免元数据漂移。
 */
export const BUILTIN_TOOL_METAS: ChatToolMeta[] = [WEB_SEARCH_TOOL_META]

/** 检查内置工具是否可用（凭据已配置） */
function checkBuiltinAvailable(credentials: Record<string, string>): boolean {
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
      available: checkBuiltinAvailable(credentials),
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

// ===== 启用工具收集（供 chat-service 注入 Provider function calling）=====

export interface EnabledToolsResult {
  tools: ToolDefinition[] | undefined
  systemPromptAppend: string | undefined
}

/**
 * 获取已启用且可用的工具定义 + 系统提示词追加
 *
 * 供 chat-service 注入 Provider 的 function calling。单次读配置（getChatToolsConfig），
 * 同时判断开关与凭据，避免可用性检查二次读文件。
 *
 * 注意：本次只注册 web-search builtin；自定义 HTTP 工具待执行器接入后开放，
 * 避免模型调用了工具却无执行器而报错。
 */
export function getEnabledTools(enabledToolIds?: string[]): EnabledToolsResult {
  const config = getChatToolsConfig()
  const isEnabled = enabledToolIds
    ? enabledToolIds.includes(WEB_SEARCH_TOOL_META.id)
    : (config.toolStates['web-search']?.enabled ?? false)
  // 可用性 = 凭据已配置（与 checkBuiltinAvailable 同源，复用已读 config）
  const isAvailable = !!config.toolCredentials['web-search']?.apiKey

  if (!isEnabled || !isAvailable) {
    return { tools: undefined, systemPromptAppend: undefined }
  }
  return {
    tools: WEB_SEARCH_TOOL_DEFINITIONS,
    systemPromptAppend: WEB_SEARCH_TOOL_META.systemPromptAppend,
  }
}
