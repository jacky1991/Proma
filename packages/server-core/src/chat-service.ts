/**
 * AI 聊天流式服务（跨平台核心层）
 *
 * 从 Electron chat-service.ts 剥离，去耦 WebContents：
 * - 流式事件通过 ChatStreamEmitter 回调推送（Electron 侧传 webContents.send，Server 侧传 WS 推送）
 * - 工具注册/执行通过可选注入（M2 暂不启用 Chat 工具）
 *
 * 纯逻辑（消息转换、SSE 解析、请求构建）已抽象到 @proma/core/providers。
 */

import { randomUUID } from 'node:crypto'
import type { ChatSendInput, ChatMessage, GenerateTitleInput, FileAttachment, ChatToolActivity } from '@proma/shared'
import {
  getAdapter,
  streamSSE,
  fetchTitle,
} from '@proma/core'
import type { ImageAttachmentData, ContinuationMessage } from '@proma/core'
import { listChannels, resolveChannelRuntimeApiKey } from './channel-manager'
import { appendMessage, updateConversationMeta, getConversationMessages } from './conversation-manager'
import { readAttachmentAsBase64, isImageAttachment } from './attachment-service'
import { extractTextFromAttachment, isDocumentAttachment } from './document-parser'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { createFallbackTitle, sanitizeGeneratedTitle, SHORT_MESSAGE_THRESHOLD, TITLE_PROMPT } from './title-generation'

// ===== 流式事件推送接口 =====

/** Chat 流式事件类型 */
export type ChatStreamEvent =
  | { type: 'chunk'; conversationId: string; delta: string }
  | { type: 'reasoning'; conversationId: string; delta: string }
  | { type: 'tool-activity'; conversationId: string; activity: ChatToolActivity }
  | { type: 'complete'; conversationId: string; model?: string; messageId?: string }
  | { type: 'error'; conversationId: string; error: string }

/** 流式事件推送回调（替代 WebContents.send） */
export type ChatStreamEmitter = (event: ChatStreamEvent) => void

/** 活跃的 AbortController 映射（conversationId → controller） */
const activeControllers = new Map<string, AbortController>()

/** 最大工具续接轮数 */
const MAX_TOOL_ROUNDS = 999

// ===== 平台相关：图片附件读取器 =====

function getImageAttachmentData(attachments?: FileAttachment[]): ImageAttachmentData[] {
  if (!attachments || attachments.length === 0) return []
  return attachments
    .filter((att) => isImageAttachment(att.mediaType))
    .map((att) => ({
      mediaType: att.mediaType,
      data: readAttachmentAsBase64(att.localPath),
    }))
}

// ===== 文档附件文本提取 =====

async function enrichMessageWithDocuments(
  messageText: string,
  attachments?: FileAttachment[],
): Promise<string> {
  if (!attachments || attachments.length === 0) return messageText
  const docAttachments = attachments.filter((att) => isDocumentAttachment(att.mediaType))
  if (docAttachments.length === 0) return messageText

  const parts: string[] = [messageText]
  for (const att of docAttachments) {
    try {
      const text = await extractTextFromAttachment(att.localPath)
      parts.push(text.trim()
        ? `\n<file name="${att.filename}">\n${text}\n</file>`
        : `\n<file name="${att.filename}">\n[文件内容为空]\n</file>`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      console.warn(`[聊天服务] 文档提取失败: ${att.filename}`, error)
      parts.push(`\n<file name="${att.filename}">\n[文件内容提取失败: ${errorMsg}]\n</file>`)
    }
  }
  return parts.join('')
}

async function enrichHistoryWithDocuments(history: ChatMessage[]): Promise<ChatMessage[]> {
  const enriched: ChatMessage[] = []
  for (const msg of history) {
    if (msg.role === 'user' && msg.attachments?.some((att) => isDocumentAttachment(att.mediaType))) {
      const enrichedContent = await enrichMessageWithDocuments(msg.content, msg.attachments)
      enriched.push({ ...msg, content: enrichedContent })
      continue
    }
    enriched.push(msg)
  }
  return enriched
}

// ===== 上下文过滤 =====

function filterHistory(
  messageHistory: ChatMessage[],
  contextDividers?: string[],
  contextLength?: number | 'infinite',
): ChatMessage[] {
  let filtered = messageHistory.filter(
    (msg) => !(msg.role === 'assistant' && !msg.content.trim()),
  )

  if (contextDividers && contextDividers.length > 0) {
    const lastDividerId = contextDividers[contextDividers.length - 1]
    const dividerIndex = filtered.findIndex((msg) => msg.id === lastDividerId)
    if (dividerIndex >= 0) filtered = filtered.slice(dividerIndex + 1)
  }

  if (typeof contextLength === 'number' && contextLength >= 0) {
    if (contextLength === 0) return []
    const collected: ChatMessage[] = []
    let roundCount = 0
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i] as ChatMessage
      collected.unshift(msg)
      if (msg.role === 'user') {
        roundCount++
        if (roundCount >= contextLength) break
      }
    }
    return collected
  }

  return filtered
}

// ===== 核心流式函数 =====

/**
 * 发送消息并流式返回 AI 响应
 *
 * @param input 发送参数
 * @param emit 流式事件推送回调
 */
export async function sendChatMessage(
  input: ChatSendInput,
  emit: ChatStreamEmitter,
): Promise<void> {
  const {
    conversationId, userMessage, channelId,
    modelId, systemMessage, contextLength, contextDividers, attachments,
    thinkingEnabled,
  } = input

  // 1. 查找渠道
  const channels = listChannels()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) {
    emit({ type: 'error', conversationId, error: '渠道不存在' })
    return
  }

  if (channel.provider === 'openai-codex') {
    emit({ type: 'error', conversationId, error: 'Chat 模式暂不支持 ChatGPT 订阅（Codex OAuth），请切换到 Agent 模式使用。' })
    return
  }

  // 2. 解密 API Key
  let apiKey: string
  try {
    apiKey = await resolveChannelRuntimeApiKey(channelId)
  } catch {
    emit({ type: 'error', conversationId, error: '解密 API Key 失败' })
    return
  }

  // 3. 读取历史消息
  const fullHistory = getConversationMessages(conversationId)

  // 4. 追加用户消息
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: userMessage,
    createdAt: Date.now(),
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  }
  appendMessage(conversationId, userMsg)

  // 5. 过滤历史并提取文档附件文本
  const filteredHistory = filterHistory(fullHistory, contextDividers, contextLength)
  const enrichedHistory = await enrichHistoryWithDocuments(filteredHistory)
  const enrichedUserMessage = await enrichMessageWithDocuments(userMessage, attachments)

  // 6. 创建 AbortController
  const controller = new AbortController()
  activeControllers.set(conversationId, controller)

  let accumulatedContent = ''
  let accumulatedReasoning = ''
  const accumulatedToolActivities: ChatToolActivity[] = []
  const accumulatedGeneratedAttachments: FileAttachment[] = []

  try {
    const adapter = getAdapter(channel.provider)
    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)

    // M2：Chat 工具暂不启用（工具注册/执行留待后续迭代注入）
    const effectiveSystemMessage = systemMessage

    let continuationMessages: ContinuationMessage[] = []
    let round = 0

    const handleStreamEvent = (event: { type: string; delta?: string; toolCallId?: string; toolName?: string }): void => {
      switch (event.type) {
        case 'chunk':
          accumulatedContent += event.delta ?? ''
          emit({ type: 'chunk', conversationId, delta: event.delta ?? '' })
          break
        case 'reasoning':
          accumulatedReasoning += event.delta ?? ''
          emit({ type: 'reasoning', conversationId, delta: event.delta ?? '' })
          break
      }
    }

    while (round < MAX_TOOL_ROUNDS) {
      round++

      const request = adapter.buildStreamRequest({
        baseUrl: channel.baseUrl,
        apiKey,
        modelId,
        history: enrichedHistory,
        userMessage: enrichedUserMessage,
        systemMessage: effectiveSystemMessage,
        attachments,
        readImageAttachments: getImageAttachmentData,
        thinkingEnabled,
        continuationMessages: continuationMessages.length > 0 ? continuationMessages : undefined,
      })

      const { stopReason, toolCalls } = await streamSSE({
        request,
        adapter,
        signal: controller.signal,
        fetchFn,
        onEvent: handleStreamEvent,
      })

      // M2：不执行工具调用，直接退出循环
      if (!toolCalls || toolCalls.length === 0 || stopReason !== 'tool_use') break
      break
    }

    // 保存 assistant 消息
    const assistantMsgId = randomUUID()
    if (accumulatedContent.trim() || accumulatedGeneratedAttachments.length > 0) {
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedContent,
        createdAt: Date.now(),
        model: modelId,
        reasoning: accumulatedReasoning || undefined,
        toolActivities: accumulatedToolActivities.length > 0 ? accumulatedToolActivities : undefined,
        attachments: accumulatedGeneratedAttachments.length > 0 ? accumulatedGeneratedAttachments : undefined,
      }
      appendMessage(conversationId, assistantMsg)
      try { updateConversationMeta(conversationId, {}) } catch { /* 索引更新失败不影响主流程 */ }
    }

    emit({ type: 'complete', conversationId, model: modelId, messageId: (accumulatedContent.trim() || accumulatedGeneratedAttachments.length > 0) ? assistantMsgId : undefined })
  } catch (error) {
    if (controller.signal.aborted) {
      console.log(`[聊天服务] 对话 ${conversationId} 已被用户中止`)
      if (accumulatedContent) {
        const assistantMsgId = randomUUID()
        appendMessage(conversationId, {
          id: assistantMsgId, role: 'assistant', content: accumulatedContent,
          createdAt: Date.now(), model: modelId, reasoning: accumulatedReasoning || undefined, stopped: true,
          toolActivities: accumulatedToolActivities.length > 0 ? accumulatedToolActivities : undefined,
        })
        try { updateConversationMeta(conversationId, {}) } catch { /* noop */ }
        emit({ type: 'complete', conversationId, model: modelId, messageId: assistantMsgId })
      } else {
        emit({ type: 'complete', conversationId, model: modelId })
      }
      return
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    console.error(`[聊天服务] 流式请求失败:`, error)

    const assistantMsgId = randomUUID()
    appendMessage(conversationId, {
      id: assistantMsgId, role: 'assistant', content: accumulatedContent,
      createdAt: Date.now(), model: modelId, reasoning: accumulatedReasoning || undefined,
      stopped: true, error: errorMessage,
      toolActivities: accumulatedToolActivities.length > 0 ? accumulatedToolActivities : undefined,
    })
    try { updateConversationMeta(conversationId, {}) } catch { /* noop */ }

    emit({ type: 'error', conversationId, error: errorMessage })
  } finally {
    activeControllers.delete(conversationId)
  }
}

/** 中止指定对话的生成 */
export function stopChatGeneration(conversationId: string): void {
  const controller = activeControllers.get(conversationId)
  if (controller) {
    controller.abort()
    activeControllers.delete(conversationId)
    console.log(`[聊天服务] 已中止对话: ${conversationId}`)
  }
}

/** 中止所有活跃的聊天流 */
export function stopAllChatGenerations(): void {
  if (activeControllers.size === 0) return
  console.log(`[聊天服务] 正在中止所有活跃对话 (${activeControllers.size} 个)...`)
  for (const [conversationId, controller] of activeControllers) {
    controller.abort()
    console.log(`[聊天服务] 已中止对话: ${conversationId}`)
  }
  activeControllers.clear()
}

// ===== 标题生成 =====

export async function generateChatTitle(input: GenerateTitleInput): Promise<string | null> {
  const { userMessage, channelId, modelId } = input

  const trimmedMessage = userMessage.trim()
  if (trimmedMessage.length <= SHORT_MESSAGE_THRESHOLD) {
    return createFallbackTitle(trimmedMessage)
  }

  const channels = listChannels()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) return null

  if (channel.provider === 'openai-codex') {
    return createFallbackTitle(userMessage)
  }

  let apiKey: string
  try {
    apiKey = await resolveChannelRuntimeApiKey(channelId)
  } catch {
    return null
  }

  try {
    const adapter = getAdapter(channel.provider)
    const request = adapter.buildTitleRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId,
      prompt: TITLE_PROMPT + userMessage,
    })

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const title = await fetchTitle(request, adapter, fetchFn)
    if (!title) return null

    return sanitizeGeneratedTitle(title)
  } catch {
    return null
  }
}
