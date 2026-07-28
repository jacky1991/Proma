/**
 * 角色校验中间件
 *
 * 在全局认证中间件（middleware/auth.ts）之后使用，
 * 依赖 c.get('user') 已由 authMiddleware 写入。
 */

import type { Context, Next } from 'hono'
import { recordAudit } from '@proma/server-core/audit-log'

/**
 * 审计目标（受影响对象 ID）：handler 内经 c.set('auditTarget', id) 设置后，
 * 供 adminOnly 在请求成功时记入审计条目（M4 迭代 10）。
 */
declare module 'hono' {
  interface ContextVariableMap {
    auditTarget?: string
  }
}

/**
 * 管理员专属路由中间件
 *
 * - user 缺失（防御：路径被误加入豁免白名单等异常情况）→ 401
 * - 角色非 admin → 403 { error, code: 'ADMIN_ONLY' }（不记 success 审计，AC-10）
 * - 校验通过且 handler 成功（status<400）→ 放行后追加一条审计（AC-9）
 *
 * 审计设计（M4 迭代 10）：将审计内置到 adminOnly，零路由改动覆盖全部管理员路由；
 * action 取路由路径（去掉 /api/ 前缀，如 'channel:create' / 'user:delete'），
 * target 由 handler 经 c.set('auditTarget', ...) 可选设置。
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

  // 通过角色校验且 handler 成功 → 记审计；失败 / 拒绝不记 success
  if (c.res.status < 400) {
    const action = c.req.path.replace(/^\/api\//, '') || c.req.path
    recordAudit({
      actor: user.userId,
      actorName: user.username,
      action,
      target: c.get('auditTarget'),
      result: 'success',
    })
  }
}
