/**
 * 共享初始化器
 *
 * 主入口（main.tsx）与悬浮 Chatbox 独立入口（widget-main.tsx）共用的
 * 最小初始化器集合。widget 入口是独立 React root（jotai store 为页面级单例），
 * 必须自行挂载这些初始化器才能获得主题、渠道列表与 Chat 流式监听。
 */

import { useEffect, useMemo } from 'react'
import { useSetAtom, useAtomValue, useStore } from 'jotai'
import {
  themeModeAtom,
  themeStyleAtom,
  interfaceVariantAtom,
  systemIsDarkAtom,
  applyThemeToDOM,
  applyInterfaceVariantToDOM,
  initializeTheme,
} from './atoms/theme'
import { authUserAtom } from './atoms/auth'
import { selectedModelAtom } from './atoms/chat-atoms'
import { channelsAtom, channelsLoadedAtom } from './atoms/channels-atoms'
import { useGlobalChatListeners } from './hooks/useGlobalChatListeners'

/**
 * 主题初始化组件
 *
 * 负责从主进程加载主题设置、监听系统主题变化、
 * 并将最终主题同步到 DOM。
 */
export function ThemeInitializer(): null {
  const setThemeMode = useSetAtom(themeModeAtom)
  const setThemeStyle = useSetAtom(themeStyleAtom)
  const setInterfaceVariant = useSetAtom(interfaceVariantAtom)
  const setSystemIsDark = useSetAtom(systemIsDarkAtom)
  const themeMode = useAtomValue(themeModeAtom)
  const themeStyle = useAtomValue(themeStyleAtom)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const systemIsDark = useAtomValue(systemIsDarkAtom)

  // 初始化：从主进程加载设置 + 订阅系统主题变化
  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | undefined

    initializeTheme(setThemeMode, setSystemIsDark, setThemeStyle, setInterfaceVariant).then((fn) => {
      if (isMounted) {
        cleanup = fn
      } else {
        // 组件已卸载（StrictMode 场景），立即清理监听器
        fn()
      }
    })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [setThemeMode, setSystemIsDark, setThemeStyle, setInterfaceVariant])

  // 响应式应用主题到 DOM
  // 用 useMemo 计算"实际会影响 DOM 的状态签名"作为唯一依赖：
  // special 模式下 systemIsDark 不影响最终 class，避免系统主题变化时触发无意义的
  // applyThemeToDOM 调用（配合 applyThemeToDOM 内部的幂等检查双重兜底）。
  const themeSignature = useMemo(() => {
    if (themeMode === 'special') {
      return `special:${themeStyle}`
    }
    if (themeMode === 'system') {
      return `system:${systemIsDark ? 'dark' : 'light'}`
    }
    return themeMode
  }, [themeMode, themeStyle, systemIsDark])

  useEffect(() => {
    applyThemeToDOM(themeMode, themeStyle, systemIsDark)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeSignature])

  useEffect(() => {
    applyInterfaceVariantToDOM(interfaceVariant)
  }, [interfaceVariant])

  return null
}

/**
 * 登录用户初始化组件
 *
 * Web 端从 localStorage（auth-store）读取当前登录用户（含角色）写入 atom，
 * 供设置页角色门控使用；登录成功后整页重载进主应用，启动灌入即可。
 * Electron 端 getAuthUser 不存在，atom 保持 null，门控经 canManageAtom 放行。
 */
export function AuthInitializer(): null {
  const setAuthUser = useSetAtom(authUserAtom)

  useEffect(() => {
    window.electronAPI.getAuthUser?.()
      .then((user) => setAuthUser(user ?? null))
      .catch((err) => console.error('[AuthInitializer] 加载登录用户失败:', err))
  }, [setAuthUser])

  return null
}

/**
 * 渠道列表初始化组件（共享，根常驻）
 *
 * 启动时加载全局渠道列表写入共享 atom（Chat 与 Agent 都从这里取），
 * 并校验 Chat 全局默认模型是否仍指向有效渠道。原职责从 AgentSettingsInitializer 上提，
 * 以便 Chat 入口（不挂载 AgentSettingsInitializer）也能拿到渠道列表。
 */
export function ChannelsInitializer(): null {
  const setChannels = useSetAtom(channelsAtom)
  const setChannelsLoaded = useSetAtom(channelsLoadedAtom)
  const store = useStore()

  useEffect(() => {
    window.electronAPI.listChannels()
      .then((channels) => {
        setChannels(channels)
        setChannelsLoaded(true)

        // 校验 Chat 全局默认模型（localStorage 持久化的可能指向已删除渠道）
        const channelIds = new Set(channels.map((c) => c.id))
        const chatModel = store.get(selectedModelAtom)
        if (chatModel && !channelIds.has(chatModel.channelId)) {
          console.warn('[Channels] selectedModel 指向已删除的渠道，清除')
          store.set(selectedModelAtom, null)
        }
      })
      .catch((err) => {
        console.error('[ChannelsInitializer] 加载渠道失败:', err)
        setChannelsLoaded(true) // 即使出错也标记就绪，避免 AgentSettingsInitializer 永远等待
      })
  }, [setChannels, setChannelsLoaded, store])

  return null
}

/**
 * Chat IPC 监听器初始化组件
 *
 * 全局挂载，永不销毁。确保 Chat 流式事件
 * 在页面切换时不丢失。
 */
export function ChatListenersInitializer(): null {
  useGlobalChatListeners()
  return null
}
