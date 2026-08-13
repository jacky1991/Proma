/**
 * Pi Runtime 内置 MCP 工具桥接层（server-core 版本）
 *
 * Claude SDK 用 sdk.createSdkMcpServer() + Zod schema 注册 MCP 工具；
 * Pi SDK 用 sdk.defineTool() + TypeBox schema 注册 customTools。
 *
 * automation / collaboration / web-search 依赖通过可选注入回调提供：
 * - Electron 端注入真实实现（完整功能）
 * - Server 端 M2 传空（不启用这些内置工具，M3 按需接入）
 */

import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentRuntime, PromaPermissionMode } from '@proma/shared'
import { isBuiltinMcpUserEnabled } from '../builtin-mcp/settings'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

// ===== 通用 =====

export interface PiBuiltinToolsContext {
  sessionId: string
  channelId: string
  modelId?: string
  agentRuntime?: AgentRuntime
  workspaceId?: string
  workspaceSlug?: string
  /** 图片外发前必须校验在这些已授权目录内。 */
  allowedRoots?: string[]
  permissionMode?: PromaPermissionMode
  triggeredBy?: 'user' | 'automation' | 'delegation'
}

/**
 * 可选依赖注入接口
 *
 * Electron 端注入真实实现；Server 端 M2 不注入（automation / collaboration / web-search 工具不可用）。
 */
export interface PiBuiltinToolDeps {
  /** 构建 web 搜索/抓取工具（WebSearch / WebFetch） */
  buildWebTools?: (sdk: PiSdk) => ToolDefinition[]
  /** 检查 web 搜索是否对 Agent 启用 */
  isWebSearchEnabled?: () => boolean
  /** 构建 automation 定时任务工具 */
  buildAutomationTools?: (sdk: PiSdk, ctx: PiBuiltinToolsContext) => ToolDefinition[]
  /** 构建 collaboration 协作子会话工具 */
  buildCollaborationTools?: (sdk: PiSdk, ctx: PiBuiltinToolsContext) => ToolDefinition[]
  /** 构建视觉助手工具（VisionRelay，为 text-only 模型提供图片理解） */
  buildVisionTools?: (sdk: PiSdk, ctx: PiBuiltinToolsContext) => ToolDefinition[]
}

// ===== 统一入口 =====

export interface PiBuiltinToolsResult {
  tools: ToolDefinition[]
  collaborationAvailable: boolean
}

export async function buildPiBuiltinTools(
  sdk: PiSdk,
  ctx: PiBuiltinToolsContext,
  deps: PiBuiltinToolDeps = {},
): Promise<PiBuiltinToolsResult> {
  const tools: ToolDefinition[] = []

  // Web 搜索工具（可选注入）
  const webEnabled = deps.isWebSearchEnabled?.() ?? false
  if (webEnabled && deps.buildWebTools) {
    try {
      tools.push(...deps.buildWebTools(sdk))
    } catch (error) {
      console.error('[Pi 桥接] 注入 WebSearch/WebFetch 工具失败:', error)
    }
  }

  // Automation 工具（可选注入）
  if (isBuiltinMcpUserEnabled('automation') && deps.buildAutomationTools) {
    try {
      tools.push(...deps.buildAutomationTools(sdk, ctx))
    } catch (error) {
      console.error('[Pi 桥接] 注入 automation 工具失败:', error)
    }
  }

  // Collaboration 工具（可选注入）
  const collaborationAvailable = isBuiltinMcpUserEnabled('collaboration') &&
    !!ctx.workspaceId &&
    ctx.triggeredBy !== 'delegation' &&
    !!deps.buildCollaborationTools

  if (collaborationAvailable && deps.buildCollaborationTools) {
    try {
      tools.push(...deps.buildCollaborationTools(sdk, ctx))
    } catch (error) {
      console.error('[Pi 桥接] 注入 collaboration 工具失败:', error)
    }
  }

  // 视觉助手仅在明确不支持视觉的 DeepSeek V4 用户会话中按需出现。
  if (deps.buildVisionTools) {
    try {
      tools.push(...deps.buildVisionTools(sdk, ctx))
    } catch (error) {
      console.error('[Pi 桥接] 注入视觉助手失败:', error)
    }
  }

  return { tools, collaborationAvailable }
}
