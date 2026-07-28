/**
 * 生产敏感配置启动校验测试（BDD，纯单测）
 *
 * 覆盖：
 * - AC-12 生产模式缺 JWT secret → missing 含 PROMA_JWT_SECRET
 * - AC-13 生产模式缺主密钥 → missing 含 PROMA_SERVER_MASTER_KEY
 * - AC-14 PROMA_DEV=1 两密钥均缺 → ok（开发态跳过校验）
 * - AC-15 生产态两密钥齐备 → ok
 * - JWT secret 惰性读取：模块加载后设 env 仍能读到新值（规避顶层 const 固化时序坑）
 *
 * 测试对象为纯函数 validateProductionEnv（注入不同 env 对象断言），
 * 不以生产态真启动服务端进程（会 exit 1 且占端口）。
 */

import { describe, test, expect } from 'bun:test'
import { isProduction, validateProductionEnv } from '../src/utils/env.ts'

// ===== JWT secret 惰性读取（置于最前：须是本文件对 jwt 函数的首次调用）=====

describe('JWT secret 惰性读取', () => {
  test('模块加载后再设置 PROMA_JWT_SECRET，首次调用即读到新值', async () => {
    const prev = process.env.PROMA_JWT_SECRET
    delete process.env.PROMA_JWT_SECRET

    try {
      // 1. 无 PROMA_JWT_SECRET 时导入模块——惰性化后加载本身不固化密钥
      const jwt = await import('../src/auth/jwt.ts')
      const { verify } = await import('hono/jwt')

      // 2. 在任何 sign / verify 调用前设置自定义密钥
      const lazySecret = 'lazy-loaded-secret-2026'
      process.env.PROMA_JWT_SECRET = lazySecret

      // 3. 签发后用新密钥验证：通过即证明 getSecret() 在调用时读 env（而非模块加载期固化）
      const token = await jwt.signAccessToken({ id: 'u-1', username: 'alice', role: 'user' })
      const payload = await verify(token, lazySecret, 'HS256')
      expect(payload.sub).toBe('u-1')
      expect(payload.username).toBe('alice')
    } finally {
      // 还原 env，避免污染同进程其他测试
      if (prev === undefined) {
        delete process.env.PROMA_JWT_SECRET
      } else {
        process.env.PROMA_JWT_SECRET = prev
      }
    }
  })
})

// ===== validateProductionEnv 纯函数校验 =====

describe('validateProductionEnv 生产敏感配置校验', () => {
  test('AC-12 生产态缺 JWT secret → missing 含 PROMA_JWT_SECRET', () => {
    const result = validateProductionEnv({
      PROMA_SERVER_MASTER_KEY: 'a'.repeat(64),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toContain('PROMA_JWT_SECRET')
      expect(result.missing).not.toContain('PROMA_SERVER_MASTER_KEY')
    }
  })

  test('AC-13 生产态缺主密钥 → missing 含 PROMA_SERVER_MASTER_KEY', () => {
    const result = validateProductionEnv({
      PROMA_JWT_SECRET: 'some-jwt-secret',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toContain('PROMA_SERVER_MASTER_KEY')
      expect(result.missing).not.toContain('PROMA_JWT_SECRET')
    }
  })

  test('AC-14 PROMA_DEV=1 两密钥均缺 → ok（开发态跳过）', () => {
    const result = validateProductionEnv({ PROMA_DEV: '1' })
    expect(result.ok).toBe(true)
  })

  test('AC-15 生产态两密钥齐备 → ok', () => {
    const result = validateProductionEnv({
      PROMA_JWT_SECRET: 'some-jwt-secret',
      PROMA_SERVER_MASTER_KEY: 'b'.repeat(64),
    })
    expect(result.ok).toBe(true)
  })

  test('生产态两密钥均缺 → missing 同时含两项', () => {
    const result = validateProductionEnv({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing.sort()).toEqual(['PROMA_JWT_SECRET', 'PROMA_SERVER_MASTER_KEY'])
    }
  })
})

// ===== isProduction 生产态判定 =====

describe('isProduction 生产态判定', () => {
  test('PROMA_DEV=1 → 开发态', () => {
    const prev = process.env.PROMA_DEV
    process.env.PROMA_DEV = '1'
    try {
      expect(isProduction()).toBe(false)
    } finally {
      if (prev === undefined) {
        delete process.env.PROMA_DEV
      } else {
        process.env.PROMA_DEV = prev
      }
    }
  })

  test('PROMA_DEV 未设（或非 1）→ 生产态', () => {
    const prev = process.env.PROMA_DEV
    delete process.env.PROMA_DEV
    try {
      expect(isProduction()).toBe(true)
    } finally {
      if (prev !== undefined) {
        process.env.PROMA_DEV = prev
      }
    }
  })
})
