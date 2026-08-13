/**
 * useWidgetConversation — 悬浮 Chatbox 专属对话（find-or-create）
 *
 * 为 ChatWidget 绑定一个固定的「悬浮对话」：
 * - localStorage 记录对话 ID，首次使用自动创建，后续复用
 * - 不同 origin 的 localStorage 天然隔离 → 应用内与各嵌入站点各得专属对话
 * - 挂载时把对话列表灌入 conversationsAtom（widget 独立入口的 store 是全新单例，
 *   应用内 agent 路由下列表可能也未加载），保证 ChatView 正常派生会话状态
 */

import * as React from 'react'
import { useSetAtom, useStore } from 'jotai'
import { conversationsAtom, selectedModelAtom } from '@/atoms/chat-atoms'

const WIDGET_CONVERSATION_KEY = 'proma-widget-conversation-id'

/** 专属对话初始标题（首条消息后会由自动标题覆盖） */
const WIDGET_CONVERSATION_TITLE = '快速对话'

export function useWidgetConversation(enabled: boolean): string | null {
  const [conversationId, setConversationId] = React.useState<string | null>(null)
  const setConversations = useSetAtom(conversationsAtom)
  const store = useStore()

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const ensure = async (): Promise<void> => {
      try {
        const conversations = await window.electronAPI.listConversations()
        if (cancelled) return
        setConversations(conversations)

        // 已存在的专属对话：校验未删除后直接复用
        const storedId = localStorage.getItem(WIDGET_CONVERSATION_KEY)
        if (storedId && conversations.some((c) => c.id === storedId)) {
          setConversationId(storedId)
          return
        }

        // 首次使用 / 原对话已被删除：继承当前全局模型创建新对话
        const selectedModel = store.get(selectedModelAtom)
        const meta = await window.electronAPI.createConversation(
          WIDGET_CONVERSATION_TITLE,
          selectedModel?.modelId,
          selectedModel?.channelId,
        )
        if (cancelled) return
        setConversations((prev) => [meta, ...prev])
        localStorage.setItem(WIDGET_CONVERSATION_KEY, meta.id)
        setConversationId(meta.id)
      } catch (error) {
        console.error('[ChatWidget] 准备专属对话失败:', error)
      }
    }

    void ensure()
    return () => { cancelled = true }
  }, [enabled, setConversations, store])

  return conversationId
}
