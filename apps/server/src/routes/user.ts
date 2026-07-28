/**
 * 用户管理域 HTTP 路由（仅管理员）
 *
 * 用户列表 / 密码重置 / 删除用户。挂载于 /api 前缀下，路由形如 /api/user:list。
 * 全部路由经 adminOnly 角色校验（依赖全局 authMiddleware 先行写入用户上下文）。
 */

import { Hono } from 'hono'
import {
  listUsers,
  getUserById,
  resetPassword,
  deleteUser,
} from '@proma/server-core/user-manager'
import type { ResetUserPasswordInput } from '@proma/shared'
import { adminOnly } from '../middleware/role.ts'
import { toPublicUser } from './auth.ts'
import { validatePassword } from '../utils/password.ts'
import { orchestrator } from '../engine'
import { disconnectUser } from '../ws'

/** user:delete 请求体 */
interface DeleteUserInput {
  /** 目标用户 ID */
  userId?: string
  /** 删除确认标志，必须为 true（前端二次确认弹窗传入） */
  confirm?: boolean
}

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

  // 审计 target：被重置密码的用户 ID（供 adminOnly 记录）
  c.set('auditTarget', userId)
  resetPassword(userId, newPassword)
  return c.json({ ok: true })
})

/**
 * POST /api/user:delete
 *
 * 管理员删除用户，并级联清理其私有数据目录 users/{userId}/。
 * 请求体：{ userId, confirm }
 * - confirm 必须为 true（防误删，前端二次确认弹窗传入）
 * - 删除保护：禁止删除自己 / 内置 admin（路由预检转 400，底层 deleteUser 二次防御）
 *
 * 即时管控编排（M4 迭代 9，顺序关键）：通过保护预检后，先 stopByUser 终止运行中会话、
 * disconnectUser 以关闭码 4001 踢掉 WS 连接，最后 deleteUser 级联 rmSync——
 * 避免 rmSync 与运行中 SDK 写 JSONL 竞态（AC-9 / AC-10）。
 * 成功 → 200 { ok: true }
 * 缺 userId 或 confirm !== true → 400；用户不存在 → 404；触发删除保护 → 400（连接、会话不变）
 */
user.post('/user:delete', adminOnly, async (c) => {
  const body = await c.req.json<DeleteUserInput>()
  const userId = body.userId ?? ''

  if (!userId) {
    return c.json({ error: '缺少 userId' }, 400)
  }
  // confirm 必须为 true，防误删（前端二次确认弹窗传入）
  if (body.confirm !== true) {
    return c.json({ error: '缺少确认（confirm 必须为 true）' }, 400)
  }

  // 预检用户存在性，与 reset-password 保持一致
  const target = getUserById(userId)
  if (!target) {
    return c.json({ error: '用户不存在' }, 404)
  }

  // 审计 target：被删用户 ID（供 adminOnly 记录，AC-8）
  c.set('auditTarget', userId)

  // 操作者 ID 取自全局认证中间件写入的用户上下文
  const operator = c.get('user')

  // 删除保护预检（与底层 deleteUser 的保护一致）：必须前置到断连 / 停会话之前，
  // 否则「删自己 / 删内置 admin」被拒时，操作者自身的连接与会话已被误断开（AC-11：连接、会话不变）。
  if (target.username === 'admin') {
    return c.json({ error: '不能删除内置 admin 账户' }, 400)
  }
  if (userId === operator.userId) {
    return c.json({ error: '不能删除操作者自己' }, 400)
  }

  // 顺序关键（AC-10）：先停运行中会话 + 踢 WS 连接，再删数据。
  // 否则 deleteUser 的 rmSync 与运行中 SDK 写 JSONL 竞态，可能报错或残留句柄。
  orchestrator.stopByUser(userId)
  disconnectUser(userId)

  try {
    deleteUser(userId, operator.userId)
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除用户失败'
    return c.json({ error: message }, 400)
  }
  return c.json({ ok: true })
})

export { user }
