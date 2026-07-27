/**
 * Orchestrator 多用户 scope 回归测试
 *
 * 钉住「scope 泄漏」bug：Web 多用户场景下，编排器内部持久化调用与 prompt 构建
 * 曾遗漏 UserScope 传递，导致用户数据被写进默认数据根（~/.proma，桌面端目录），
 * 表现为「Agent 会话不存在」报错、消息读写错位与跨用户数据泄漏。
 *
 * 数据根布局（见 config-paths.ts）：
 * - 无 scope → getDataRoot()（本测试经 PROMA_DATA_ROOT 指向临时默认根）
 * - 有 scope → {scope.dataRoot}/users/{userId}/
 */

import { test, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { configureServerCore } from '../src/config'
import {
  NodeAesGcmCryptoProvider,
  NoopStreamSink,
  createNodeEnvProbe,
} from '../src/node'
import { AgentOrchestrator } from '../src/agent-orchestrator'
import type { SessionCallbacks } from '../src/agent-orchestrator'
import { AgentEventBus } from '../src/agent-event-bus'
import {
  createAgentSession,
  getAgentSessionMeta,
  appendSDKMessages,
} from '../src/agent-session-manager'
import {
  buildContextPrompt,
  buildRecoveryPrompt,
  buildReferencedSessionsPrompt,
} from '../src/agent-session-context-prompt'
import { getAgentHomeDir, type UserScope } from '../src/config-paths'
import type { AgentProviderAdapter, SDKMessage } from '@proma/shared'

beforeAll(() => {
  configureServerCore({
    crypto: new NodeAesGcmCryptoProvider(),
    envProbe: createNodeEnvProbe(),
    streamSink: new NoopStreamSink(),
  })
})

let userRoot: string
let defaultRoot: string
let scope: UserScope

beforeEach(() => {
  userRoot = mkdtempSync(join(tmpdir(), 'proma-scope-user-'))
  defaultRoot = mkdtempSync(join(tmpdir(), 'proma-scope-default-'))
  // 无 scope 调用的回落根（测试进程未调 setDataRoot，env 即时生效）
  process.env.PROMA_DATA_ROOT = defaultRoot
  scope = { userId: 'u1', dataRoot: userRoot }
})

afterEach(() => {
  delete process.env.PROMA_DATA_ROOT
  rmSync(userRoot, { recursive: true, force: true })
  rmSync(defaultRoot, { recursive: true, force: true })
})

test('带 scope 的 sendMessage：用户消息与 preflight 错误落用户数据根，默认根无痕', async () => {
  const orchestrator = new AgentOrchestrator({} as AgentProviderAdapter, new AgentEventBus())
  const meta = createAgentSession('Scope 回归会话', 'ch-x', undefined, undefined, 'pi', scope)

  const errors: string[] = []
  let completed = false
  const callbacks: SessionCallbacks = {
    onError: (error) => { errors.push(error) },
    onComplete: () => { completed = true },
    onTitleUpdated: () => {},
  }

  // 渠道不存在 → persistInitialUserMessage（先于一切 preflight）写入用户消息后
  // 走 reportPreflightError 持久化错误并返回，全程不触碰 adapter / 网络。
  await orchestrator.sendMessage({
    sessionId: meta.id,
    userMessage: '你好',
    channelId: 'nonexistent-channel',
  }, callbacks, scope)

  // ① 用户消息与 preflight 错误都落在用户数据根的 JSONL
  const userJsonl = join(userRoot, 'users', 'u1', 'agent-sessions', `${meta.id}.jsonl`)
  expect(existsSync(userJsonl)).toBe(true)
  const content = readFileSync(userJsonl, 'utf-8')
  expect(content).toContain('你好')
  expect(content).toContain('渠道不存在')

  // ② 默认数据根不留该会话任何痕迹（回归防线：修复前用户消息必然写到这里）
  expect(existsSync(join(defaultRoot, 'agent-sessions', `${meta.id}.jsonl`))).toBe(false)

  // ③ 索引隔离：带 scope 可查，默认根查不到
  expect(getAgentSessionMeta(meta.id, scope)?.id).toBe(meta.id)
  expect(getAgentSessionMeta(meta.id)).toBeUndefined()

  // ④ 控制信号正常触发
  expect(errors.some((e) => e.includes('渠道不存在'))).toBe(true)
  expect(completed).toBe(true)
})

test('context-prompt 系列函数：带 scope 读取用户隔离数据并生成正确的 History path', () => {
  const a = createAgentSession('会话 A', undefined, undefined, undefined, 'pi', scope)
  const b = createAgentSession('会话 B', undefined, undefined, undefined, 'pi', scope)

  // 预置会话 A 的历史消息（buildContextPrompt 会排除"最后一条当前消息"，故至少两条）
  const mkAssistant = (text: string): SDKMessage => ({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  }) as unknown as SDKMessage
  appendSDKMessages(a.id, [mkAssistant('这是历史中已完成的消息'), mkAssistant('当前消息占位')], scope)

  const userSessionsDir = join(userRoot, 'users', 'u1', 'agent-sessions')

  // buildContextPrompt：历史回填可读 + History path 指向用户数据根
  const ctx = buildContextPrompt(a.id, '当前消息', { agentCwd: '/tmp' }, scope)
  expect(ctx).toContain('这是历史中已完成的消息')
  expect(ctx).toContain(userSessionsDir)

  // 隔离对照：不带 scope 读默认根，无历史可回填，原样返回当前消息
  expect(buildContextPrompt(a.id, '当前消息', { agentCwd: '/tmp' })).toBe('当前消息')

  // buildRecoveryPrompt：读得到会话标题（未降级为 sessionId）+ path 正确
  const recovery = buildRecoveryPrompt(a.id, '当前消息', { agentCwd: '/tmp' }, scope)
  expect(recovery).toContain('title="会话 A"')
  expect(recovery).toContain(userSessionsDir)

  // buildReferencedSessionsPrompt：同 scope 会话可互相引用
  const ref = buildReferencedSessionsPrompt(a.id, [b.id], undefined, undefined, scope)
  expect(ref).toContain('title="会话 B"')
})

test('getAgentHomeDir：无工作区兜底 cwd 按用户隔离，无 scope 时保持桌面语义', () => {
  // 有 scope：落在用户数据根内，目录自动创建
  const home = getAgentHomeDir(scope)
  expect(home).toBe(join(userRoot, 'users', 'u1', 'agent-home'))
  expect(existsSync(home)).toBe(true)

  // 不同用户互不共享
  expect(getAgentHomeDir({ userId: 'u2', dataRoot: userRoot })).toBe(
    join(userRoot, 'users', 'u2', 'agent-home'),
  )

  // 无 scope（桌面端）：保持 homedir() 语义，行为不变
  expect(getAgentHomeDir()).toBe(homedir())
})
