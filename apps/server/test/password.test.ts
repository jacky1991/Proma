/**
 * 密码管理路由测试（BDD）
 *
 * 覆盖：
 * - auth:change-password（用户自助改密，校验旧密码）
 * - user:list / user:reset-password（管理员用户管理）
 *
 * 环境隔离：bootstrap.ts 与 jwt.ts 在模块加载期读取 env，
 * 因此必须先设置 PROMA_DATA_ROOT / PROMA_JWT_SECRET，再动态 import app。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AuthUser } from '@proma/shared'

// ─── 环境隔离（必须早于动态 import）───
const testDataRoot = mkdtempSync(join(tmpdir(), 'proma-password-test-'))
process.env.PROMA_DATA_ROOT = testDataRoot
process.env.PROMA_JWT_SECRET = 'proma-password-test-secret'

const { app } = await import('../src/app.ts')
const { initAdminUser } = await import('@proma/server-core/user-manager')

// ─── 测试夹具 ───

const ADMIN_PASSWORD = 'admin-test-pass'
const ALICE_PASSWORD = 'alice-pass-1'

let adminToken: string
let aliceToken: string
let aliceId: string

/** 接口调用结果 */
interface ApiResult<T = unknown> {
  status: number
  data: T
}

/** 错误响应体 */
interface ErrorBody {
  error?: string
  code?: string
}

/** 登录 / 注册响应体 */
interface AuthResult {
  user: AuthUser
  accessToken: string
  refreshToken: string
}

/** 通用 POST 请求助手（走 app.request 进程内调用） */
async function apiPost<T = unknown>(
  path: string,
  body?: unknown,
  token?: string,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await app.request(`/api/${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T }
}

/** 登录助手 */
function login(username: string, password: string): Promise<ApiResult<AuthResult>> {
  return apiPost<AuthResult>('auth:login', { username, password })
}

beforeAll(async () => {
  // 内置 admin 账户 + 一个普通用户
  initAdminUser(ADMIN_PASSWORD)

  const admin = await login('admin', ADMIN_PASSWORD)
  expect(admin.status).toBe(200)
  adminToken = admin.data.accessToken

  const alice = await apiPost<AuthResult>('auth:register', {
    username: 'alice',
    password: ALICE_PASSWORD,
  })
  expect(alice.status).toBe(200)
  aliceToken = alice.data.accessToken
  aliceId = alice.data.user.id
})

afterAll(() => {
  rmSync(testDataRoot, { recursive: true, force: true })
})

// ===== 用户自助改密 =====

describe('auth:change-password 用户自助改密', () => {
  test('旧密码错误 → 400 WRONG_OLD_PASSWORD', async () => {
    const res = await apiPost<ErrorBody>(
      'auth:change-password',
      { oldPassword: 'wrong-pass', newPassword: 'new-pass-123' },
      aliceToken,
    )
    expect(res.status).toBe(400)
    expect(res.data.code).toBe('WRONG_OLD_PASSWORD')
    expect(res.data.error).toBe('旧密码错误')
  })

  test('新密码过短 → 400', async () => {
    const res = await apiPost<ErrorBody>(
      'auth:change-password',
      { oldPassword: ALICE_PASSWORD, newPassword: '12345' },
      aliceToken,
    )
    expect(res.status).toBe(400)
    expect(res.data.error).toContain('至少')
  })

  test('新密码超过 72 字符 → 400（bcrypt 上限）', async () => {
    const res = await apiPost<ErrorBody>(
      'auth:change-password',
      { oldPassword: ALICE_PASSWORD, newPassword: 'x'.repeat(73) },
      aliceToken,
    )
    expect(res.status).toBe(400)
    expect(res.data.error).toContain('超过')
  })

  test('未携带 token → 401 NO_TOKEN', async () => {
    const res = await apiPost<ErrorBody>('auth:change-password', {
      oldPassword: ALICE_PASSWORD,
      newPassword: 'new-pass-123',
    })
    expect(res.status).toBe(401)
    expect(res.data.code).toBe('NO_TOKEN')
  })

  test('改密成功 → 新密码可登录，旧密码失效', async () => {
    const newPassword = 'alice-pass-2'
    const res = await apiPost<{ ok: boolean }>(
      'auth:change-password',
      { oldPassword: ALICE_PASSWORD, newPassword },
      aliceToken,
    )
    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)

    // 新密码可登录
    const okLogin = await login('alice', newPassword)
    expect(okLogin.status).toBe(200)

    // 旧密码登录失败
    const badLogin = await login('alice', ALICE_PASSWORD)
    expect(badLogin.status).toBe(401)
  })
})

// ===== 用户列表（管理员） =====

describe('user:list 用户列表（仅管理员）', () => {
  test('管理员 → 200，仅公开字段（无 passwordHash）', async () => {
    const res = await apiPost<AuthUser[]>('user:list', undefined, adminToken)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.data)).toBe(true)

    const usernames = res.data.map((u) => u.username)
    expect(usernames).toContain('admin')
    expect(usernames).toContain('alice')

    // 响应不得包含密码哈希等敏感字段
    for (const item of res.data) {
      expect(Object.keys(item).sort()).toEqual(['id', 'role', 'username'])
    }
  })

  test('普通用户 → 403 ADMIN_ONLY', async () => {
    const res = await apiPost<ErrorBody>('user:list', undefined, aliceToken)
    expect(res.status).toBe(403)
    expect(res.data.code).toBe('ADMIN_ONLY')
  })

  test('未携带 token → 401', async () => {
    const res = await apiPost<ErrorBody>('user:list')
    expect(res.status).toBe(401)
  })
})

// ===== 重置密码（管理员） =====

describe('user:reset-password 重置密码（仅管理员）', () => {
  test('普通用户调用 → 403 ADMIN_ONLY', async () => {
    const res = await apiPost<ErrorBody>(
      'user:reset-password',
      { userId: aliceId, newPassword: 'whatever-123' },
      aliceToken,
    )
    expect(res.status).toBe(403)
    expect(res.data.code).toBe('ADMIN_ONLY')
  })

  test('用户不存在 → 404', async () => {
    const res = await apiPost<ErrorBody>(
      'user:reset-password',
      { userId: 'no-such-user-id', newPassword: 'whatever-123' },
      adminToken,
    )
    expect(res.status).toBe(404)
    expect(res.data.error).toBe('用户不存在')
  })

  test('新密码过短 → 400', async () => {
    const res = await apiPost<ErrorBody>(
      'user:reset-password',
      { userId: aliceId, newPassword: '123' },
      adminToken,
    )
    expect(res.status).toBe(400)
  })

  test('管理员重置普通用户密码 → 目标可用新密码登录', async () => {
    const newPassword = 'alice-reset-pass'
    const res = await apiPost<{ ok: boolean }>(
      'user:reset-password',
      { userId: aliceId, newPassword },
      adminToken,
    )
    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)

    const okLogin = await login('alice', newPassword)
    expect(okLogin.status).toBe(200)
  })

  test('管理员可重置自己的密码', async () => {
    // 先取得 admin 的 userId
    const list = await apiPost<AuthUser[]>('user:list', undefined, adminToken)
    const admin = list.data.find((u) => u.username === 'admin')
    expect(admin).toBeDefined()

    const newPassword = 'admin-reset-pass'
    const res = await apiPost<{ ok: boolean }>(
      'user:reset-password',
      { userId: admin!.id, newPassword },
      adminToken,
    )
    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)

    const okLogin = await login('admin', newPassword)
    expect(okLogin.status).toBe(200)
  })
})
