import * as React from 'react'
import { TooltipProvider } from './components/ui/tooltip'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { LazyFallback } from './components/ui/lazy-fallback'
import { useRoute } from './lib/router'

// 路由级懒加载：Shell 与首装引导各自独立 chunk，避免相互进入首屏。
const OnboardingView = React.lazy(() =>
  import('./components/onboarding/OnboardingView').then((m) => ({ default: m.OnboardingView })),
)
const ChatShell = React.lazy(() =>
  import('./shells/ChatShell').then((m) => ({ default: m.ChatShell })),
)
const AgentShell = React.lazy(() =>
  import('./shells/AgentShell').then((m) => ({ default: m.AgentShell })),
)

export default function App(): React.ReactElement {
  const [isLoading, setIsLoading] = React.useState(true)
  const [showOnboarding, setShowOnboarding] = React.useState(false)
  const route = useRoute()

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

  // 路由主机：按 route 选择 Shell，Suspense 兜底懒加载；SettingsDialog 共享
  return (
    <TooltipProvider delayDuration={200}>
      <React.Suspense fallback={<LazyFallback className="h-screen" />}>
        {route === 'chat' ? <ChatShell /> : <AgentShell />}
      </React.Suspense>
      <SettingsDialog />
    </TooltipProvider>
  )
}
