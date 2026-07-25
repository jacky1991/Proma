/**
 * Chat Tool 域 HTTP 路由
 *
 * 将 Electron IPC handler 映射为 Hono 路由。
 * 迭代 5：工具 CRUD + 凭证 + 测试。
 */

import { Hono } from 'hono'
import { CHAT_TOOL_IPC_CHANNELS } from '@proma/shared'
import type { ChatToolMeta, ChatToolState } from '@proma/shared'
import {
  updateToolState,
  updateToolCredentials,
  getToolCredentials,
  addCustomTool,
  deleteCustomTool,
  getChatToolsConfig,
} from '@proma/server-core/chat-tool-config'
import { getAllToolInfos } from '@proma/server-core/chat-tool-registry'

const chatTool = new Hono()

// ===== 路由 =====

/** POST /api/chat-tool:get-all-tools → ChatToolInfo[] */
chatTool.post(`/${CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS}`, (c) => {
  return c.json(getAllToolInfos())
})

/** POST /api/chat-tool:get-credentials → Record<string, string> */
chatTool.post(`/${CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS}`, async (c) => {
  const { toolId } = await c.req.json<{ toolId: string }>()
  return c.json(getToolCredentials(toolId))
})

/** POST /api/chat-tool:update-state → { ok: true } */
chatTool.post(`/${CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE}`, async (c) => {
  const { toolId, state } = await c.req.json<{ toolId: string; state: ChatToolState }>()
  updateToolState(toolId, state)
  return c.json({ ok: true })
})

/** POST /api/chat-tool:update-credentials → { ok: true } */
chatTool.post(`/${CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS}`, async (c) => {
  const { toolId, credentials } = await c.req.json<{ toolId: string; credentials: Record<string, string> }>()
  updateToolCredentials(toolId, credentials)
  return c.json({ ok: true })
})

/** POST /api/chat-tool:create-custom → { ok: true } */
chatTool.post(`/${CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL}`, async (c) => {
  const meta = await c.req.json<ChatToolMeta>()
  addCustomTool(meta)
  return c.json({ ok: true })
})

/** POST /api/chat-tool:delete-custom → { ok: true } */
chatTool.post(`/${CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL}`, async (c) => {
  const { toolId } = await c.req.json<{ toolId: string }>()
  deleteCustomTool(toolId)
  return c.json({ ok: true })
})

/** POST /api/chat-tool:test → { success: boolean; message: string } */
chatTool.post(`/${CHAT_TOOL_IPC_CHANNELS.TEST_TOOL}`, async (c) => {
  const { toolId } = await c.req.json<{ toolId: string }>()

  // 联网搜索工具测试（Tavily API）
  if (toolId === 'web-search') {
    const credentials = getToolCredentials('web-search')
    if (!credentials.apiKey) {
      return c.json({ success: false, message: '请先填写 Tavily API Key' })
    }
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credentials.apiKey}`,
        },
        body: JSON.stringify({ query: 'test connection', search_depth: 'basic', max_results: 1 }),
      })
      if (!response.ok) {
        const errorText = await response.text()
        return c.json({ success: false, message: `API 请求失败 (${response.status}): ${errorText}` })
      }
      return c.json({ success: true, message: '连接成功，Tavily 搜索 API 可用' })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return c.json({ success: false, message: `连接失败: ${msg}` })
    }
  }

  // Nano Banana 生图工具测试（Gemini API）
  if (toolId === 'nano-banana') {
    const credentials = getToolCredentials('nano-banana')
    if (!credentials.apiKey) {
      return c.json({ success: false, message: '请先填写 Gemini API Key' })
    }
    try {
      const baseUrl = credentials.baseUrl?.trim() || 'https://generativelanguage.googleapis.com'
      const model = credentials.model?.trim() || 'gemini-3.1-flash-image-preview'
      const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${credentials.apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      })
      if (!response.ok) {
        const errorText = await response.text()
        return c.json({ success: false, message: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}` })
      }
      return c.json({ success: true, message: `连接成功，模型 ${model} 可用` })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return c.json({ success: false, message: `连接失败: ${msg}` })
    }
  }

  // 自定义工具 HTTP 连通性测试
  const config = getChatToolsConfig()
  const customMeta = config.customTools.find((t) => t.id === toolId)
  if (customMeta?.httpConfig) {
    const { urlTemplate, method, headers } = customMeta.httpConfig
    // 用占位符替换参数，仅测试连通性
    const testUrl = urlTemplate.replace(/\{\{[^}]+\}\}/g, 'test')
    try {
      const response = await fetch(testUrl, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        // GET 不需要 body；POST 发最小 body
        ...(method === 'POST' ? { body: '{}' } : {}),
        signal: AbortSignal.timeout(10_000),
      })
      // 任何 HTTP 响应（含 4xx）都说明端点可达
      return c.json({
        success: true,
        message: `连接成功，端点返回 HTTP ${response.status}`,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return c.json({ success: false, message: `连接失败: ${msg}` })
    }
  }

  return c.json({ success: false, message: `工具 ${toolId} 不支持测试` })
})

export { chatTool }
