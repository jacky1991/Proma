import * as React from 'react'
import { AppShell } from './components/app-shell/AppShell'
import { TooltipProvider } from './components/ui/tooltip'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { LazyFallback } from './components/ui/lazy-fallback'
import type { AppShellContextType } from './contexts/AppShellContext'

// 路由级懒加载：首装引导仅在首次启动时需要，拆出独立 chunk，避免其内容进入首屏 main.js。
const OnboardingView = React.lazy(() =>
  import('./components/onboarding/OnboardingView').then((m) => ({ default: m.OnboardingView })),
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
  // Web 端不做本地环境检测（Node/Git/Shell 在服务端），首装仅展示欢迎页。
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
    </TooltipProvider>
  )
}
