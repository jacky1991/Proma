/**
 * sdk-config 按用户拆分迁移工具单元测试
 *
 * 迁移为手动能力（服务端启动不自动触发）：将全局 {dataRoot}/sdk-config/ 下的
 * SDK 转录（Pi sessions / Claude projects / file-history）按会话索引归属到
 * users/{userId}/sdk-config/，Pi 会话回写 piSessionFile 元数据。
 *
 * 覆盖：Pi 会话移动 + 元数据回写、Claude 转录保持相对结构、dryRun、幂等、
 * 孤儿报告、getSdkConfigDir 的 scope 回落、needsSdkConfigMigration 判据。
 */

import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { needsSdkConfigMigration, migrateSdkConfigToUsers } from '../src/migration/index'
import { createUser } from '../src/user-manager'
import {
  createAgentSession,
  updateAgentSessionMeta,
  getAgentSessionMeta,
} from '../src/agent-session-manager'
import { getSdkConfigDir } from '../src/config-paths'

let dataRoot: string

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'proma-sdkcfg-root-'))
  // getDataRoot() 即时读取环境变量，指向临时数据根
  process.env.PROMA_DATA_ROOT = dataRoot
})

afterEach(() => {
  delete process.env.PROMA_DATA_ROOT
  rmSync(dataRoot, { recursive: true, force: true })
})

/** 在全局 sdk-config 下播种一个 Pi 会话转录文件 */
function seedPiSessionFile(fileName: string, content = '{"entry":1}\n'): string {
  const dir = join(getSdkConfigDir(), 'sessions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, fileName)
  writeFileSync(file, content)
  return file
}

test('Pi 会话转录移动到归属用户目录并回写 piSessionFile', () => {
  const alice = createUser('alice', 'password123')
  const scopeA = { userId: alice.id }
  const session = createAgentSession('会话A', undefined, undefined, undefined, 'pi', scopeA)

  const src = seedPiSessionFile(`${session.id}.jsonl`)
  updateAgentSessionMeta(session.id, { piSessionFile: src }, scopeA)

  const result = migrateSdkConfigToUsers()

  expect(result.moved.length).toBe(1)
  expect(result.updatedSessions).toBe(1)
  expect(result.errors.length).toBe(0)
  expect(result.orphans.length).toBe(0)

  const target = join(getSdkConfigDir(scopeA), 'sessions', `${session.id}.jsonl`)
  expect(existsSync(target)).toBe(true)
  expect(readFileSync(target, 'utf8')).toBe('{"entry":1}\n')
  expect(existsSync(src)).toBe(false)

  // 元数据已指向用户目录下的新路径
  expect(getAgentSessionMeta(session.id, scopeA)?.piSessionFile).toBe(target)
})

test('Claude projects 与 file-history 保持相对结构移动', () => {
  const bob = createUser('bob', 'password123')
  const scopeB = { userId: bob.id }
  // sdkSessionId/projects 属数据层机制，与 runtime 取值无关（Claude 已于 M2 末下线）
  const session = createAgentSession('会话B', undefined, undefined, undefined, 'pi', scopeB)
  updateAgentSessionMeta(session.id, { sdkSessionId: 'sdk-abc-123' }, scopeB)

  const globalDir = getSdkConfigDir()
  const projDir = join(globalDir, 'projects', '-Users-canvasjoe-ws1')
  mkdirSync(projDir, { recursive: true })
  writeFileSync(join(projDir, 'sdk-abc-123.jsonl'), '{"type":"summary"}\n')
  const histDir = join(globalDir, 'file-history', 'sdk-abc-123')
  mkdirSync(histDir, { recursive: true })
  writeFileSync(join(histDir, 'backup-1.txt'), 'file-content')

  const result = migrateSdkConfigToUsers()

  expect(result.moved.length).toBe(2)
  expect(result.errors.length).toBe(0)

  const userSdkDir = getSdkConfigDir(scopeB)
  expect(existsSync(join(userSdkDir, 'projects', '-Users-canvasjoe-ws1', 'sdk-abc-123.jsonl'))).toBe(true)
  expect(existsSync(join(userSdkDir, 'file-history', 'sdk-abc-123', 'backup-1.txt'))).toBe(true)

  // 全局目录下的对应项已移走（空目录被清理）
  expect(existsSync(join(projDir, 'sdk-abc-123.jsonl'))).toBe(false)
  expect(existsSync(histDir)).toBe(false)
})

test('dryRun 只报告不落盘', () => {
  const alice = createUser('alice', 'password123')
  const scopeA = { userId: alice.id }
  const session = createAgentSession('会话A', undefined, undefined, undefined, 'pi', scopeA)
  const src = seedPiSessionFile(`${session.id}.jsonl`)
  updateAgentSessionMeta(session.id, { piSessionFile: src }, scopeA)

  const result = migrateSdkConfigToUsers({ dryRun: true })

  expect(result.dryRun).toBe(true)
  expect(result.moved.length).toBe(1)
  // 源文件仍在，目标未创建，元数据未变
  expect(existsSync(src)).toBe(true)
  expect(existsSync(join(getSdkConfigDir(scopeA), 'sessions', `${session.id}.jsonl`))).toBe(false)
  expect(getAgentSessionMeta(session.id, scopeA)?.piSessionFile).toBe(src)
})

test('幂等：第二次运行无移动', () => {
  const alice = createUser('alice', 'password123')
  const scopeA = { userId: alice.id }
  const session = createAgentSession('会话A', undefined, undefined, undefined, 'pi', scopeA)
  const src = seedPiSessionFile(`${session.id}.jsonl`)
  updateAgentSessionMeta(session.id, { piSessionFile: src }, scopeA)

  migrateSdkConfigToUsers()
  const second = migrateSdkConfigToUsers()

  expect(second.moved.length).toBe(0)
  expect(second.updatedSessions).toBe(0)
  expect(second.orphans.length).toBe(0)
  expect(needsSdkConfigMigration()).toBe(false)
})

test('孤儿文件被报告且保持原位', () => {
  const src = seedPiSessionFile('nobody-owns-me.jsonl')

  const result = migrateSdkConfigToUsers()

  expect(result.moved.length).toBe(0)
  expect(result.orphans).toContain(src)
  expect(existsSync(src)).toBe(true)
})

test('getSdkConfigDir 按 scope 拆分且无 scope 回落全局', () => {
  expect(getSdkConfigDir({ userId: 'u1' })).toBe(join(dataRoot, 'users', 'u1', 'sdk-config'))
  expect(getSdkConfigDir()).toBe(join(dataRoot, 'sdk-config'))
})

test('needsSdkConfigMigration：空目录 false / 有内容 true', () => {
  // getSdkConfigDir() 自动创建空目录
  getSdkConfigDir()
  expect(needsSdkConfigMigration()).toBe(false)

  seedPiSessionFile('whatever.jsonl')
  expect(needsSdkConfigMigration()).toBe(true)
})
