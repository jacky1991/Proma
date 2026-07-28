/**
 * 结构化日志器单测（AC-1/2/3）
 */
import { test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { createLogger } from '../src/logger'

const envKeys = ['PROMA_LOG_LEVEL', 'PROMA_LOG_FORMAT']

let savedEnv: Record<string, string | undefined> = {}
let logSpy: ReturnType<typeof spyOn>
let warnSpy: ReturnType<typeof spyOn>
let errorSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  savedEnv = {}
  for (const k of envKeys) savedEnv[k] = process.env[k]
  logSpy = spyOn(console, 'log')
  warnSpy = spyOn(console, 'warn')
  errorSpy = spyOn(console, 'error')
})

afterEach(() => {
  logSpy.mockRestore()
  warnSpy.mockRestore()
  errorSpy.mockRestore()
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

test('AC-1 JSON 格式输出单行 JSON，含 ts/level/module/msg 与上下文字段', () => {
  process.env.PROMA_LOG_FORMAT = 'json'
  const logger = createLogger('WS')
  logger.info('新连接建立', { userId: 'u1', sessionId: 's1' })

  expect(logSpy).toHaveBeenCalledTimes(1)
  const line = logSpy.mock.calls[0][0] as string
  // 单行
  expect(line.includes('\n')).toBe(false)
  const parsed = JSON.parse(line)
  expect(parsed.level).toBe('INFO')
  expect(parsed.module).toBe('WS')
  expect(parsed.msg).toBe('新连接建立')
  expect(parsed.userId).toBe('u1')
  expect(parsed.sessionId).toBe('s1')
  expect(typeof parsed.ts).toBe('string')
})

test('AC-2 PROMA_LOG_LEVEL=warn 时 info 被过滤、warn 输出', () => {
  process.env.PROMA_LOG_LEVEL = 'warn'
  const logger = createLogger('用户管理')
  logger.info('不应出现')
  logger.warn('应出现')

  expect(logSpy).not.toHaveBeenCalled()
  expect(warnSpy).toHaveBeenCalledTimes(1)
  expect(warnSpy.mock.calls[0][0]).toContain('应出现')
})

test('AC-3 敏感字段（password / token / apiKey）被脱敏，明文不入日志', () => {
  const logger = createLogger('auth')
  logger.info('登录上下文', {
    username: 'alice',
    password: 'super-secret-123',
    token: 'Bearer abc.def.ghi',
    apiKey: 'sk-xxxxxxxxxxxxxxxx',
  })

  const line = logSpy.mock.calls[0][0] as string
  expect(line).not.toContain('super-secret-123')
  expect(line).not.toContain('abc.def.ghi')
  expect(line).not.toContain('sk-xxxxxxxxxxxxxxxx')
  expect(line).toContain('[REDACTED]')
  // 非敏感字段保留
  expect(line).toContain('alice')
})

test('human 默认格式：[模块] msg {ctx}，兼容现有观感', () => {
  const logger = createLogger('WS')
  logger.info('新连接', { userId: 'u1' })
  const line = logSpy.mock.calls[0][0] as string
  expect(line.startsWith('[WS] 新连接')).toBe(true)
  expect(line).toContain('"userId":"u1"')
})

test('error 级别走 stderr，Error 对象提取 message', () => {
  const logger = createLogger('WS')
  const err = new Error('推送失败')
  logger.error('推送异常', { error: err })
  expect(errorSpy).toHaveBeenCalledTimes(1)
  const line = errorSpy.mock.calls[0][0] as string
  expect(line).toContain('推送异常')
  expect(line).toContain('推送失败')
})
