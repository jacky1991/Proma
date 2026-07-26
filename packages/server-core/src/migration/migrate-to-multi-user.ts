/**
 * 桌面端 → Web 多用户数据迁移工具
 *
 * 将桌面端 ~/.proma/ 的数据以「复制」模式迁移到 Web 数据根（getDataRoot()），
 * 原数据不受影响。迁移幂等：已存在的目标不覆盖。
 *
 * 数据分布：
 * - 用户私有数据 → {dataRoot}/users/default/
 * - 全局共享配置 → {dataRoot}/
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { getDataRoot } from '../config-paths.ts'
import type { User } from '../user-manager.ts'

/** 迁移结果 */
export interface MigrationResult {
  /** 已复制的路径（格式：src → dst） */
  copied: string[]
  /** 跳过的路径（源不存在或目标已存在） */
  skipped: string[]
  /** 是否为试运行（不实际写入） */
  dryRun: boolean
}

/** 需要迁移的用户私有数据路径 */
const USER_PRIVATE_PATHS: string[] = [
  'conversations.json',
  'conversations',
  'agent-sessions.json',
  'agent-sessions',
  'settings.json',
  'user-profile.json',
  'attachments',
  'scratch-pad.md',
]

/** 需要迁移的全局配置路径 */
const GLOBAL_CONFIG_PATHS: string[] = [
  'channels.json',
  'agent-workspaces.json',
  'agent-workspaces',
  'proxy-settings.json',
  'default-skills',
  'sdk-config',
]

/**
 * 判断是否需要执行桌面端数据迁移
 *
 * 条件：
 * 1. getDataRoot() 下不存在 users/default/（尚未迁移过）
 * 2. 桌面端 ~/.proma/ 存在 agent-sessions.json 或 conversations.json（有数据可迁移）
 */
export function needsMigration(): boolean {
  const dataRoot = getDataRoot()
  const defaultUserDir = join(dataRoot, 'users', 'default')

  // 已迁移过，无需重复
  if (existsSync(defaultUserDir)) return false

  // 检查桌面端是否有数据
  const desktopDir = join(homedir(), '.proma')
  return (
    existsSync(join(desktopDir, 'agent-sessions.json')) ||
    existsSync(join(desktopDir, 'conversations.json'))
  )
}

/**
 * 执行桌面端 → Web 多用户数据迁移（复制模式）
 *
 * @param options.dryRun 试运行，仅记录不实际复制
 * @param options.sourceDir 源目录，默认 ~/.proma/（桌面端数据）
 * @returns 迁移结果
 */
export function migrateToMultiUser(options?: {
  dryRun?: boolean
  sourceDir?: string
}): MigrationResult {
  const dryRun = options?.dryRun ?? false
  const sourceDir = options?.sourceDir ?? join(homedir(), '.proma')
  const dataRoot = getDataRoot()
  const userDir = join(dataRoot, 'users', 'default')

  const result: MigrationResult = { copied: [], skipped: [], dryRun }

  console.log(`[迁移] 源目录: ${sourceDir}`)
  console.log(`[迁移] 目标数据根: ${dataRoot}`)
  if (dryRun) console.log('[迁移] 试运行模式，不实际写入')

  // 复制用户私有数据 → {dataRoot}/users/default/
  for (const relativePath of USER_PRIVATE_PATHS) {
    const src = join(sourceDir, relativePath)
    const dst = join(userDir, relativePath)
    copyIfNeeded(src, dst, dryRun, result)
  }

  // 复制全局配置 → {dataRoot}/
  for (const relativePath of GLOBAL_CONFIG_PATHS) {
    const src = join(sourceDir, relativePath)
    const dst = join(dataRoot, relativePath)
    copyIfNeeded(src, dst, dryRun, result)
  }

  // 创建 default 用户记录
  if (!dryRun) {
    ensureDefaultUser(dataRoot)
  }

  return result
}

/**
 * 复制单个路径（文件或目录），幂等：目标已存在则跳过
 */
function copyIfNeeded(
  src: string,
  dst: string,
  dryRun: boolean,
  result: MigrationResult,
): void {
  // 源不存在，跳过
  if (!existsSync(src)) {
    result.skipped.push(src)
    return
  }

  // 目标已存在，幂等跳过
  if (existsSync(dst)) {
    result.skipped.push(dst)
    return
  }

  if (!dryRun) {
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(src, dst, { recursive: true })
  }

  result.copied.push(`${src} → ${dst}`)
}

/**
 * 确保 users.json 中存在 default 用户记录
 *
 * 迁移后的数据归属于 default 用户（id='default'），
 * 该用户为 admin 角色、无密码（需用户后续自行设置）。
 */
function ensureDefaultUser(dataRoot: string): void {
  const usersPath = join(dataRoot, 'users.json')

  let users: User[] = []
  if (existsSync(usersPath)) {
    try {
      const raw = readFileSync(usersPath, 'utf-8')
      const parsed = JSON.parse(raw) as User[]
      if (Array.isArray(parsed)) users = parsed
    } catch {
      console.warn('[迁移] users.json 解析失败，将重新创建')
      users = []
    }
  }

  // 已存在 default 用户，跳过
  if (users.some((u) => u.id === 'default')) return

  const now = Date.now()
  const defaultUser: User = {
    id: 'default',
    username: 'default',
    passwordHash: '',
    role: 'admin',
    createdAt: now,
    updatedAt: now,
  }

  users.push(defaultUser)
  mkdirSync(dirname(usersPath), { recursive: true })
  writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf-8')
  console.log('[迁移] 已创建 default 用户记录（admin，无密码）')
}
