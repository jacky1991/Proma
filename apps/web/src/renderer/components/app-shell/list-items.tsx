/**
 * list-items - 左侧列表共享列表项原语
 *
 * 从 LeftSidebar 抽取的、Chat 的 ConversationItem 与 Agent 的 AgentSessionItem
 * 共用的底层组件与工具函数。本模块不得 import LeftSidebar，避免循环依赖。
 *
 * 包含：
 * - groupByDate / formatRelativeUpdatedAt：纯函数工具
 * - SessionQuickSwitchKeycap：快速切换键帽
 * - SafeTooltip：规避 Radix Popper 初始 (0,0) 定位的 Tooltip
 * - SessionItemActions：列表项右侧操作按钮组（置顶/归档/菜单）
 * - ConversationItem：Chat 对话列表项
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Pin, PinOff, Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
} from '@/components/session-preview/SessionMiniMapPopover'
import { interfaceVariantAtom } from '@/atoms/theme'
import { sessionHoverPreviewEnabledAtom } from '@/atoms/ui-preferences'
import type { ConversationMeta } from '@proma/shared'

/** 日期分组标签 */
export type DateGroup = '今天' | '昨天' | '更早'

/** 相对更新时间格式化（分钟/小时/天/月/年） */
export function formatRelativeUpdatedAt(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟`
  if (diff < day) return `${Math.floor(diff / hour)} 小时`
  if (diff < month) return `${Math.floor(diff / day)} 天`
  if (diff < year) return `${Math.floor(diff / month)} 月`
  return `${Math.floor(diff / year)} 年`
}

/** 按 updatedAt 将项目分为 今天 / 昨天 / 更早 三组 */
export function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: DateGroup; items: T[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: T[] = []
  const yesterday: T[] = []
  const earlier: T[] = []

  for (const item of items) {
    if (item.updatedAt >= todayStart) {
      today.push(item)
    } else if (item.updatedAt >= yesterdayStart) {
      yesterday.push(item)
    } else {
      earlier.push(item)
    }
  }

  const groups: Array<{ label: DateGroup; items: T[] }> = []
  if (today.length > 0) groups.push({ label: '今天', items: today })
  if (yesterday.length > 0) groups.push({ label: '昨天', items: yesterday })
  if (earlier.length > 0) groups.push({ label: '更早', items: earlier })
  return groups
}

/** 快速切换键帽（modifier + 数字），由外部 CSS 填充具体字形 */
export function SessionQuickSwitchKeycap(): React.ReactElement {
  return (
    <span className="session-quick-switch-keycap" aria-hidden="true">
      <span className="session-quick-switch-modifier" />
      <span className="session-quick-switch-number" />
    </span>
  )
}

/**
 * 安全 Tooltip：延迟渲染 Content，避开 Popper 初始定位 (0,0) 的闪现。
 *
 * 左侧列表项的操作按钮默认 hidden，hover 时才显示。Radix Popper 在 Content 首次挂载
 * 时若 trigger 尚未完成布局，会先把浮层放到视口左上角 (0,0)，再跳到正确位置。这里
 * 在 Radix 进入打开状态后，先让 Popper 有一小段时间完成定位，再真正渲染 Content；
 * 同时 trigger rect 为 0 时直接不打开。
 */
interface SafeTooltipProps {
  children: React.ReactElement
  content: React.ReactNode
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side']
}

export function SafeTooltip({ children, content, side = 'top' }: SafeTooltipProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [showContent, setShowContent] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const getUsableTriggerRect = React.useCallback((): DOMRect | null => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    if (rect.right <= 0 || rect.bottom <= 0) return null
    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null
    return rect
  }, [])

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleOpenChange = React.useCallback((nextOpen: boolean): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!nextOpen) {
      setOpen(false)
      setShowContent(false)
      return
    }

    // trigger 还没完成布局或已经离开视口时不打开。
    if (!getUsableTriggerRect()) return

    setOpen(true)
    // 先让 Radix 完成 Popper 定位，再渲染 Content，避免看到 (0,0) 初始位置。
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (!getUsableTriggerRect()) {
        setOpen(false)
        setShowContent(false)
        return
      }
      setShowContent(true)
    }, 60)
  }, [getUsableTriggerRect])

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild ref={triggerRef}>
        {children}
      </TooltipTrigger>
      {showContent && <TooltipContent side={side} hideWhenDetached>{content}</TooltipContent>}
    </Tooltip>
  )
}

/** SessionItemActions 的菜单项工厂：复用同一份菜单描述渲染 ContextMenu 与 DropdownMenu */
type MenuItemFactory = typeof DropdownMenuItem
type MenuSeparatorFactory = typeof DropdownMenuSeparator

export interface SessionItemActionsProps {
  updatedAt: number
  relativeTimeNow: number
  pinned: boolean
  archived: boolean
  onTogglePin: () => void
  onToggleArchive: () => void
  menuItems: (
    MenuItem: MenuItemFactory,
    MenuSeparator: MenuSeparatorFactory,
  ) => React.ReactNode
  onMenuOpenChange?: (open: boolean) => void
}

/**
 * 列表项右侧操作区：默认显示相对更新时间，hover 时切换为「置顶 / 归档 / 三点菜单」按钮组。
 * 归档需要二次确认；进入确认态后强制保持按钮可见，避免鼠标移开后用户失去反馈。
 */
export function SessionItemActions({
  updatedAt,
  relativeTimeNow,
  pinned,
  archived,
  onTogglePin,
  onToggleArchive,
  menuItems,
  onMenuOpenChange,
}: SessionItemActionsProps): React.ReactElement {
  const [archiveConfirming, setArchiveConfirming] = React.useState(false)
  // 菜单打开时强制保持按钮组可见：按钮始终保留布局，只切换透明度和 pointer-events。
  // 这样 Radix Popper 不会在 hover 切换瞬间读到 display:none 的 0 尺寸 trigger。
  const [menuOpen, setMenuOpen] = React.useState(false)

  React.useEffect(() => {
    if (!archiveConfirming) return
    const timer = setTimeout(() => setArchiveConfirming(false), 3000)
    return () => clearTimeout(timer)
  }, [archiveConfirming])

  const handleArchiveClick = (): void => {
    if (archived) {
      onToggleArchive()
      return
    }
    if (archiveConfirming) {
      setArchiveConfirming(false)
      onToggleArchive()
      return
    }
    setArchiveConfirming(true)
  }

  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMenuOpenChange = (open: boolean): void => {
    if (open) {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setMenuOpen(true)
    } else {
      // Delay hiding the trigger so Radix Popper can still read its rect during the close animation (~150ms).
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        setMenuOpen(false)
      }, 200)
    }
    onMenuOpenChange?.(open)
  }

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const forceVisible = archiveConfirming || menuOpen

  return (
    <div
      className="session-item-actions relative flex-shrink-0 h-[18px] w-[58px]"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        title={`最后更新：${new Date(updatedAt).toLocaleString('zh-CN')}`}
        className={cn(
          'absolute inset-y-0 right-0 block w-full overflow-hidden whitespace-nowrap text-right text-[11px] leading-[18px] tabular-nums text-foreground/35 transition-opacity duration-100',
          forceVisible ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
        )}
      >
        {formatRelativeUpdatedAt(updatedAt, relativeTimeNow)}
      </span>
      <div
        className={cn(
          'absolute right-1 top-0 flex items-center gap-0.5 transition-opacity duration-100',
          forceVisible
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
        )}
      >
        <SafeTooltip content={pinned ? '取消置顶' : '置顶'} side="top">
          <button
            className={cn(
              'p-0.5 rounded transition-colors',
              pinned
                ? 'text-primary/60 hover:bg-foreground/[0.08] hover:text-primary'
                : 'text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60',
            )}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        </SafeTooltip>
        <SafeTooltip
          content={archiveConfirming ? '再次点击确认归档' : archived ? '取消归档' : '归档'}
          side="top"
        >
          <button
            className={cn(
              'p-0.5 rounded transition-colors',
              archiveConfirming
                ? 'text-destructive bg-destructive/10'
                : archived
                  ? 'text-foreground/60 hover:bg-foreground/[0.08]'
                  : 'text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60',
            )}
            onClick={handleArchiveClick}
          >
            {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
        </SafeTooltip>
        <DropdownMenu onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'p-0.5 rounded text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors',
                'data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/60',
              )}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
            {menuItems(DropdownMenuItem, DropdownMenuSeparator)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ===== Chat 对话列表项 =====

export interface ConversationItemProps {
  conversation: ConversationMeta
  active: boolean
  streaming: boolean
  /** 是否在标题旁显示 Pin 图标 */
  showPinIcon: boolean
  relativeTimeNow: number
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

export const ConversationItem = React.memo(function ConversationItem({
  conversation,
  active,
  streaming,
  showPinIcon,
  relativeTimeNow,
  onSelect,
  onRequestDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
}: ConversationItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)
  // 设置关闭或菜单打开时禁用迷你地图预览（菜单打开时预览面板会盖住菜单项导致点不动）
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const preview = useSessionMiniMapHover(600, !sessionHoverPreviewEnabled || menuOpen)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'

  /** 进入编辑模式 */
  const startEdit = (): void => {
    setEditTitle(conversation.title)
    setEditing(true)
    justStartedEditing.current = true
    // 延迟聚焦，等待 ContextMenu 完全关闭后再 focus
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  /** 保存标题 */
  const saveTitle = async (): Promise<void> => {
    // ContextMenu 关闭导致的 blur，忽略
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false)
      return
    }
    await onRename(conversation.id, trimmed)
    setEditing(false)
  }

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const isPinned = !!conversation.pinned

  const menuItems = (
    MenuItem: MenuItemFactory,
    MenuSeparator: MenuSeparatorFactory,
  ) => (
    <>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(conversation.id)}>
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        {isPinned ? '取消置顶' : '置顶对话'}
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => startEdit()}>
        <Pencil size={14} />
        重命名
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onToggleArchive(conversation.id)}>
        {conversation.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {conversation.archived ? '取消归档' : '归档'}
      </MenuItem>
      <MenuSeparator className="my-0.5" />
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5 text-destructive" onSelect={() => onRequestDelete(conversation.id)}>
        <Trash2 size={14} />
        删除对话
      </MenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={preview.setAnchorRef}
          role="button"
          tabIndex={0}
          data-session-switch-id={conversation.id}
          data-session-switch-title={conversation.title}
          data-session-switch-type="chat"
          onClick={() => onSelect(conversation.id, conversation.title)}
          onMouseEnter={preview.handleMouseEnter}
          onMouseLeave={preview.handleMouseLeave}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          className={cn(
            'session-quick-switch-row group relative w-full flex items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1.5 transition-colors duration-100 titlebar-no-drag text-left',
            active && 'session-item-selected',
            streaming
              ? 'text-foreground font-medium hover:bg-foreground/[0.03]'
              : 'hover:bg-foreground/[0.03]',
            active && 'bg-foreground/[0.08]',
          )}
        >
          {(streaming || (isClassic && active)) && (
            <span
              className={cn(
                'absolute inset-y-0 left-0 w-[3px] rounded-l-md pointer-events-none',
                streaming ? 'bg-blue-500 animate-pulse' : 'bg-primary',
              )}
              aria-hidden="true"
            />
          )}
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
                maxLength={100}
              />
            ) : (
              <div className={cn(
                'truncate text-[13px] leading-[18px] flex items-center gap-1.5',
                active ? 'text-foreground' : 'text-foreground/80'
              )}>
                {/* 置顶标记 */}
                {showPinIcon && (
                  <Pin size={11} className="flex-shrink-0 text-primary/60" />
                )}
                <span className="truncate">{conversation.title}</span>
              </div>
            )}
          </div>

          {/* 默认显示时间，hover 时显示操作按钮 */}
          {!editing && (
            <SessionItemActions
              updatedAt={conversation.updatedAt}
              relativeTimeNow={relativeTimeNow}
              pinned={isPinned}
              archived={!!conversation.archived}
              onTogglePin={() => onTogglePin(conversation.id)}
              onToggleArchive={() => onToggleArchive(conversation.id)}
              onMenuOpenChange={setMenuOpen}
              menuItems={menuItems}
            />
          )}
          <SessionQuickSwitchKeycap />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
      {sessionHoverPreviewEnabled && (
        <SessionMiniMapPopover
          target={{
            type: 'chat',
            sessionId: conversation.id,
            title: conversation.title,
          }}
          anchorRef={preview.anchorRef}
          open={preview.isOpen}
          isLeaving={preview.isLeaving}
          onMouseEnter={preview.handlePanelMouseEnter}
          onMouseLeave={preview.handlePanelMouseLeave}
        />
      )}
    </ContextMenu>
  )
})
