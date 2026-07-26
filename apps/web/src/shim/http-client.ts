/**
 * HTTP 客户端：已迁移的 invoke 方法走此封装 → POST /api/<channel>
 *
 * 约定：shim 将 ipcRenderer.invoke(channel, ...args) 映射为 POST /api/<channel>，
 *   args 经 JSON 序列化为请求体（无参时不发 body）。
 *   响应体 JSON 解析后返回；空 body（如删除类接口）返回 undefined。
 *
 * 认证：每次请求自动附加 Authorization: Bearer <accessToken>。
 *   收到 401 时：用 refresh token 刷新（POST /api/auth:refresh），
 *   刷新成功则更新 token 并重试原请求；失败则 clearTokens + 跳转登录页。
 */

import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './auth-store.ts'

export interface ShimConfig {
  /** HTTP 接口基址，默认 '/api'（dev 期由 vite 代理到 server） */
  apiBase: string
  /** WebSocket 基址，默认 '/ws'（M2 迭代 3 启用） */
  wsBase: string
}

/** 防止并发 401 同时触发多次刷新（全局单例锁） */
let refreshPromise: Promise<boolean> | null = null

/** 刷新接口的响应格式 */
interface RefreshResponse {
  accessToken: string
  refreshToken: string
}

/**
 * 尝试用 refresh token 换取新的 token 对（并发安全，全局共享同一 Promise）
 * 返回 true 表示刷新成功并已写入 localStorage；false 表示失败
 */
function tryRefreshTokens(apiBase: string): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return false

    try {
      const res = await fetch(`${apiBase}/auth:refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return false

      const data = (await res.json()) as RefreshResponse
      if (!data.accessToken || !data.refreshToken) return false

      setTokens(data.accessToken, data.refreshToken)
      return true
    } catch {
      return false
    }
  })()

  // 无论成败，完成后释放锁，允许下次 401 再次触发刷新
  return refreshPromise.finally(() => {
    refreshPromise = null
  })
}

/** 带 status 标记的错误，用于区分 401 与其他 HTTP 错误 */
interface HttpError extends Error {
  status?: number
}

/**
 * 发起单次带认证头的请求（不含 401 重试逻辑）
 * @throws 带 status 属性的 HttpError（401 时 status=401）
 */
async function invokeWithAuth<T>(apiBase: string, channel: string, args: unknown): Promise<T> {
  const token = getAccessToken()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${apiBase}/${channel}`, {
    method: 'POST',
    headers,
    body: args === undefined ? undefined : JSON.stringify(args),
  })

  if (res.status === 401) {
    const err: HttpError = Object.assign(new Error(`接口 ${channel} 认证失败`), { status: 401 })
    throw err
  }

  if (!res.ok) {
    // 优先透传服务端返回的中文错误消息（{ error } 形状），解析失败时回退通用文案
    let message = `接口 ${channel} 调用失败：HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) {
        message = body.error
      }
    } catch {
      // 响应体非 JSON，保留通用文案
    }
    const err: HttpError = Object.assign(new Error(message), { status: res.status })
    throw err
  }

  // 部分接口无返回体（删除 / 更新类），容忍空 body
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/**
 * 401 处理：刷新 token → 成功则重试原请求；失败则清空 token 并跳转登录页
 * @throws 刷新失败时抛出认证错误
 */
async function handleUnauthorized<T>(
  apiBase: string,
  channel: string,
  args: unknown,
): Promise<T> {
  const refreshed = await tryRefreshTokens(apiBase)

  if (!refreshed) {
    clearTokens()
    // 已在登录页时不重复跳转，避免死循环
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new Error(`接口 ${channel} 认证失败，请重新登录`)
  }

  // 刷新成功：用新 token 重试原请求
  return invokeWithAuth<T>(apiBase, channel, args)
}

/** 构造一个绑定 apiBase 的 invoke 函数（自动携带 JWT，401 时透明刷新） */
export function createHttpClient(apiBase: string) {
  return async function invoke<T = unknown>(channel: string, args?: unknown): Promise<T> {
    try {
      return await invokeWithAuth<T>(apiBase, channel, args)
    } catch (err) {
      if ((err as HttpError).status === 401) {
        return handleUnauthorized<T>(apiBase, channel, args)
      }
      throw err
    }
  }
}
