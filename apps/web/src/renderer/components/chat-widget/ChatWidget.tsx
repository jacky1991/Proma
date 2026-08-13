/**
 * ChatWidget — 悬浮按钮 + 弹出 Chatbox
 *
 * 两种使用场景（同一组件）：
 * 1. 应用内：挂载于 App.tsx，fixed 定位于右下角（/chat 路由不挂载，避免与主 ChatView 并存）
 * 2. 第三方嵌入：widget.html 独立入口经 iframe 嵌入宿主页面，由 embed.js 按
 *    postMessage 尺寸协议扩缩 iframe（关闭时仅按钮大小，打开后展开为面板大小）
 *
 * 面板内复用 ChatView（隐藏 Header 与提示词侧栏、紧凑空态），
 * 绑定 useWidgetConversation 提供的专属固定对话。
 *
 * 未登录（仅 Web 端可能）：面板显示紧凑登录引导，同 origin 其他标签页
 * 登录完成后经 storage 事件自动恢复。
 */

import * as React from 'react'
import { MessageSquare, X, LogIn, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatView } from '@/components/chat/ChatView'
import { useWidgetConversation } from './useWidgetConversation'

/** 发给宿主页面的尺寸协议消息（embed.js 校验 source 字段） */
const WIDGET_MESSAGE_SOURCE = 'proma-widget'

/**
 * Widget 认证状态
 *
 * - Electron 端无 getAuthUser（无认证概念）→ 直接放行
 * - Web 端读取 localStorage 中的登录用户；同 origin 登录完成后
 *   经 storage 事件自动重试（iframe 与主站共享 localStorage）
 */
function useWidgetAuth(): { authed: boolean | null; retry: () => void } {
  const [authed, setAuthed] = React.useState<boolean | null>(null)

  const check = React.useCallback(async (): Promise<void> => {
    if (!window.electronAPI.getAuthUser) {
      setAuthed(true)
      return
    }
    try {
      const user = await window.electronAPI.getAuthUser()
      setAuthed(user !== null)
    } catch {
      // 认证检查异常时不阻塞聊天（后续请求失败会有各自错误提示）
      setAuthed(true)
    }
  }, [])

  React.useEffect(() => {
    void check()
  }, [check])

  React.useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key?.startsWith('proma_')) void check()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [check])

  return { authed, retry: () => void check() }
}

/** 悬浮圆形按钮 */
function WidgetFab({ open, onClick }: { open: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? '关闭对话' : '打开对话'}
      className={cn(
        'flex size-14 items-center justify-center rounded-full',
        'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
        'transition-transform duration-200 hover:scale-105 active:scale-95',
      )}
    >
      {open ? <X className="size-6" /> : <MessageSquare className="size-6" />}
    </button>
  )
}

/** 紧凑未登录引导（面板内容区） */
function WidgetLoginPrompt({ onRetry }: { onRetry: () => void }): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <LogIn className="size-5 text-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">登录 Proma 后继续聊天</p>
        <p className="text-xs text-muted-foreground">将在新标签页打开登录页，登录后此处自动恢复</p>
      </div>
      <button
        type="button"
        onClick={() => window.open('/', '_blank')}
        className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
      >
        去登录
      </button>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        已登录？点击重试
      </button>
    </div>
  )
}

export function ChatWidget(): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  // 首次展开后才创建/绑定专属对话并挂载 ChatView（避免常驻挂载即产生空对话）；
  // 之后面板保持挂载、关闭仅隐藏，输入草稿与滚动状态不丢失
  const [hasOpened, setHasOpened] = React.useState(false)
  // iframe 嵌入模式：仅在独立 widget 入口被第三方 iframe 加载时为 true
  const [embedded] = React.useState(() => window.parent !== window)
  const { authed, retry } = useWidgetAuth()
  const conversationId = useWidgetConversation(authed === true && hasOpened)

  const toggle = React.useCallback((next: boolean): void => {
    setOpen(next)
    if (next) setHasOpened(true)
    // 嵌入模式：通知宿主页面的 embed.js 扩缩 iframe
    if (embedded) {
      window.parent.postMessage({ source: WIDGET_MESSAGE_SOURCE, open: next }, '*')
    }
  }, [embedded])

  // ===== 面板内容 =====
  let body: React.ReactNode
  if (authed === null) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  } else if (!authed) {
    body = <WidgetLoginPrompt onRetry={retry} />
  } else if (!conversationId) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatView
          conversationId={conversationId}
          hideHeader
          hidePromptSidebar
          compactEmptyState
        />
      </div>
    )
  }

  // 面板：首次展开后常驻挂载，关闭仅隐藏（保留 ChatView 的输入草稿与滚动状态）
  const panel = hasOpened && (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-background',
        !open && 'hidden',
        embedded
          ? 'fixed inset-0'
          : 'w-[min(400px,calc(100vw-3rem))] h-[min(640px,calc(100dvh-8rem))] rounded-2xl shadow-2xl shadow-black/15 ring-1 ring-black/5 dark:ring-white/10',
      )}
    >
      {/* 紧凑头部 */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10">
          <MessageSquare className="size-3.5 text-primary" />
        </div>
        <span className="flex-1 text-sm font-medium text-foreground">快速对话</span>
        <button
          type="button"
          onClick={() => toggle(false)}
          aria-label="收起对话"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {body}
    </div>
  )

  // ===== 嵌入模式：面板铺满 iframe（尺寸由 embed.js 控制），关闭时只留按钮 =====
  if (embedded) {
    return (
      <>
        {panel}
        {!open && (
          <div className="fixed inset-0 flex items-center justify-center">
            <WidgetFab open={false} onClick={() => toggle(true)} />
          </div>
        )}
      </>
    )
  }

  // ===== 应用内模式：按钮常驻右下角，面板展开于按钮上方 =====
  return (
    <div className="fixed bottom-6 right-6 z-[90] flex flex-col items-end gap-4">
      {panel}
      <WidgetFab open={open} onClick={() => toggle(!open)} />
    </div>
  )
}
