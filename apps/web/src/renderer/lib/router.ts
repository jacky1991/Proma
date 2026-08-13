/**
 * 最小客户端路由层（无第三方依赖）
 *
 * 仅两个入口（/chat 与 /agent），手写比引入 react-router 更轻，贴合项目
 * 「简单直接、配置优先」的风格。shim-entry.ts 已有按 pathname 判定 /login 的先例。
 *
 * 设计：
 * - parseRoute(pathname)：/chat 开头 → 'chat'；其余（含 / 、/agent、未识别）→ 'agent'，
 *   保持当前默认 = agent。
 * - navigate(path)：history.pushState 后主动派发 popstate，让 useRoute 订阅即时生效。
 * - useRoute()：订阅 popstate，返回当前 Route。
 */

import * as React from 'react'

export type Route = 'chat' | 'agent'

export const CHAT_PATH = '/chat'
export const AGENT_PATH = '/agent'

/** 解析 pathname 到路由；未识别与根路径默认 agent（保持当前默认行为） */
export function parseRoute(pathname: string): Route {
  if (pathname.startsWith('/chat')) return 'chat'
  return 'agent'
}

/** 客户端导航：pushState + 派发 popstate 触发 useRoute 订阅 */
export function navigate(path: string): void {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** 读取当前 URL 的 ?session=<id> 参数（跨入口跳转传参用） */
export function getQueryParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key)
}

/** 订阅当前路由：pathname 变化（含 navigate 派发的 popstate）时更新 */
export function useRoute(): Route {
  const [route, setRoute] = React.useState<Route>(() =>
    parseRoute(window.location.pathname),
  )

  React.useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  return route
}
