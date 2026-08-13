/**
 * TabContent — 标签内容渲染器（Agent 入口专用）
 *
 * 根据标签类型渲染 AgentView / 预览 / ScratchPad。Chat 对话已独立到 /chat 入口，
 * 此处不再处理 chat 标签，也不再 import ChatView（避免 Agent bundle 拖入 Chat 代码）。
 * 直接传递 sessionId prop，无需桥接全局 atoms。
 *
 * 性能：AgentView / PreviewTabContent / ScratchPadView 均懒加载，避免其内容进入首屏 main.js。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { tabsAtom } from '@/atoms/tab-atoms'
import { TabErrorBoundary } from './TabErrorBoundary'
import { LazyFallback } from '@/components/ui/lazy-fallback'

// 懒加载非默认视图，避免其内容进入首屏 main.js
const AgentView = React.lazy(() =>
  import('@/components/agent').then((m) => ({ default: m.AgentView })),
)
const PreviewTabContent = React.lazy(() =>
  import('@/components/diff/PreviewTabContent').then((m) => ({ default: m.PreviewTabContent })),
)
const ScratchPadView = React.lazy(() =>
  import('@/components/scratch-pad/ScratchPadView').then((m) => ({ default: m.ScratchPadView })),
)

export interface TabContentProps {
  tabId: string
}

export function TabContent({ tabId }: TabContentProps): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)

  // [FLASH-DEBUG] 监控 tab 查找失败（说明 tabId 指向了不存在的标签）
  React.useEffect(() => {
    if (!tab) {
      console.warn(`[FLASH-DEBUG] TabContent: tab not found for tabId="${tabId}"`, { tabIds: tabs.map(t => t.id) })
    }
  }, [tab, tabId, tabs])

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        标签页不存在
      </div>
    )
  }

  if (tab.type === 'scratch') {
    return (
      <React.Suspense fallback={<LazyFallback className="h-full" />}>
        <ScratchPadView />
      </React.Suspense>
    )
  }

  if (tab.type === 'preview') {
    return (
      <TabErrorBoundary key={tab.id} sessionId={tab.sessionId}>
        <React.Suspense fallback={<LazyFallback className="h-full" />}>
          <PreviewTabContent sessionId={tab.sessionId} />
        </React.Suspense>
      </TabErrorBoundary>
    )
  }

  return (
    <TabErrorBoundary key={tab.sessionId} sessionId={tab.sessionId}>
      <React.Suspense fallback={<LazyFallback className="h-full" />}>
        <AgentView sessionId={tab.sessionId} />
      </React.Suspense>
    </TabErrorBoundary>
  )
}
