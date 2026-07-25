/**
 * Proma 内置 MCP 注册中心（server-core 版本）
 *
 * Orchestrator 只调用这里的统一入口；各内置 MCP 的可用性、注入条件和错误隔离
 * 都收敛在本模块，避免主编排流程继续膨胀。
 *
 * automation / collaboration 依赖通过可选注入回调提供：
 * - Electron 端注入真实实现（完整功能）
 * - Server 端 M2 传空（不启用这些内置 MCP，M3 按需接入）
 */

import type { AgentRuntime, AgentSessionMeta, PromaPermissionMode } from '@proma/shared'
import { injectNanoBananaMcpServer } from '../chat-tools/nano-banana-mcp'
import { isBuiltinMcpUserEnabled } from './settings'

export interface BuiltinMcpInjectContext {
  sdk: typeof import('@anthropic-ai/claude-agent-sdk')
  mcpServers: Record<string, Record<string, unknown>>
  sessionId: string
  channelId: string
  modelId?: string
  agentRuntime?: AgentRuntime
  workspaceId?: string
  workspaceSlug?: string
  agentCwd?: string
  permissionMode?: PromaPermissionMode
  triggeredBy?: 'user' | 'automation' | 'delegation'
  sessionMeta?: AgentSessionMeta
}

/**
 * 可选依赖注入接口
 *
 * Electron 端注入真实实现；Server 端 M2 不注入（automation / collaboration MCP 不可用）。
 */
export interface BuiltinMcpDeps {
  /** 注入 automation MCP server */
  injectAutomationMcpServer?: (
    sdk: BuiltinMcpInjectContext['sdk'],
    mcpServers: Record<string, Record<string, unknown>>,
    ctx: {
      sessionId: string
      channelId: string
      modelId?: string
      agentRuntime?: AgentRuntime
      workspaceId?: string
      triggeredBy?: 'user' | 'automation' | 'delegation'
    },
  ) => Promise<void>
  /** 注入 collaboration MCP server */
  injectCollaborationMcpServer?: (
    sdk: BuiltinMcpInjectContext['sdk'],
    mcpServers: Record<string, Record<string, unknown>>,
    ctx: {
      sessionId: string
      channelId: string
      modelId?: string
      workspaceId?: string
      permissionMode?: PromaPermissionMode
      triggeredBy?: 'user' | 'automation' | 'delegation'
    },
  ) => Promise<void>
}

async function injectBuiltinSafely(name: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    console.error(`[Agent 编排] 注入内置 MCP 失败 (${name}):`, error)
  }
}

export async function injectBuiltinMcpServers(
  ctx: BuiltinMcpInjectContext,
  deps: BuiltinMcpDeps = {},
): Promise<{ collaborationAvailable: boolean }> {
  if (isBuiltinMcpUserEnabled('nano-banana')) {
    await injectBuiltinSafely('nano-banana', () => injectNanoBananaMcpServer(
      ctx.sdk,
      ctx.mcpServers,
      ctx.sessionId,
      ctx.agentCwd,
    ))
  }

  if (isBuiltinMcpUserEnabled('automation') && deps.injectAutomationMcpServer) {
    await injectBuiltinSafely('automation', () => deps.injectAutomationMcpServer!(ctx.sdk, ctx.mcpServers, {
      sessionId: ctx.sessionId,
      channelId: ctx.channelId,
      modelId: ctx.modelId,
      agentRuntime: ctx.agentRuntime,
      workspaceId: ctx.workspaceId,
      triggeredBy: ctx.triggeredBy,
    }))
  }

  const collaborationAvailable = isBuiltinMcpUserEnabled('collaboration') &&
    !!ctx.workspaceId &&
    ctx.triggeredBy !== 'delegation' &&
    (ctx.sessionMeta?.delegationDepth ?? 0) === 0 &&
    !!deps.injectCollaborationMcpServer

  if (collaborationAvailable && deps.injectCollaborationMcpServer) {
    await injectBuiltinSafely('collaboration', () => deps.injectCollaborationMcpServer!(ctx.sdk, ctx.mcpServers, {
      sessionId: ctx.sessionId,
      channelId: ctx.channelId,
      modelId: ctx.modelId,
      workspaceId: ctx.workspaceId,
      permissionMode: ctx.permissionMode,
      triggeredBy: ctx.triggeredBy,
    }))
  }

  return { collaborationAvailable }
}
