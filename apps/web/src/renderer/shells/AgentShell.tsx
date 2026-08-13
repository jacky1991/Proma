/**
 * AgentShell — Agent 入口（/agent）的 Shell
 *
 * 职责：
 * - 标记当前 shell 身份为 agent（appMode='agent'，供 AppShell 右侧面板门控等读取）
 * - 渲染三面板 AppShell（左侧栏 + 主区 + 右侧文件面板）
 * - 处理跨入口跳转：/agent?session=<id>&prompt=<...>，打开指定会话并预填建议提示词
 *
 * Agent 专属初始化器（AgentSettings/AgentListeners/Automation/TabStatePersistence/
 * ScratchPad/GlobalShortcuts/TabSwitcher）当前仍在 main.tsx 根节点常驻（共享 chunk），
 * 后续如需更彻底的 bundle 隔离可下沉到此处。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { AppShell } from '@/components/app-shell/AppShell'
import { useOpenSession } from '@/hooks/useOpenSession'
import { appModeAtom } from '@/atoms/app-mode'
import { agentPromptSuggestionsAtom } from '@/atoms/agent-atoms'
import { getQueryParam } from '@/lib/router'
import type { AppShellContextType } from '@/contexts/AppShellContext'

export function AgentShell(): React.ReactElement {
  const setAppMode = useSetAtom(appModeAtom)
  const openSession = useOpenSession()
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)

  // 标记当前 shell 身份为 agent
  React.useEffect(() => {
    setAppMode('agent')
  }, [setAppMode])

  // 跨入口跳转：/agent?session=<id>&prompt=<...>
  React.useEffect(() => {
    const sessionId = getQueryParam('session')
    if (!sessionId) return
    const prompt = getQueryParam('prompt')

    void (async () => {
      // 拉取会话列表以取真实标题（列表也会被 AutomationInitializer 加载，此处仅为取标题）
      let title = 'Agent 会话'
      try {
        const sessions = await window.electronAPI.listAgentSessions()
        const session = sessions.find((s) => s.id === sessionId)
        if (session?.title) title = session.title
      } catch (err) {
        console.error('[AgentShell] 加载会话列表失败:', err)
      }

      openSession('agent', sessionId, title)

      if (prompt) {
        setPromptSuggestions((prev) => {
          const map = new Map(prev)
          map.set(sessionId, prompt)
          return map
        })
      }

      // 清掉 URL query，避免刷新/后退重复触发
      window.history.replaceState(null, '', '/agent')
    })()
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const contextValue = React.useMemo<AppShellContextType>(() => ({}), [])

  return <AppShell contextValue={contextValue} />
}
