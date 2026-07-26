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
  searchConversationMessages,
} from '@proma/server-core/conversation-manager'
import {
  saveAttachment,
  readAttachmentAsBase64,
  deleteAttachment,
} from '@proma/server-core/attachment-service'
import { extractTextFromAttachment } from '@proma/server-core/document-parser'
import {
  getTutorialContent,
  createWelcomeConversation,
} from '@proma/server-core/tutorial-service'
import type { AttachmentSaveInput, ConversationMeta } from '@proma/shared'
import {
  sendChatMessage,
  stopChatGeneration,
  generateChatTitle,
  type ChatStreamEvent,
} from '@proma/server-core/chat-service'
import { streamSink } from '../engine'
import { getUserScope } from '../utils/user-scope'

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
  const scope = getUserScope(c)
  return c.json(listConversations(scope))
})

/** POST /api/chat:create-conversation → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.CREATE_CONVERSATION}`, async (c) => {
  const scope = getUserScope(c)
  const { title, modelId, channelId } = await c.req.json()
  return c.json(createConversation(title, modelId, channelId, scope))
})

/** POST /api/chat:get-messages → ChatMessage[] */
chat.post(`/${CHAT_IPC_CHANNELS.GET_MESSAGES}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json()
  return c.json(getConversationMessages(id, scope))
})

/** POST /api/chat:get-recent-messages → RecentMessagesResult */
chat.post(`/${CHAT_IPC_CHANNELS.GET_RECENT_MESSAGES}`, async (c) => {
  const scope = getUserScope(c)
  const { id, limit } = await c.req.json()
  return c.json(getRecentMessages(id, limit, scope))
})

/** POST /api/chat:update-title → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.UPDATE_TITLE}`, async (c) => {
  const scope = getUserScope(c)
  const { id, title } = await c.req.json()
  return c.json(updateConversationMeta(id, { title }, scope))
})

/** POST /api/chat:delete-conversation → { ok: true } */
chat.post(`/${CHAT_IPC_CHANNELS.DELETE_CONVERSATION}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json()
  deleteConversation(id, scope)
  return c.json({ ok: true })
})

/** POST /api/chat:update-conversation-model → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.UPDATE_MODEL}`, async (c) => {
  const scope = getUserScope(c)
  const { id, modelId, channelId } = await c.req.json()
  return c.json(updateConversationMeta(id, { modelId, channelId }, scope))
})

/** POST /api/chat:toggle-pin → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.TOGGLE_PIN}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json()
  const conversations = listConversations(scope)
  const conv = conversations.find((cv) => cv.id === id)
  if (!conv) return c.json({ error: 'Conversation not found' }, 404)
  return c.json(updateConversationMeta(id, { pinned: !conv.pinned }, scope))
})

/** POST /api/chat:delete-message → ChatMessage[] */
chat.post(`/${CHAT_IPC_CHANNELS.DELETE_MESSAGE}`, async (c) => {
  const scope = getUserScope(c)
  const { conversationId, messageId } = await c.req.json()
  return c.json(deleteMessage(conversationId, messageId, scope))
})

/** POST /api/chat:truncate-messages-from → ChatMessage[] */
chat.post(`/${CHAT_IPC_CHANNELS.TRUNCATE_MESSAGES_FROM}`, async (c) => {
  const scope = getUserScope(c)
  const { conversationId, messageId } = await c.req.json()
  return c.json(truncateMessagesFrom(conversationId, messageId, undefined, scope))
})

/** POST /api/chat:update-context-dividers → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.UPDATE_CONTEXT_DIVIDERS}`, async (c) => {
  const scope = getUserScope(c)
  const { conversationId, dividers } = await c.req.json()
  return c.json(updateContextDividers(conversationId, dividers, scope))
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

// ===== 附件管理 =====

/** POST /api/chat:save-attachment → AttachmentSaveResult */
chat.post(`/${CHAT_IPC_CHANNELS.SAVE_ATTACHMENT}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<AttachmentSaveInput>()
  return c.json(saveAttachment(input, scope))
})

/** POST /api/chat:read-attachment → string (base64) */
chat.post(`/${CHAT_IPC_CHANNELS.READ_ATTACHMENT}`, async (c) => {
  const scope = getUserScope(c)
  const { localPath } = await c.req.json<{ localPath: string }>()
  return c.json(readAttachmentAsBase64(localPath, scope))
})

/** POST /api/chat:delete-attachment → { ok: true } */
chat.post(`/${CHAT_IPC_CHANNELS.DELETE_ATTACHMENT}`, async (c) => {
  const scope = getUserScope(c)
  const { localPath } = await c.req.json<{ localPath: string }>()
  deleteAttachment(localPath, scope)
  return c.json({ ok: true })
})

/** POST /api/chat:extract-attachment-text → string */
chat.post(`/${CHAT_IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT}`, async (c) => {
  const { localPath } = await c.req.json<{ localPath: string }>()
  const text = await extractTextFromAttachment(localPath)
  return c.json(text)
})

// ===== 辅助功能 =====

/** POST /api/chat:toggle-archive → ConversationMeta */
chat.post(`/${CHAT_IPC_CHANNELS.TOGGLE_ARCHIVE}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json<{ id: string }>()
  const conversations = listConversations(scope)
  const current = conversations.find((cv) => cv.id === id)
  if (!current) return c.json({ error: '对话不存在' }, 404)
  const newArchived = !current.archived
  // 归档时自动取消置顶
  const updates: Partial<ConversationMeta> = { archived: newArchived }
  if (newArchived && current.pinned) {
    updates.pinned = false
  }
  return c.json(updateConversationMeta(id, updates, scope))
})

/** POST /api/chat:search-messages → MessageSearchResult[] */
chat.post(`/${CHAT_IPC_CHANNELS.SEARCH_MESSAGES}`, async (c) => {
  const scope = getUserScope(c)
  const { query } = await c.req.json<{ query: string }>()
  return c.json(await searchConversationMessages(query, scope))
})

/** POST /api/chat:get-tutorial-content → string | null */
chat.post(`/${CHAT_IPC_CHANNELS.GET_TUTORIAL_CONTENT}`, (c) => {
  return c.json(getTutorialContent())
})

/** POST /api/chat:create-welcome-conversation → ConversationMeta | null */
chat.post(`/${CHAT_IPC_CHANNELS.CREATE_WELCOME_CONVERSATION}`, (c) => {
  const scope = getUserScope(c)
  return c.json(createWelcomeConversation(scope))
})

export { chat }
