/**
 * Chat 域 HTTP 路由
 *
 * 将 Electron IPC handler 映射为 Hono 路由。
 * 流式事件经 WS 推送（ChatStreamEmitter → WsStreamSink）。
 */

import { Hono } from 'hono'
import { CHAT_IPC_CHANNELS } from '@proma/shared'
import type { ChatSendInput, GenerateTitleInput } from '@proma/shared'
import {
  listConversations,
  createConversation,
  getConversationMessages,
  getRecentMessages,
  updateConversationMeta,
  deleteConversation,
  deleteMessage,
  truncateMessagesFrom,
  updateContextDividers,
} from '@proma/server-core/conversation-manager'
import {
  sendChatMessage,
  stopChatGeneration,
  generateChatTitle,
  type ChatStreamEvent,
} from '@proma/server-core/chat-service'
import { streamSink } from '../engine'

const chat = new Hono()

/** 将 ChatStreamEvent 转发到 WS（按事件类型分通道） */
function chatStreamEmitter(event: ChatStreamEvent): void {
  const channelMap: Record<string, string> = {
    'chunk': CHAT_IPC_CHANNELS.STREAM_CHUNK,
    'reasoning': CHAT_IPC_CHANNELS.STREAM_REASONING,
    'complete': CHAT_IPC_CHANNELS.STREAM_COMPLETE,
    'error': CHAT_IPC_CHANNELS.STREAM_ERROR,
    'tool-activity': CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY,
  }
  const channel = channelMap[event.type] ?? 'chat:stream:chunk'
  streamSink.emit(event.conversationId, event, channel)
}

// ===== 对话管理 =====

/** POST /api/chat:list-conversations → ConversationMeta[] */
chat.post(`/${CHAT_IPC_CHANNELS.LIST_CONVERSATIONS}`, (c) => {
  return c.json(listConversations())
})

/** POST /api/chat:create-conversation → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.CREATE_CONVERSATION}`, async (c) => {
  const { title, modelId, channelId } = await c.req.json()
  return c.json(createConversation(title, modelId, channelId))
})

/** POST /api/chat:get-messages → ChatMessage[] */
chat.post(`/${CHAT_IPC_CHANNELS.GET_MESSAGES}`, async (c) => {
  const { id } = await c.req.json()
  return c.json(getConversationMessages(id))
})

/** POST /api/chat:get-recent-messages → RecentMessagesResult */
chat.post(`/${CHAT_IPC_CHANNELS.GET_RECENT_MESSAGES}`, async (c) => {
  const { id, limit } = await c.req.json()
  return c.json(getRecentMessages(id, limit))
})

/** POST /api/chat:update-title → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.UPDATE_TITLE}`, async (c) => {
  const { id, title } = await c.req.json()
  return c.json(updateConversationMeta(id, { title }))
})

/** POST /api/chat:delete-conversation → { ok: true } */
chat.post(`/${CHAT_IPC_CHANNELS.DELETE_CONVERSATION}`, async (c) => {
  const { id } = await c.req.json()
  deleteConversation(id)
  return c.json({ ok: true })
})

/** POST /api/chat:update-conversation-model → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.UPDATE_MODEL}`, async (c) => {
  const { id, modelId, channelId } = await c.req.json()
  return c.json(updateConversationMeta(id, { modelId, channelId }))
})

/** POST /api/chat:toggle-pin → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.TOGGLE_PIN}`, async (c) => {
  const { id } = await c.req.json()
  const conversations = listConversations()
  const conv = conversations.find((cv) => cv.id === id)
  if (!conv) return c.json({ error: 'Conversation not found' }, 404)
  return c.json(updateConversationMeta(id, { pinned: !conv.pinned }))
})

/** POST /api/chat:delete-message → ChatMessage[] */
chat.post(`/${CHAT_IPC_CHANNELS.DELETE_MESSAGE}`, async (c) => {
  const { conversationId, messageId } = await c.req.json()
  return c.json(deleteMessage(conversationId, messageId))
})

/** POST /api/chat:truncate-messages-from → ChatMessage[] */
chat.post(`/${CHAT_IPC_CHANNELS.TRUNCATE_MESSAGES_FROM}`, async (c) => {
  const { conversationId, messageId } = await c.req.json()
  return c.json(truncateMessagesFrom(conversationId, messageId))
})

/** POST /api/chat:update-context-dividers → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.UPDATE_CONTEXT_DIVIDERS}`, async (c) => {
  const { conversationId, dividers } = await c.req.json()
  return c.json(updateContextDividers(conversationId, dividers))
})

// ===== 消息发送 & 控制 =====

/** POST /api/chat:send-message → { ok: true }（流式事件经 WS 推送） */
chat.post(`/${CHAT_IPC_CHANNELS.SEND_MESSAGE}`, async (c) => {
  const input = await c.req.json<ChatSendInput>()
  // 异步执行，不等待完成（流式事件经 WS 推送）
  sendChatMessage(input, chatStreamEmitter).catch((err: unknown) => {
    console.error('[Chat 路由] sendMessage 失败:', err)
  })
  return c.json({ ok: true })
})

/** POST /api/chat:stop-generation → { ok: true } */
chat.post(`/${CHAT_IPC_CHANNELS.STOP_GENERATION}`, async (c) => {
  const { conversationId } = await c.req.json()
  stopChatGeneration(conversationId)
  return c.json({ ok: true })
})

/** POST /api/chat:generate-title → { title: string | null } */
chat.post(`/${CHAT_IPC_CHANNELS.GENERATE_TITLE}`, async (c) => {
  const input = await c.req.json<GenerateTitleInput>()
  const title = await generateChatTitle(input)
  return c.json({ title })
})

export { chat }
