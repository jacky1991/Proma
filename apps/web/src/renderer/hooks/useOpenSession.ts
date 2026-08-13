/**
 * useOpenSession — Agent 入口的「打开/聚焦会话 Tab」操作
 *
 * 封装 openTab + setTabs + setActiveTabId + setCurrentAgentSessionId 等，
 * 仅处理 Agent 侧状态（agent 会话/tab/工作区）。
 *
 * Chat 入口已独立（/chat），不再经此 hook；选中对话改用 useOpenConversation。
 * appMode 不再由此写入，改由各 Shell 挂载时设定为 shell 身份。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  openTab,
  buildOpenTabRestore,
  sessionViewStateMapAtom,
  type TabType,
} from '@/atoms/tab-atoms'
import { previewFileMapAtom } from '@/atoms/preview-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { automationFormAtom } from '@/atoms/automation-atoms'
import {
  currentAgentSessionIdAtom,
  agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'

type OpenSessionFn = (type: TabType, sessionId: string, title: string) => void

export function useOpenSession(): OpenSessionFn {
  const store = useStore()
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)

  return React.useCallback(
    (type: TabType, sessionId: string, title: string): void => {
      // 切回 agent 会话时，若该会话上次开着预览 Tab 则一并重建并回到上次视图
      const restore = type === 'agent' || type === 'preview'
        ? buildOpenTabRestore(
            sessionId,
            store.get(sessionViewStateMapAtom),
            store.get(previewFileMapAtom),
          )
        : undefined
      const result = openTab(tabs, { type, sessionId, title }, restore)
      setTabs(result.tabs)
      setActiveTabId(result.activeTabId)
      setAutomationForm({ open: false, draft: null })
      setActiveView('conversations')

      if (type === 'agent' || type === 'preview') {
        setCurrentAgentSessionId(sessionId)

        // 用户打开查看后只清除未读角标；是否完成由用户通过对勾确认。
        setUnviewedCompleted((prev) => {
          if (!prev.has(sessionId)) return prev
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })

        // 同步 workspaceId，确保与 TabBar 切换行为一致
        const session = agentSessions.find((s) => s.id === sessionId)
        if (session?.workspaceId) {
          setCurrentAgentWorkspaceId(session.workspaceId)
          window.electronAPI.updateSettings({
            agentWorkspaceId: session.workspaceId,
          }).catch(console.error)
        }
      } else {
        // scratch 等非 agent 会话入口：不切走 Agent 会话标识由 useSyncActiveTabSideEffects 处理
      }
    },
    [tabs, setTabs, setActiveTabId, setAutomationForm, setActiveView, setCurrentAgentSessionId, agentSessions, setCurrentAgentWorkspaceId, setUnviewedCompleted],
  )
}
