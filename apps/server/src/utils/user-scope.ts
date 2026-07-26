/**
 * Hono 上下文 → UserScope 提取工具
 *
 * 认证中间件将用户信息写入 c.set('user', ...)，
 * 此函数将其转换为 manager 层所需的 UserScope，
 * 供各路由在调用 manager 函数时传递用户作用域。
 */

import type { Context } from 'hono'
import type { UserScope } from '@proma/server-core/config-paths'

/**
 * 从 Hono 上下文提取 UserScope
 *
 * 要求请求已通过认证中间件（c.get('user') 已设置）。
 * 若未经认证则 c.get('user') 为 undefined，调用方应确保路由受中间件保护。
 */
export function getUserScope(c: Context): UserScope {
  const user = c.get('user')
  return { userId: user.userId }
}
