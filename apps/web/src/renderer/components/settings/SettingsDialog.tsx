/**
 * SettingsDialog - 设置浮窗
 *
 * 以 Dialog 浮窗形式展示设置面板，不覆盖主内容区。
 * 使用低级 Dialog 原语实现轻遮罩 + 无默认关闭按钮（关闭按钮由 SettingsPanel 内部提供）。
 *
 * 性能：SettingsPanel（含 10 个子页、ChannelForm、McpServerForm 等重内容）改为懒加载。
 * Radix Content 默认 closed 时卸载，因此设置 chunk 仅在用户打开设置时才拉取，
 * 不进入首屏 main.js；同时保留 Radix 的开关动画。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { LazyFallback } from '@/components/ui/lazy-fallback'

// 懒加载设置面板主体，避免其重内容进入首屏 main.js
const SettingsPanel = React.lazy(() =>
  import('./SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
)

export function SettingsDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(settingsOpenAtom)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-black/40 titlebar-no-drag transition-opacity duration-100 data-[state=open]:opacity-100 data-[state=closed]:opacity-0"
        />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[100] translate-x-[-50%] translate-y-[-50%] w-[85vw] max-w-[992px] h-[85vh] max-h-[752px] bg-dialog text-dialog-foreground shadow-2xl rounded-xl overflow-hidden titlebar-no-drag transition-all duration-100 data-[state=open]:opacity-100 data-[state=open]:scale-100 data-[state=closed]:opacity-0 data-[state=closed]:scale-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">设置</DialogPrimitive.Title>
          <React.Suspense fallback={<LazyFallback className="h-full" />}>
            <SettingsPanel onClose={() => setOpen(false)} />
          </React.Suspense>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
