/**
 * 角色校验中间件
 *
 * 在全局认证中间件（middleware/auth.ts）之后使用，
 * 依赖 c.get('user') 已由 authMiddleware 写入。
 */

import type { Context, Next } from 'hono'

/**
 * 管理员专属路由中间件
 *
 * - user 缺失（防御：路径被误加入豁免白名单等异常情况）→ 401
 * - 角色非 admin → 403 { error, code: 'ADMIN_ONLY' }
 * - 校验通过 → 放行
 */
export async function adminOnly(c: Context, next: Next): Promise<Response | void> {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Unauthorized', code: 'NO_TOKEN' }, 401)
  }

  if (user.role !== 'admin') {
    return c.json({ error: '此操作仅管理员可用', code: 'ADMIN_ONLY' }, 403)
  }

  await next()
}
