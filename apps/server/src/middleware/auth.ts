/**
 * Hono 认证中间件
 *
 * 从 Authorization: Bearer <token> 提取并校验 JWT，
 * 校验通过后将用户信息写入 c.set('user', ...)。
 *
 * AUTH_EXEMPT_PATHS 中的路径（健康检查 / 注册 / 登录 / 刷新）免鉴权，
 * 由 app.ts 在挂载全局中间件时排除。
 */

import type { Context, Next } from 'hono'
import { verifyToken } from '../auth/jwt.ts'

/** 写入 Hono 上下文的用户信息 */
interface UserContext {
  userId: string
  username: string
  role: 'admin' | 'user'
}

// Hono 类型扩展：让 c.get('user') / c.set('user', ...) 获得类型提示
declare module 'hono' {
  interface ContextVariableMap {
    user: UserContext
  }
}

/** 免鉴权路径白名单（供 app.ts 使用） */
export const AUTH_EXEMPT_PATHS = [
  '/api/health',
  '/api/auth:register',
  '/api/auth:login',
  '/api/auth:refresh',
  // 品牌配置（产品名称 + Logo）：所有用户与登录页都需要读取展示
  '/api/branding:get',
]

/**
 * 认证中间件
 *
 * - 无 token → 401 { error: 'Unauthorized', code: 'NO_TOKEN' }
 * - token 无效 / 过期 → 401 { error: 'Unauthorized', code: 'INVALID_TOKEN' }
 * - 校验通过 → c.set('user', ...) 后放行
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''

  if (!token) {
    return c.json({ error: 'Unauthorized', code: 'NO_TOKEN' }, 401)
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ error: 'Unauthorized', code: 'INVALID_TOKEN' }, 401)
  }

  c.set('user', {
    userId: payload.sub,
    username: payload.username,
    role: payload.role,
  })

  await next()
}
