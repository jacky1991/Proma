/**
 * useCreateConversation — Chat 入口的「新建对话」操作
 *
 * 继承当前选中的模型/渠道，创建对话后置顶并选中，并按默认提示词重置选中。
 * 供 ConversationList（自带顶栏的「新对话」按钮）与 LeftSidebar 在 chat 模式下的
 * 新建入口共用，避免重复实现。
 */

import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { conversationsAtom, selectedModelAtom } from '@/atoms/chat-atoms'
import { promptConfigAtom, selectedPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { useOpenConversation } from '@/hooks/useOpenConversation'

export function useCreateConversation(): () => Promise<void> {
  const setConversations = useSetAtom(conversationsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const promptConfig = useAtomValue(promptConfigAtom)
  const setSelectedPromptId = useSetAtom(selectedPromptIdAtom)
  const openConversation = useOpenConversation()

  return useCallback(async () => {
    try {
      const meta = await window.electronAPI.createConversation(
        undefined,
        selectedModel?.modelId,
        selectedModel?.channelId,
      )
      setConversations((prev) => [meta, ...prev])
      // Chat 入口无标签系统，仅设置 currentConversationId
      openConversation(meta.id)
      // 根据默认提示词重置选中
      if (promptConfig.defaultPromptId) {
        setSelectedPromptId(promptConfig.defaultPromptId)
      }
    } catch (error) {
      console.error('[对话列表] 创建对话失败:', error)
    }
  }, [selectedModel, promptConfig, setConversations, openConversation, setSelectedPromptId])
}
