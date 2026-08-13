/**
 * MigrateToAgentButton — 切换到 Agent 入口按钮
 *
 * 常驻在助手消息 Action Bar 中，点击后：
 * 1. 创建 Agent 会话（渠道/模型/工作区取自设置）
 * 2. 迁移当前 Chat 对话历史到新 Agent 会话
 * 3. 跳转到 Agent 入口（/agent?session=<id>），由 AgentShell 负责打开该会话
 * 4. 通过 Sonner 通知用户已完成切换
 *
 * 解耦：不直接写 agent-atoms / tab-atoms / appMode，避免 Chat bundle 传递性引入 Agent 代码；
 * 跨入口传参全部走 URL query。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Bot, Loader2 } from 'lucide-react'
import { MessageAction } from '@/components/ai-elements/message'
import { navigate } from '@/lib/router'

interface MigrateToAgentButtonProps {
  /** 当前对话 ID */
  conversationId: string
}

export function MigrateToAgentButton({ conversationId }: MigrateToAgentButtonProps): React.ReactElement {
  const [migrating, setMigrating] = React.useState(false)

  const handleMigrate = async (): Promise<void> => {
    if (migrating) return

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

      // 3. 跳转到 Agent 入口并定位到新会话（AgentShell 挂载时会刷新会话列表并打开 ?session）
      navigate(`/agent?session=${encodeURIComponent(session.id)}`)

      // 4. 通知用户
      toast.success('已切换到 Agent 模式', {
        description: '对话历史已迁移到新的 Agent 会话',
      })
    } catch (error) {
      console.error('[MigrateToAgentButton] 迁移失败:', error)
      toast.error('切换到 Agent 模式失败')
    } finally {
      setMigrating(false)
    }
  }

  return (
    <MessageAction
      tooltip={migrating ? '切换中...' : '切换到 Agent 模式'}
      onClick={() => { void handleMigrate() }}
      disabled={migrating}
    >
      {migrating ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Bot className="size-3.5" />
      )}
    </MessageAction>
  )
}
