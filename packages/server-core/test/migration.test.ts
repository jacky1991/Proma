/**
 * 数据迁移工具单元测试
 *
 * 迁移为手动能力（服务端启动不自动触发）：需要时由运维脚本调用
 * migrateToMultiUser() 将桌面端 ~/.proma/ 数据复制到 Web 数据根。
 *
 * 覆盖：复制模式（源数据不动）、用户私有/全局数据落位、default 用户记录、
 * 幂等（目标已存在不覆盖）、dryRun、源缺失跳过。
 */

import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateToMultiUser, needsMigration } from '../src/migration/index'

interface StoredUser {
  id: string
  username: string
  role: string
  passwordHash: string
}

let dataRoot: string
let sourceDir: string

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'proma-migration-root-'))
  sourceDir = mkdtempSync(join(tmpdir(), 'proma-migration-src-'))
  // getDataRoot() 即时读取环境变量，指向临时数据根
  process.env.PROMA_DATA_ROOT = dataRoot
})

afterEach(() => {
  delete process.env.PROMA_DATA_ROOT
  rmSync(dataRoot, { recursive: true, force: true })
  rmSync(sourceDir, { recursive: true, force: true })
})

/** 构造模拟桌面端源目录（用户私有 + 全局配置） */
function seedSource(): void {
  mkdirSync(join(sourceDir, 'agent-sessions'), { recursive: true })
  writeFileSync(
    join(sourceDir, 'agent-sessions.json'),
    JSON.stringify([{ id: 's1', title: '遗留会话' }]),
  )
  writeFileSync(join(sourceDir, 'agent-sessions', 's1.jsonl'), '{"type":"user"}\n')
  writeFileSync(join(sourceDir, 'conversations.json'), JSON.stringify([{ id: 'c1' }]))
  writeFileSync(join(sourceDir, 'settings.json'), JSON.stringify({ themeMode: 'dark' }))
  writeFileSync(join(sourceDir, 'channels.json'), JSON.stringify([]))
}

test('复制用户私有数据与全局配置，源数据保持不动', () => {
  seedSource()
  const result = migrateToMultiUser({ sourceDir })

  expect(result.dryRun).toBe(false)
  expect(result.copied.length).toBeGreaterThan(0)

  const userDir = join(dataRoot, 'users', 'default')
  // 用户私有数据 → users/default/，内容完整（复制而非空文件）
  const sessions = JSON.parse(
    readFileSync(join(userDir, 'agent-sessions.json'), 'utf-8'),
  ) as Array<{ id: string }>
  expect(sessions.length).toBe(1)
  expect(sessions[0]?.id).toBe('s1')
  expect(existsSync(join(userDir, 'agent-sessions', 's1.jsonl'))).toBe(true)
  expect(existsSync(join(userDir, 'conversations.json'))).toBe(true)
  expect(
    (JSON.parse(readFileSync(join(userDir, 'settings.json'), 'utf-8')) as { themeMode: string })
      .themeMode,
  ).toBe('dark')

  // 全局配置 → 数据根下（不进 users/）
  expect(existsSync(join(dataRoot, 'channels.json'))).toBe(true)

  // 源数据原样保留（复制而非移动）
  expect(existsSync(join(sourceDir, 'agent-sessions.json'))).toBe(true)
  expect(existsSync(join(sourceDir, 'settings.json'))).toBe(true)
})

test('创建 default 用户记录（admin、无密码、不可登录）', () => {
  seedSource()
  migrateToMultiUser({ sourceDir })

  const users = JSON.parse(readFileSync(join(dataRoot, 'users.json'), 'utf-8')) as StoredUser[]
  const defaultUser = users.find((u) => u.id === 'default')
  expect(defaultUser).toBeDefined()
  expect(defaultUser?.role).toBe('admin')
  // 空密码哈希：bcrypt 校验必失败，仅作数据归属用途
  expect(defaultUser?.passwordHash).toBe('')
})

test('幂等：二次执行不覆盖已存在的目标', () => {
  seedSource()
  migrateToMultiUser({ sourceDir })

  const target = join(dataRoot, 'users', 'default', 'agent-sessions.json')
  const mtimeBefore = statSync(target).mtimeMs

  // 改动源内容后再跑：目标既不被覆盖，内容也不变
  writeFileSync(join(sourceDir, 'agent-sessions.json'), JSON.stringify([{ id: 'CHANGED' }]))
  const result = migrateToMultiUser({ sourceDir })

  expect(result.copied.length).toBe(0)
  expect(statSync(target).mtimeMs).toBe(mtimeBefore)
  const after = JSON.parse(readFileSync(target, 'utf-8')) as Array<{ id: string }>
  expect(after[0]?.id).toBe('s1')
})

test('dryRun 仅记录不写入', () => {
  seedSource()
  const result = migrateToMultiUser({ sourceDir, dryRun: true })

  expect(result.dryRun).toBe(true)
  expect(result.copied.length).toBeGreaterThan(0)
  expect(existsSync(join(dataRoot, 'users', 'default', 'agent-sessions.json'))).toBe(false)
  expect(existsSync(join(dataRoot, 'users.json'))).toBe(false)
})

test('源缺失的路径跳过', () => {
  // 空源目录：所有路径进 skipped，无复制
  const result = migrateToMultiUser({ sourceDir })
  expect(result.copied.length).toBe(0)
  expect(result.skipped.length).toBeGreaterThan(0)
})

test('needsMigration：users/default/ 已存在 → false（无需迁移）', () => {
  mkdirSync(join(dataRoot, 'users', 'default'), { recursive: true })
  expect(needsMigration()).toBe(false)
})
