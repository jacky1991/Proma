/**
 * Auth Atoms - 当前登录用户状态（仅 Web 端有值）
 *
 * 数据真源是 Web shim 的 localStorage（auth-store 的 proma_user），
 * 此处的 atom 仅为内存投影，供 renderer 组件做角色判断（如管理员 UI 渲染）。
 * 由 main.tsx 的 AuthInitializer 在应用启动时经 window.electronAPI.getAuthUser 灌入；
 * Electron 端无登录概念，atom 恒为 null，UI 门控经 canManageAtom 天然放行。
 */

import { atom } from 'jotai'
import type { AuthUser } from '@proma/shared'
import { isWebRuntime } from '@/lib/web-runtime'

/** 当前登录用户（未登录或非 Web 环境为 null） */
export const authUserAtom = atom<AuthUser | null>(null)

/** 当前用户是否为管理员（非 Web 环境恒为 false） */
export const isAdminAtom = atom((get) => get(authUserAtom)?.role === 'admin')

/**
 * 管理类操作是否可用（共享资源写操作的门控入口；纯 Web 管理员专属页面用 isAdminAtom）
 *
 * - Web 端：仅管理员可执行渠道/提示词/工具等共享资源的写操作
 * - Electron 端：单用户本地应用无登录概念，恒为 true（全部功能可用）
 */
export const canManageAtom = atom((get) => !isWebRuntime() || get(authUserAtom)?.role === 'admin')
