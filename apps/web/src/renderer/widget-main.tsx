/**
 * 悬浮 Chatbox 独立入口（widget.html）
 *
 * 供第三方站点以 iframe 嵌入（embed.js 按 postMessage 尺寸协议扩缩 iframe），
 * 也可直接访问 /widget.html 使用。
 *
 * 独立 React root：jotai store 是页面级单例，主应用的初始化器覆盖不到这里，
 * 因此挂载最小必需集合——主题 / 登录用户 / 渠道 / Chat 全局流式监听 / Chat 工具 / 用户档案。
 * 未登录守卫由 ChatWidget 自渲染紧凑引导（shim-entry 已跳过全屏 LoginPage）。
 */

// 引入 Inter Variable 自托管字体（含 400/500/600/700 等所有字重）
import '@fontsource-variable/inter/index.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { useSetAtom } from 'jotai'
import { TooltipProvider } from './components/ui/tooltip'
import { ChatWidget } from './components/chat-widget'
import {
  ThemeInitializer,
  AuthInitializer,
  ChannelsInitializer,
  ChatListenersInitializer,
  ChatToolInitializer,
} from './initializers'
import { userProfileAtom } from './atoms/user-profile'
import './styles/globals.css'

// Widget 窗口标志：globals.css 据此应用透明背景与溢出约束
document.documentElement.classList.add('proma-widget-window')

/**
 * 用户档案初始化组件
 *
 * 主应用中用户档案由 LeftSidebar 加载，widget 无 LeftSidebar，需自行加载
 * （ChatMessages 头像、ChatView 系统提示词中的 userName 依赖该 atom）。
 */
function UserProfileInitializer(): null {
  const setUserProfile = useSetAtom(userProfileAtom)

  React.useEffect(() => {
    window.electronAPI.getUserProfile()
      .then(setUserProfile)
      .catch((err) => console.error('[UserProfileInitializer] 加载用户档案失败:', err))
  }, [setUserProfile])

  return null
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeInitializer />
    <AuthInitializer />
    <ChannelsInitializer />
    <ChatListenersInitializer />
    <ChatToolInitializer />
    <UserProfileInitializer />
    <TooltipProvider delayDuration={200}>
      <ChatWidget />
    </TooltipProvider>
  </React.StrictMode>
)
