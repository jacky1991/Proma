/**
 * Auth Atoms - 当前登录用户状态（仅 Web 端）
 *
 * 数据真源是 Web shim 的 localStorage（auth-store），
 * 此处的 atom 仅为内存投影，供 renderer 组件做角色判断（如管理员 UI 渲染）。
 * Electron 端 getAuthUser 不存在，atom 恒为 null，天然降级。
 */

import { useEffect } from 'react'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import type { AuthUser } from '@proma/shared'

/** 当前登录用户（未登录或非 Web 环境为 null） */
export const currentUserAtom = atom<AuthUser | null>(null)

/** 当前用户是否为管理员 */
export const isAdminAtom = atom((get) => get(currentUserAtom)?.role === 'admin')

/** 模块级加载守卫：全应用只发起一次加载 */
let ensureStarted = false

/**
 * 确保当前用户已加载，并返回当前用户
 *
 * 首次调用时经 window.electronAPI.getAuthUser 从 localStorage 读取（幂等）。
 * 需要用户信息的组件（如账号设置）在顶层调用。
 */
export function useEnsureCurrentUser(): AuthUser | null {
  const currentUser = useAtomValue(currentUserAtom)
  const setCurrentUser = useSetAtom(currentUserAtom)

  useEffect(() => {
    if (ensureStarted) return
    ensureStarted = true
    // 写入 atom 属于 store 写入，组件卸载后到达的响应亦可安全写入
    void window.electronAPI.getAuthUser?.().then((u) => setCurrentUser(u ?? null))
  }, [setCurrentUser])

  return currentUser
}
