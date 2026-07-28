/**
 * 认证域 HTTP 路由
 *
 * 注册 / 登录 / 刷新 / 登出 / 当前用户。
 * 挂载于 /api 前缀下，故路由形如 /api/auth:register。
 */

import { Hono } from 'hono'
import {
  createUser,
  verifyUser,
  getUserById,
  resetPassword,
} from '@proma/server-core/user-manager'
import type { User } from '@proma/server-core/user-manager'
import type { AuthUser, ChangePasswordInput } from '@proma/shared'
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/jwt.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { validatePassword } from '../utils/password.ts'
import { recordAudit } from '@proma/server-core/audit-log'

const auth = new Hono()

/** 用户名最小 / 最大长度 */
const USERNAME_MIN = 3
const USERNAME_MAX = 32

/** 注册 / 登录请求体 */
interface AuthCredentialsBody {
  username?: string
  password?: string
}

/** 刷新 token 请求体 */
interface RefreshBody {
  refreshToken?: string
}

/**
 * 将内部 User 映射为对外 AuthUser 结构（剔除 passwordHash 等敏感字段）
 *
 * 导出供用户管理路由（user:list 等）复用。
 */
export function toPublicUser(user: User): AuthUser {
  return { id: user.id, username: user.username, role: user.role }
}

/** 为指定用户签发 access + refresh token 对 */
async function issueTokens(user: User) {
  const accessToken = await signAccessToken(user)
  const refreshToken = await signRefreshToken(user)
  return { accessToken, refreshToken }
}

/**
 * 校验注册 / 登录凭据格式
 *
 * @returns 错误提示；通过校验时返回 null
 */
function validateCredentials(username: string, password: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `用户名长度需在 ${USERNAME_MIN}-${USERNAME_MAX} 字符之间`
  }
  return validatePassword(password)
}

/**
 * POST /api/auth:register
 *
 * 请求体：{ username, password }
 * 成功 → 200 { user, accessToken, refreshToken }
 * 用户名已存在 → 409
 */
auth.post('/auth:register', async (c) => {
  const body = await c.req.json<AuthCredentialsBody>()
  const username = body.username ?? ''
  const password = body.password ?? ''

  const invalid = validateCredentials(username, password)
  if (invalid) {
    return c.json({ error: invalid }, 400)
  }

  let user: User
  try {
    user = createUser(username, password)
  } catch {
    // createUser 在用户名重复时抛错
    return c.json({ error: '用户名已存在' }, 409)
  }

  const tokens = await issueTokens(user)
  return c.json({ user: toPublicUser(user), ...tokens })
})

/**
 * POST /api/auth:login
 *
 * 请求体：{ username, password }
 * 成功 → 200 { user, accessToken, refreshToken }
 * 验证失败 → 401 { error: '用户名或密码错误' }
 */
auth.post('/auth:login', async (c) => {
  const body = await c.req.json<AuthCredentialsBody>()
  const username = body.username ?? ''
  const password = body.password ?? ''

  const user = verifyUser(username, password)
  if (!user) {
    // 登录失败留痕（含尝试的用户名，便于追溯暴力破解；不记密码）—— AC-7
    recordAudit({
      actor: username || 'unknown',
      actorName: username,
      action: 'auth:login',
      result: 'failure',
      detail: '用户名或密码错误',
    })
    return c.json({ error: '用户名或密码错误' }, 401)
  }

  // 登录成功留痕 —— AC-7
  recordAudit({
    actor: user.id,
    actorName: user.username,
    action: 'auth:login',
    result: 'success',
  })
  const tokens = await issueTokens(user)
  return c.json({ user: toPublicUser(user), ...tokens })
})

/**
 * POST /api/auth:refresh
 *
 * 请求体：{ refreshToken }
 * 成功 → 200 { accessToken, refreshToken }（新 token 对）
 * 无效 / 过期 → 401
 */
auth.post('/auth:refresh', async (c) => {
  const body = await c.req.json<RefreshBody>()
  const refreshToken = body.refreshToken ?? ''

  const payload = await verifyToken(refreshToken)
  if (!payload) {
    return c.json({ error: 'Unauthorized', code: 'INVALID_TOKEN' }, 401)
  }

  // 校验 token 对应的用户仍存在（可能已被删除）
  const user = getUserById(payload.sub)
  if (!user) {
    return c.json({ error: 'Unauthorized', code: 'INVALID_TOKEN' }, 401)
  }

  const tokens = await issueTokens(user)
  return c.json(tokens)
})

/**
 * POST /api/auth:logout
 *
 * 无状态 JWT，服务端无需操作，客户端清除本地 token 即可。
 */
auth.post('/auth:logout', (c) => {
  return c.json({ ok: true })
})

/**
 * POST /api/auth:change-password
 *
 * 已登录用户修改自己的密码（需校验旧密码）。
 * 请求体：{ oldPassword, newPassword }
 * 成功 → 200 { ok: true }
 * 旧密码错误 → 400 { error: '旧密码错误', code: 'WRONG_OLD_PASSWORD' }
 * 新密码不合法 → 400
 *
 * 注意：业务错误刻意不使用 401 状态码——Web 端 shim 将 401 视为
 * 「token 过期」并触发透明刷新重试，凭证校验失败必须走 400。
 */
auth.post('/auth:change-password', authMiddleware, async (c) => {
  const body = await c.req.json<ChangePasswordInput>()
  const oldPassword = body.oldPassword ?? ''
  const newPassword = body.newPassword ?? ''

  if (!oldPassword) {
    return c.json({ error: '请输入旧密码' }, 400)
  }
  const invalid = validatePassword(newPassword)
  if (invalid) {
    return c.json({ error: invalid }, 400)
  }

  const { userId, username } = c.get('user')

  // 校验旧密码（复用与登录相同的 bcrypt 校验逻辑）
  const verified = verifyUser(username, oldPassword)
  if (!verified) {
    return c.json({ error: '旧密码错误', code: 'WRONG_OLD_PASSWORD' }, 400)
  }

  resetPassword(userId, newPassword)
  return c.json({ ok: true })
})

/**
 * GET /api/auth:me
 *
 * 需要鉴权（authMiddleware）。返回当前登录用户信息。
 */
auth.get('/auth:me', authMiddleware, (c) => {
  return c.json(c.get('user'))
})

export { auth }
