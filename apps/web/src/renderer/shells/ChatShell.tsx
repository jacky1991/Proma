/**
 * ChatShell — Chat 入口（/chat）的 Shell
 *
 * 职责：
 * - 布局：LeftSidebar（复用 Agent 同款侧栏：品牌区 + 折叠 rail + 底部头像/设置；
 *   LeftSidebar 内部按 /chat 路由渲染对话列表、隐藏自动化/技能入口）| 当前对话（ChatView）
 * - 未选会话时展示欢迎空态
 *
 * LeftSidebar 按路由（useRoute）判定 chat/agent 形态，故此处无需再写 appMode。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import { ChatView } from '@/components/chat'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import { MessageSquare } from 'lucide-react'

function ChatEmptyState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center bg-content-area">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <MessageSquare className="size-10 text-muted-foreground/40" />
        <p className="text-sm">选择左侧对话开始聊天，或点击「新对话」</p>
      </div>
    </div>
  )
}

export function ChatShell(): React.ReactElement {
  const currentConversationId = useAtomValue(currentConversationIdAtom)

  return (
    <div className="shell-bg h-screen w-screen flex overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
      <LeftSidebar />
      <div className="flex-1 min-w-0 relative">
        {currentConversationId ? (
          <ChatView conversationId={currentConversationId} />
        ) : (
          <ChatEmptyState />
        )}
      </div>
    </div>
  )
}
