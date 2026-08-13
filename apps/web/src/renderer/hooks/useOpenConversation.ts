/**
 * useOpenConversation — Chat 入口的「选中对话」操作
 *
 * Chat 入口无标签系统，选中某个对话仅设置 currentConversationId。
 * 与 Agent 侧的 useOpenSession（写 agent 会话/tab/appMode）解耦。
 */

import { useCallback } from 'react'
import { useSetAtom } from 'jotai'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'

export function useOpenConversation(): (conversationId: string) => void {
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  return useCallback(
    (conversationId: string) => {
      setCurrentConversationId(conversationId)
    },
    [setCurrentConversationId],
  )
}
