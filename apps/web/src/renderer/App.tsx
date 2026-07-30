import * as React from 'react'
import { useAtom } from 'jotai'
import { AppShell } from './components/app-shell/AppShell'
import { TooltipProvider } from './components/ui/tooltip'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { LazyFallback } from './components/ui/lazy-fallback'
import { environmentCheckDialogOpenAtom } from './atoms/environment'
import type { AppShellContextType } from './contexts/AppShellContext'

// 路由级懒加载：以下组件仅在特定条件（首装 / 异常 / 数据迁移）下才需要，
// 拆出独立 chunk，避免其内容进入首屏 main.js。
const OnboardingView = React.lazy(() =>
  import('./components/onboarding/OnboardingView').then((m) => ({ default: m.OnboardingView })),
)
const EnvironmentCheckDialog = React.lazy(() =>
  import('./components/environment/EnvironmentCheckDialog').then((m) => ({
    default: m.EnvironmentCheckDialog,
  })),
)
const MigrationImportDialog = React.lazy(() =>
  import('./components/migration/MigrationImportDialog').then((m) => ({
    default: m.MigrationImportDialog,
  })),
)

export default function App(): React.ReactElement {
  // [FLASH-DEBUG] 监控 App 组件重渲染（如果看到频繁日志，说明根组件被频繁重渲染）
  const appRenderCountRef = React.useRef(0)
  appRenderCountRef.current++
  if (appRenderCountRef.current > 1) {
    console.warn(`[FLASH-DEBUG] App re-render #${appRenderCountRef.current}, isLoading/showOnboarding may have changed`)
  }

  const [isLoading, setIsLoading] = React.useState(true)
  const [showOnboarding, setShowOnboarding] = React.useState(false)

  // 初始化：检查是否需要显示 Onboarding
  // macOS/Linux 上 SDK 自带 claude native binary 不依赖宿主 Node/Git；
  // Windows 上仍需 Git Bash/WSL，由 Onboarding Step 2 与聊天错误卡片引导用户安装。
  React.useEffect(() => {
    const initialize = async () => {
      try {
        const settings = await window.electronAPI.getSettings()
        if (!settings.onboardingCompleted) {
          setShowOnboarding(true)
        }
      } catch (error) {
        console.error('[App] 初始化失败:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initialize()
  }, [])

  // 完成 onboarding 回调：关闭 onboarding，进入主界面
  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
  }

  // 加载中状态
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">正在初始化...</p>
        </div>
      </div>
    )
  }

  // 显示 onboarding 界面
  if (showOnboarding) {
    return (
      <TooltipProvider delayDuration={200}>
        <React.Suspense fallback={<LazyFallback className="h-screen" />}>
          <OnboardingView onComplete={handleOnboardingComplete} />
        </React.Suspense>
        <React.Suspense fallback={null}>
          <MigrationImportDialog />
        </React.Suspense>
      </TooltipProvider>
    )
  }

  // Placeholder context value
  const contextValue: AppShellContextType = {}

  // 显示主界面
  return (
    <TooltipProvider delayDuration={200}>
      <AppShell contextValue={contextValue} />
      <SettingsDialog />
      <GlobalEnvironmentCheckDialog />
      <React.Suspense fallback={null}>
        <MigrationImportDialog />
      </React.Suspense>
    </TooltipProvider>
  )
}

/**
 * 全局环境检测 Dialog，由错误卡片的 recovery action 按钮打开。
 */
function GlobalEnvironmentCheckDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(environmentCheckDialogOpenAtom)
  return (
    <React.Suspense fallback={null}>
      <EnvironmentCheckDialog open={open} onOpenChange={setOpen} />
    </React.Suspense>
  )
}
