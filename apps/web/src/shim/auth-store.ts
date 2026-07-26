/**
 * Token 与当前用户存储（localStorage）
 *
 * 管理 JWT access token、refresh token 及当前登录用户信息（含角色）的读写与清除。
 * 供 http-client、ws-client、LoginPage 和 renderer（经 shim）共用。
 */

import type { AuthUser } from '@proma/shared'

const ACCESS_TOKEN_KEY = 'proma_access_token'
const REFRESH_TOKEN_KEY = 'proma_refresh_token'
/** 当前登录用户（登录响应中的公开用户信息，含 role） */
const USER_KEY = 'proma_user'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, access)
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null
}

/**
 * 读取当前登录用户信息
 *
 * @returns 用户信息；未登录或数据损坏时返回 null
 */
export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

/** 保存当前登录用户信息（登录 / 注册成功后调用） */
export function setStoredUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
