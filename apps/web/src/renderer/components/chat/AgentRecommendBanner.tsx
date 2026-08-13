/**
 * AgentRecommendBanner — Agent 模式推荐横幅
 *
 * 当 AI 通过 suggest_agent_mode 工具推荐切换到 Agent 模式时，
 * 在 ChatInput 上方展示推荐横幅。用户可点击"切换到 Agent 模式"按钮迁移，或点击 × 关闭。
 *
 * 迁移流程：
 * 1. 清除推荐状态（先清再切换，避免 ChatView 副作用）
 * 2. 创建 Agent 会话（绑定默认工作区）
 * 3. 将 Chat 对话历史复制到新 Agent 会话
 * 4. 跳转到 Agent 入口（/agent?session=<id>&prompt=<...>），建议提示词经 URL 传递，
 *    由 AgentShell 写入对应会话的输入区建议。
 *
 * 解耦：不直接写 agent-atoms / tab-atoms / appMode，跨入口传参全部走 URL query。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { Sparkles, X, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pendingAgentRecommendationAtom } from '@/atoms/chat-atoms'
import { navigate } from '@/lib/router'

export function AgentRecommendBanner(): React.ReactElement | null {
  const [recommendation, setRecommendation] = useAtom(pendingAgentRecommendationAtom)
  const [migrating, setMigrating] = React.useState(false)

  if (!recommendation) return null

  const handleDismiss = (): void => {
    setRecommendation(null)
  }

  const handleMigrate = async (): Promise<void> => {
    if (migrating) return

    // 保存推荐数据后立即清除，避免模式切换时 ChatView 副作用
    const { conversationId, suggestedPrompt } = recommendation
    setRecommendation(null)

    setMigrating(true)
    try {
      // 渠道/模型/工作区均从设置读取，避免引入 agent-atoms
      const settings = await window.electronAPI.getSettings()
      const agentChannelId = settings.agentChannelId
      if (!agentChannelId) {
        toast.error('请先在设置中配置 Agent 渠道')
        return
      }

      // 1. 创建 Agent 会话
      const session = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId,
        settings.agentWorkspaceId ?? undefined,
        settings.agentModelId || undefined,
      )

      // 2. 迁移 Chat 对话记录到新 Agent 会话
      await window.electronAPI.migrateChatToAgent(conversationId, session.id)

      // 3. 跳转到 Agent 入口；建议提示词经 URL 传递，AgentShell 负责写入输入区建议
      const params = new URLSearchParams({
        session: session.id,
        prompt: suggestedPrompt,
      })
      navigate(`/agent?${params.toString()}`)

      // 4. 通知用户
      toast.success('已切换到 Agent 模式', {
        description: '对话历史已迁移到新的 Agent 会话',
      })
    } catch (error) {
      console.error('[AgentRecommendBanner] 迁移失败:', error)
      toast.error('切换到 Agent 模式失败')
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className="mx-4 mb-3 rounded-xl bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      {/* 头部 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-medium text-foreground">推荐使用 Agent 模式</span>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            onClick={handleDismiss}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 推荐理由 */}
      <div className="px-4 pb-3">
        <p className="text-sm text-foreground/80 leading-relaxed">
          {recommendation.reason}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-end px-4 pb-3">
        <Button
          variant="default"
          size="sm"
          onClick={handleMigrate}
          disabled={migrating}
          className="h-7 px-3 text-xs"
        >
          {migrating ? '切换中...' : '切换到 Agent 模式'}
          {!migrating && <ArrowRight className="size-3 ml-1" />}
        </Button>
      </div>
    </div>
  )
}
