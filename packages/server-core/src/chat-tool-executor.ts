/**
 * Chat 工具统一执行器（server-core 版本）
 *
 * 统一分发工具调用到对应的执行模块，并经 emit 回调推送工具活动事件给前端。
 * 替代桌面端 chat-tool-executor.ts 中依赖 WebContents 的实现：
 * - 桌面端：webContents.send(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, ...)
 * - 服务端：context.emitToolActivity(activity) → 由 chat-service 转为 WS 推送
 *
 * 当前已接入：web-search（联网搜索）。
 * 后续可扩展：自定义 HTTP 工具（http-tool-executor）等。
 */

import type { ToolCall, ToolResult } from '@proma/core'
import type { ChatToolActivity } from '@proma/shared'
import { isWebSearchToolCall, executeWebSearchTool } from './chat-tools/web-search-tool'

/** 工具执行上下文 */
export interface ToolExecutionContext {
  /** 对话 ID */
  conversationId: string
  /** 推送工具活动事件给前端（替代桌面端的 webContents.send） */
  emitToolActivity: (activity: ChatToolActivity) => void
}

/**
 * 执行工具调用列表
 *
 * 依次执行每个工具调用，推送结果活动事件给前端，返回所有结果。
 *
 * @param toolCalls 模型返回的工具调用列表
 * @param context 执行上下文
 * @returns 工具执行结果列表
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  context: ToolExecutionContext,
): Promise<ToolResult[]> {
  // 单轮内多个工具调用相互独立，并行执行以缩短延迟（如多个 web_search 并发打 Tavily）
  const results = await Promise.all(toolCalls.map(async (tc): Promise<ToolResult> => {
    if (isWebSearchToolCall(tc.name)) {
      return executeWebSearchTool(tc)
    }
    // 未知工具（自定义 HTTP 工具执行器尚未接入）
    console.warn(`[Chat 工具执行器] 未知工具: ${tc.name}`)
    return {
      toolCallId: tc.id,
      content: `未知工具: ${tc.name}`,
      isError: true,
    }
  }))

  // 按原始调用顺序推送结果活动事件，保持前端展示顺序
  for (const [index, tc] of toolCalls.entries()) {
    const result = results[index]
    if (!result) continue
    context.emitToolActivity({
      type: 'result',
      toolName: tc.name,
      toolCallId: tc.id,
      result: result.content,
      isError: result.isError,
      input: tc.arguments,
    })
  }

  return results
}
