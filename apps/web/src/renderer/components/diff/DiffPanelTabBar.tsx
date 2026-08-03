/**
 * DiffPanelTabBar — 右侧面板顶部 Tab 栏
 *
 * 切换「会话文件」「工作区文件」和「问答」三个视图。最右侧有关闭按钮。
 * 注：原「文件改动」Tab（Git/Diff）依赖桌面端 git 能力，Web 端未迁移，已移除。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { PanelRightClose, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WINDOW_CONTROLS_INSET_RIGHT } from '@/lib/platform'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { AgentSidePanelTab } from '@/atoms/agent-atoms'
import { interfaceVariantAtom } from '@/atoms/theme'

interface DiffPanelTabBarProps {
  activeTab: AgentSidePanelTab
  onTabChange: (tab: AgentSidePanelTab) => void
  onClose?: () => void
  onCloseChat?: () => void
  showChatTab?: boolean
  isWindows?: boolean
}

export function DiffPanelTabBar({
  activeTab,
  onTabChange,
  onClose,
  onCloseChat,
  showChatTab = false,
  isWindows = false,
}: DiffPanelTabBarProps): React.ReactElement {
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'

  return (
    <div className="flex items-end h-[34px] tabbar-bg relative flex-shrink-0">
      <div className={cn("absolute inset-0 titlebar-drag-region", isWindows && WINDOW_CONTROLS_INSET_RIGHT)} />
      <div className="relative flex items-end flex-1 titlebar-no-drag">
        <button
          type="button"
          onClick={() => onTabChange('session')}
          className={cn(
            'flex-1 px-3 h-[34px] text-xs transition-colors select-none cursor-pointer whitespace-nowrap overflow-hidden',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'border-t border-l border-r',
            activeTab === 'session'
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          会话文件
        </button>
        <button
          type="button"
          onClick={() => onTabChange('workspace')}
          className={cn(
            'flex-1 px-3 h-[34px] text-xs transition-colors select-none cursor-pointer whitespace-nowrap overflow-hidden',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'border-t border-l border-r',
            activeTab === 'workspace'
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          工作区文件
        </button>
        {showChatTab && (
          <div
            className={cn(
              'flex-1 h-[34px] text-xs transition-colors select-none relative whitespace-nowrap overflow-hidden',
              isClassic ? 'rounded-t-lg' : 'rounded-none',
              'border-t border-l border-r',
              activeTab === 'chat'
                ? isClassic
                  ? 'bg-content-area text-foreground border-border/50'
                  : 'app-tab-active text-foreground border-border/80'
                : isClassic
                  ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                  : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
            )}
          >
            <div className="flex h-full items-center">
              <button
                type="button"
                onClick={() => onTabChange('chat')}
                className="min-w-0 flex-1 self-stretch px-2 text-left"
              >
                <span className="block truncate text-center">问答</span>
              </button>
              {onCloseChat && (
                <button
                  type="button"
                  className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  aria-label="关闭问答 Tab"
                  onClick={onCloseChat}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}
        {/* 右侧关闭按钮（常驻） */}
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center size-[28px] mr-1 mb-[3px] rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
              >
                <PanelRightClose className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">折叠文件面板 ({navigator.platform.includes('Mac') ? '⌘⇧B' : 'Ctrl+Shift+B'})</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
