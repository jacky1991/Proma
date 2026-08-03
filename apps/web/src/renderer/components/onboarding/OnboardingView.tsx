/**
 * Onboarding 视图组件
 *
 * 首次启动时显示的全屏欢迎界面。
 * 注：Web 端不做本地环境检测（Node/Git/Shell 在服务端），仅展示欢迎页。
 */

import { Button } from '@/components/ui/button'

interface OnboardingViewProps {
  onComplete: () => void
}

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const handleFinish = async () => {
    await window.electronAPI.updateSettings({ onboardingCompleted: true })
    onComplete()
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-8">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold mb-4">欢迎使用 Proma</h1>
        <p className="text-lg text-muted-foreground">
          下一代桌面 AI 软件，让通用 Agent 触手可及
        </p>
      </div>

      <div className="w-full max-w-2xl mt-8 flex flex-col items-center gap-2">
        <Button className="w-full h-12 text-base" onClick={handleFinish}>
          开始使用
        </Button>
        <p className="text-xs text-muted-foreground/60">
          这些内容之后也能在设置中找到，不用担心错过
        </p>
      </div>
    </div>
  )
}
