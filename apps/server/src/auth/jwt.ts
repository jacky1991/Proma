/**
 * JWT 签发 / 验证
 *
 * 基于 hono/jwt（HS256）。access token 1 天有效，refresh token 7 天有效。
 * 生产环境务必通过 PROMA_JWT_SECRET 环境变量覆盖默认密钥。
 */

import { sign, verify } from 'hono/jwt'

/** JWT 签名密钥（生产环境必须通过环境变量覆盖） */
const JWT_SECRET = process.env.PROMA_JWT_SECRET || 'proma-dev-secret-change-in-production'

/** access token 有效期：1 天（秒） */
const ACCESS_TOKEN_TTL = 60 * 60 * 24

/** refresh token 有效期：7 天（秒） */
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7

/** 用户角色 */
type UserRole = 'admin' | 'user'

/** 签发 token 所需的用户最小信息 */
interface TokenUser {
  id: string
  username: string
  role: UserRole
}

/** JWT payload 结构 */
interface TokenPayload {
  /** 用户 ID */
  sub: string
  /** 用户名 */
  username: string
  /** 角色 */
  role: UserRole
  /** 签发时间（秒） */
  iat: number
  /** 过期时间（秒） */
  exp: number
  /** 兼容 hono/jwt 的 JWTPayload 索引签名 */
  [key: string]: unknown
}

/**
 * 构建带过期时间的 payload
 *
 * @param user 用户信息
 * @param ttl 有效期（秒）
 */
function buildPayload(user: TokenUser, ttl: number): TokenPayload {
  const now = Math.floor(Date.now() / 1000)
  return {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: now,
    exp: now + ttl,
  }
}

/**
 * 签发 access token（1 天有效）
 */
export async function signAccessToken(user: TokenUser): Promise<string> {
  return sign(buildPayload(user, ACCESS_TOKEN_TTL), JWT_SECRET)
}

/**
 * 签发 refresh token（7 天有效）
 */
export async function signRefreshToken(user: TokenUser): Promise<string> {
  return sign(buildPayload(user, REFRESH_TOKEN_TTL), JWT_SECRET)
}

/**
 * 验证 token
 *
 * 验证失败（签名无效 / 过期 / 格式错误）返回 null，而非抛异常。
 */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const payload = (await verify(token, JWT_SECRET, 'HS256')) as TokenPayload
    return payload
  } catch {
    return null
  }
}
