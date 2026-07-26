/**
 * 用户管理域 HTTP 路由（仅管理员）
 *
 * 用户列表 / 密码重置。挂载于 /api 前缀下，路由形如 /api/user:list。
 * 全部路由经 adminOnly 角色校验（依赖全局 authMiddleware 先行写入用户上下文）。
 */

import { Hono } from 'hono'
import {
  listUsers,
  getUserById,
  resetPassword,
} from '@proma/server-core/user-manager'
import type { ResetUserPasswordInput } from '@proma/shared'
import { adminOnly } from '../middleware/role.ts'
import { toPublicUser } from './auth.ts'
import { validatePassword } from '../utils/password.ts'

const user = new Hono()

/**
 * POST /api/user:list
 *
 * 列出全部用户（仅公开字段，不含 passwordHash）。
 * 成功 → 200 AuthUser[]
 */
user.post('/user:list', adminOnly, (c) => {
  return c.json(listUsers().map(toPublicUser))
})

/**
 * POST /api/user:reset-password
 *
 * 管理员重置任意用户密码（无需旧密码，允许重置管理员自己）。
 * 请求体：{ userId, newPassword }
 * 成功 → 200 { ok: true }
 * 用户不存在 → 404；新密码不合法 → 400
 */
user.post('/user:reset-password', adminOnly, async (c) => {
  const body = await c.req.json<ResetUserPasswordInput>()
  const userId = body.userId ?? ''
  const newPassword = body.newPassword ?? ''

  if (!userId) {
    return c.json({ error: '缺少 userId' }, 400)
  }
  const invalid = validatePassword(newPassword)
  if (invalid) {
    return c.json({ error: invalid }, 400)
  }

  // 预检用户存在性，避免对不存在的用户付出 bcrypt 哈希开销
  if (!getUserById(userId)) {
    return c.json({ error: '用户不存在' }, 404)
  }

  resetPassword(userId, newPassword)
  return c.json({ ok: true })
})

export { user }
