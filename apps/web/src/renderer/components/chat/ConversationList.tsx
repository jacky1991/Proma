/**
 * ConversationList - Chat 入口的对话列表（自包含）
 *
 * 复用从 LeftSidebar 抽出的 ConversationItem，行为与原 LeftSidebar 的 chat 分支对齐：
 * - 加载对话列表写入 conversationsAtom（窗口聚焦时刷新；流式完成由全局监听器刷新）
 * - 顶部「新对话」按钮（继承当前选中模型/渠道）
 * - 活跃视图：置顶区 + 日期分组列表（groupByDate）
 * - 归档视图：可切换 active/archived，显示归档对话
 * - 选中对话：useOpenConversation（仅 set currentConversationIdAtom，Chat 入口无标签系统）
 * - 每项操作：重命名 / 置顶 / 归档 / 删除（删除时清理 per-conversation Map atoms）
 *
 * 与 Agent 侧的 useOpenSession 完全解耦。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { Plus, Search, Archive, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  conversationsAtom,
  currentConversationIdAtom,
  streamingConversationIdsAtom,
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
  conversationDraftsAtom,
  chatStreamErrorsAtom,
} from '@/atoms/chat-atoms'
import { conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { useOpenConversation } from '@/hooks/useOpenConversation'
import { useCreateConversation } from '@/hooks/useCreateConversation'
import { ConversationItem, groupByDate } from '@/components/app-shell/list-items'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'

/** 列表视图：活跃对话 / 归档对话 */
type ViewMode = 'active' | 'archived'

interface ConversationListProps {
  /** 外层容器 className（便于父级控制宽度/高度） */
  className?: string
  /** 是否渲染自带的「新对话 + 搜索」顶栏（默认 true）。
   *  嵌入 LeftSidebar 复用其顶栏时传 false，避免重复 */
  showHeader?: boolean
}

export function ConversationList({ className, showHeader = true }: ConversationListProps): React.ReactElement {
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const currentConversationId = useAtomValue(currentConversationIdAtom)
  const streamingIds = useAtomValue(streamingConversationIdsAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const store = useStore()
  const openConversation = useOpenConversation()

  // 归档视图切换（Chat 入口独立，使用本地状态，不与 Agent 侧边栏共享）
  const [viewMode, setViewMode] = React.useState<ViewMode>('active')
  // 相对时间刷新 tick，每分钟更新一次
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())

  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)

  // 新建对话（展开态顶部按钮，逻辑与折叠态 rail 共用 useCreateConversation）
  const createConversation = useCreateConversation()

  // per-conversation Map atoms 清理器（删除/归档时调用）
  const setConvModels = useSetAtom(conversationModelsAtom)
  const setConvContextLength = useSetAtom(conversationContextLengthAtom)
  const setConvThinking = useSetAtom(conversationThinkingEnabledAtom)
  const setConvParallel = useSetAtom(conversationParallelModeAtom)
  const setConvDrafts = useSetAtom(conversationDraftsAtom)
  const setChatStreamErrors = useSetAtom(chatStreamErrorsAtom)
  const setConvPromptId = useSetAtom(conversationPromptIdAtom)

  /** 清理 per-conversation Map atoms 条目（删除/归档是终态，避免孤立条目滞留内存） */
  const cleanupConversationMapAtoms = React.useCallback((id: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    }
    setConvModels(deleteKey)
    setConvContextLength(deleteKey)
    setConvThinking(deleteKey)
    setConvParallel(deleteKey)
    setConvDrafts(deleteKey)
    setChatStreamErrors(deleteKey)
    setConvPromptId(deleteKey)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvDrafts, setChatStreamErrors, setConvPromptId])

  // 初始加载对话列表
  React.useEffect(() => {
    window.electronAPI
      .listConversations()
      .then(setConversations)
      .catch(console.error)
  }, [setConversations])

  // 窗口聚焦时重新同步列表，修复长时间后前后端不一致
  React.useEffect(() => {
    const handleFocus = (): void => {
      window.electronAPI.listConversations().then(setConversations).catch(console.error)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [setConversations])

  // 相对时间每分钟刷新
  React.useEffect(() => {
    const id = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  /** 选中对话（仅设置 currentConversationId） */
  const handleSelect = React.useCallback((id: string): void => {
    openConversation(id)
  }, [openConversation])

  /** 重命名对话标题 */
  const handleRename = React.useCallback(async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateConversationTitle(id, newTitle)
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (error) {
      console.error('[对话列表] 重命名对话失败:', error)
    }
  }, [setConversations])

  /** 切换对话置顶状态 */
  const handleTogglePin = React.useCallback(async (id: string): Promise<void> => {
    try {
      const original = store.get(conversationsAtom).find((c) => c.id === id)
      const updated = await window.electronAPI.togglePinConversation(id)
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      // 归档会话被置顶时会自动取消归档
      if (original?.archived && updated.pinned && !updated.archived) {
        toast.success('已取消归档并置顶')
      }
    } catch (error) {
      console.error('[对话列表] 切换置顶失败:', error)
    }
  }, [store, setConversations])

  /** 切换对话归档状态 */
  const handleToggleArchive = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveConversation(id)
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      // 归档是终态：清理 per-conversation Map atoms 条目，避免孤立数据滞留
      if (updated.archived) {
        cleanupConversationMapAtoms(id)
      }
      toast.success(updated.archived ? '已归档' : '已取消归档')
    } catch (error) {
      console.error('[对话列表] 切换归档失败:', error)
    }
  }, [setConversations, cleanupConversationMapAtoms])

  /** 请求删除对话（弹出确认框） */
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const handleRequestDelete = React.useCallback((id: string): void => {
    setPendingDeleteId(id)
  }, [])

  /** 确认删除对话 */
  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDeleteId) return
    const targetId = pendingDeleteId
    // 清理 draft 标记（如有）
    store.set(draftSessionIdsAtom, (prev: Set<string>) => {
      if (!prev.has(targetId)) return prev
      const next = new Set(prev)
      next.delete(targetId)
      return next
    })
    // 清理 per-conversation Map atoms 条目
    cleanupConversationMapAtoms(targetId)
    try {
      await window.electronAPI.deleteConversation(targetId)
      const conversations = await window.electronAPI.listConversations()
      setConversations(conversations)
    } catch (error) {
      console.error('[对话列表] 删除对话失败:', error)
      // 即使后端报错，也从本地列表移除（可能是对话已不存在）
      setConversations((prev) => prev.filter((c) => c.id !== targetId))
    } finally {
      setPendingDeleteId(null)
    }
  }

  /** 置顶对话列表（仅活跃视图显示，排除 draft） */
  const pinnedConversations = React.useMemo(
    () => viewMode === 'active' ? conversations.filter((c) => c.pinned && !draftSessionIds.has(c.id)) : [],
    [conversations, viewMode, draftSessionIds],
  )

  /** 对话按日期分组（根据 viewMode 过滤归档状态，排除 draft；活跃视图排除置顶） */
  const conversationGroups = React.useMemo(
    () => {
      const filtered = viewMode === 'archived'
        ? conversations.filter((c) => c.archived && !draftSessionIds.has(c.id))
        : conversations.filter((c) => !c.archived && !c.pinned && !draftSessionIds.has(c.id))
      return groupByDate(filtered)
    },
    [conversations, viewMode, draftSessionIds],
  )

  /** 已归档对话数量 */
  const archivedConversationCount = React.useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations],
  )

  return (
    <div className={cn('flex flex-1 min-h-0 flex-col', className)}>
      {/* 新对话按钮 + 搜索按钮 */}
      {/* 新对话按钮 + 搜索按钮（嵌入 LeftSidebar 时由其顶栏提供，此处跳过） */}
      {showHeader && (
        <div className="px-3 pt-2 flex items-center gap-1.5">
          <button
            onClick={() => { void createConversation() }}
            className="flex-1 flex items-center gap-2 h-10 px-3 rounded-[10px] text-[13px] font-medium text-foreground/70 sidebar-control-surface hover:text-foreground transition-[background-color,color] duration-150 titlebar-no-drag"
          >
            <Plus size={14} />
            <span>新对话</span>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSearchDialogOpen(true)}
                className="flex-shrink-0 size-10 flex items-center justify-center rounded-[10px] text-foreground/40 sidebar-control-surface hover:text-foreground/60 transition-[background-color,color] duration-150 titlebar-no-drag"
              >
                <Search size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">搜索 ({getAcceleratorDisplay(getActiveAccelerator('global-search'))})</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* 列表主体 */}
      {viewMode === 'active' ? (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin titlebar-no-drag">
          {pinnedConversations.length > 0 && (
            <div className="pt-2 pb-1 flex-shrink-0 titlebar-no-drag">
              <div className="px-3.5 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                置顶
              </div>
              <div>
                <div className="px-2">
                  <div className="ml-4 flex flex-col gap-0.5">
                    {pinnedConversations.map((conv) => (
                      <ConversationItem
                        key={`pinned-${conv.id}`}
                        conversation={conv}
                        active={conv.id === currentConversationId}
                        streaming={streamingIds.has(conv.id)}
                        showPinIcon={false}
                        relativeTimeNow={relativeTimeNow}
                        onSelect={handleSelect}
                        onRequestDelete={handleRequestDelete}
                        onRename={handleRename}
                        onTogglePin={handleTogglePin}
                        onToggleArchive={handleToggleArchive}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="px-2 pt-2 pb-1 flex-shrink-0">
            <span className="px-1.5 text-[11px] font-medium text-foreground/40 select-none">对话</span>
          </div>

          <div className="px-2 pb-3">
            {conversationGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-1.5 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      active={conv.id === currentConversationId}
                      streaming={streamingIds.has(conv.id)}
                      showPinIcon={!!conv.pinned}
                      relativeTimeNow={relativeTimeNow}
                      onSelect={handleSelect}
                      onRequestDelete={handleRequestDelete}
                      onRename={handleRename}
                      onTogglePin={handleTogglePin}
                      onToggleArchive={handleToggleArchive}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* 归档视图标题栏 */}
          <div className="px-6 pt-3 pb-1">
            <div className="text-[12px] font-medium text-foreground/40">已归档对话</div>
          </div>
          {/* 归档视图：单列表布局 */}
          <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-thin titlebar-no-drag">
            {conversationGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      active={conv.id === currentConversationId}
                      streaming={streamingIds.has(conv.id)}
                      showPinIcon={!!conv.pinned}
                      relativeTimeNow={relativeTimeNow}
                      onSelect={handleSelect}
                      onRequestDelete={handleRequestDelete}
                      onRename={handleRename}
                      onTogglePin={handleTogglePin}
                      onToggleArchive={handleToggleArchive}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 已归档入口 / 返回活跃对话 */}
      <div className="px-3 pb-1">
        {viewMode === 'active' ? (
          archivedConversationCount > 0 && (
            <button
              onClick={() => setViewMode('archived')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag"
            >
              <Archive size={13} className="text-foreground/30" />
              <span>已归档 ({archivedConversationCount})</span>
            </button>
          )
        ) : (
          <button
            onClick={() => setViewMode('active')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/60 bg-foreground/[0.04] hover:bg-foreground/[0.07] hover:text-foreground/80 transition-colors titlebar-no-drag"
          >
            <ArrowLeft size={13} className="text-foreground/50" />
            <span>返回活跃对话</span>
          </button>
        )}
      </div>

      {/* 删除确认弹窗（与原 LeftSidebar chat 删除弹窗样式一致） */}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
      >
        <AlertDialogContent
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const target = e.target as HTMLElement
            if (target.closest('button[role="menuitem"], button[data-radix-dialog-action], button')) return
            e.preventDefault()
            void handleConfirmDelete()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除对话</AlertDialogTitle>
            <AlertDialogDescription>删除后将无法恢复，确定要删除这个对话吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { void handleConfirmDelete() }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
