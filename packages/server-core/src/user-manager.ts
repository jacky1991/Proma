/**
 * 用户管理器
 *
 * Web 服务端的全局用户 CRUD：注册、登录校验、查询、删除、重置密码。
 * 存储在 getDataRoot()/users.json（全局用户索引，JSON 格式）。
 *
 * 安全约定：
 * - 密码使用 Bun.password（bcrypt，cost 12）哈希后存储，绝不保存明文。
 * - 日志中不输出任何密码 / 哈希内容。
 * - admin 账户由产品初始化流程内置创建（密码来自配置文件），注册用户均为 user。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getDataRoot } from './config-paths.ts'
import { createLogger } from './logger.ts'

/** 模块日志器 */
const logger = createLogger('用户管理')

/** 用户角色 */
export type UserRole = 'admin' | 'user'

/** 用户记录（持久化结构） */
export interface User {
  /** 用户 ID（crypto.randomUUID()） */
  id: string
  /** 用户名（唯一，3-32 字符） */
  username: string
  /** 密码哈希（bcrypt） */
  passwordHash: string
  /** 角色：admin（内置）或 user（注册） */
  role: UserRole
  /** 创建时间（ms） */
  createdAt: number
  /** 更新时间（ms） */
  updatedAt: number
}

/** bcrypt 哈希成本因子 */
const PASSWORD_HASH_COST = 12

/**
 * 获取全局用户索引文件路径
 *
 * @returns getDataRoot()/users.json
 */
function getUsersPath(): string {
  return join(getDataRoot(), 'users.json')
}

/**
 * 读取全部用户
 *
 * 文件不存在或解析失败时返回空数组。
 */
function readUsers(): User[] {
  const filePath = getUsersPath()
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as User[]
    return Array.isArray(data) ? data : []
  } catch (error) {
    logger.error('读取用户索引失败', { error })
    return []
  }
}

/**
 * 写入全部用户
 *
 * 目录不存在时自动创建。
 */
function writeUsers(users: User[]): void {
  const filePath = getUsersPath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  try {
    writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf-8')
  } catch (error) {
    logger.error('写入用户索引失败', { error })
    throw new Error('写入用户索引失败')
  }
}

/**
 * 创建用户
 *
 * - 用户名必须唯一，重复时抛错。
 * - 所有注册用户 role='user'（admin 由初始化流程创建）。
 *
 * @param username 用户名（3-32 字符，调用方已校验）
 * @param password 明文密码（仅用于生成哈希，不落盘、不记日志）
 * @returns 新建的用户记录
 */
export function createUser(username: string, password: string): User {
  const users = readUsers()

  const exists = users.some((u) => u.username === username)
  if (exists) {
    throw new Error(`用户名已存在: ${username}`)
  }

  const now = Date.now()
  const passwordHash = Bun.password.hashSync(password, {
    algorithm: 'bcrypt',
    cost: PASSWORD_HASH_COST,
  })

  // 所有注册用户均为普通用户；admin 账户由初始化流程内置创建
  const user: User = {
    id: crypto.randomUUID(),
    username,
    passwordHash,
    role: 'user',
    createdAt: now,
    updatedAt: now,
  }

  users.push(user)
  writeUsers(users)
  logger.info('已创建用户', { username, role: user.role })
  return user
}

/**
 * 校验用户名 + 密码
 *
 * @returns 校验通过返回用户记录，否则返回 null
 */
export function verifyUser(username: string, password: string): User | null {
  const users = readUsers()
  const user = users.find((u) => u.username === username)
  if (!user) return null

  const ok = Bun.password.verifySync(password, user.passwordHash)
  return ok ? user : null
}

/**
 * 按 ID 查询用户
 *
 * @returns 找到返回用户记录，否则返回 null
 */
export function getUserById(id: string): User | null {
  const users = readUsers()
  return users.find((u) => u.id === id) ?? null
}

/**
 * 列出全部用户
 */
export function listUsers(): User[] {
  return readUsers()
}

/**
 * 删除用户（级联清理私有数据）
 *
 * 删除保护（违反时抛 Error，由路由层转 400）：
 * - 禁止删除内置 admin 账户（保证系统始终有管理员）
 * - 禁止删除操作者自己
 *
 * 删除成功后级联移除 users/{userId}/ 私有数据目录
 * （会话 / 对话 / 设置 / 档案 / 附件 / agent-home），不动全局资源
 * （渠道 / 工作区 / MCP / Skills）。
 *
 * @param id 目标用户 ID
 * @param operatorId 执行删除的操作者用户 ID
 */
export function deleteUser(id: string, operatorId: string): void {
  const users = readUsers()
  const target = users.find((u) => u.id === id)
  if (!target) {
    throw new Error(`用户不存在 id=${id}`)
  }
  if (target.username === 'admin') {
    throw new Error('不能删除内置 admin 账户')
  }
  if (id === operatorId) {
    throw new Error('不能删除操作者自己')
  }

  const next = users.filter((u) => u.id !== id)
  writeUsers(next)

  // 级联删除用户私有数据目录（force：目录不存在时静默忽略，不阻塞账户删除）
  const userDir = join(getDataRoot(), 'users', id)
  rmSync(userDir, { recursive: true, force: true })

  logger.info('已删除用户', { username: target.username, id })
}

/**
 * 重置用户密码
 *
 * @param id 用户 ID
 * @param newPassword 新明文密码（仅用于生成哈希，不落盘、不记日志）
 */
export function resetPassword(id: string, newPassword: string): void {
  const users = readUsers()
  const user = users.find((u) => u.id === id)
  if (!user) {
    throw new Error(`用户不存在 id=${id}`)
  }

  user.passwordHash = Bun.password.hashSync(newPassword, {
    algorithm: 'bcrypt',
    cost: PASSWORD_HASH_COST,
  })
  user.updatedAt = Date.now()

  writeUsers(users)
  logger.info('已重置密码', { username: user.username })
}

/**
 * 初始化内置 admin 账户
 *
 * 产品首次启动时调用。检查是否已存在 admin 用户：
 * - 已存在 → 跳过（幂等）
 * - 不存在 → 用给定密码创建 admin 用户
 *
 * @param password admin 账户密码（来自配置文件）
 */
export function initAdminUser(password: string): void {
  const users = readUsers()
  const adminExists = users.some((u) => u.username === 'admin')
  if (adminExists) {
    logger.info(
      'admin 账户已存在，跳过初始化（配置密码仅首次创建时生效，后续请通过重置密码功能修改）',
    )
    return
  }

  const now = Date.now()
  const admin: User = {
    id: crypto.randomUUID(),
    username: 'admin',
    passwordHash: Bun.password.hashSync(password, {
      algorithm: 'bcrypt',
      cost: PASSWORD_HASH_COST,
    }),
    role: 'admin',
    createdAt: now,
    updatedAt: now,
  }

  users.push(admin)
  writeUsers(users)
  logger.info('已创建内置 admin 账户')
}
