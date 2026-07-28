/**
 * SDK 子进程环境与 CLI 数据根识别测试（BDD，纯单测，不启动 HTTP 服务）
 *
 * 覆盖 M4 迭代 9 验收标准：
 * - AC-6 SDK 子进程环境携带用户身份（Web scope 有值 → 注入 PROMA_USER_ID / PROMA_DATA_ROOT）
 * - AC-7 桌面端行为不变（无 scope → 不注入上述两变量）
 * - AC-8 CLI 识别数据根（resolveConfigDir 读取 PROMA_DATA_ROOT）
 *
 * buildSdkEnv 为 AgentOrchestrator 的 private 方法，测试经一个仅暴露该方法签名的
 * 接口做只读访问（不使用 any）。
 */

import { test, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { configureServerCore } from '@proma/server-core/config'
import { NodeAesGcmCryptoProvider, NoopStreamSink, createNodeEnvProbe } from '@proma/server-core/node'
import { AgentOrchestrator } from '@proma/server-core/agent-orchestrator'
import { AgentEventBus } from '@proma/server-core/agent-event-bus'
import type { UserScope } from '@proma/server-core/config-paths'
import type { AgentProviderAdapter, ProviderType } from '@proma/shared'
import { resolveConfigDir } from '../../cli/src/paths.ts'

/** 仅暴露被测私有方法的最小接口（避免 any，保留参数/返回类型） */
interface BuildSdkEnvCapable {
  buildSdkEnv(
    apiKey: string,
    baseUrl: string | undefined,
    provider: ProviderType,
    modelId: string | undefined,
    scope?: UserScope,
  ): Promise<Record<string, string | undefined>>
}

/** 将编排器只读地视为可调用 buildSdkEnv 的对象 */
function asBuildSdkEnv(orchestrator: AgentOrchestrator): BuildSdkEnvCapable {
  return orchestrator as unknown as BuildSdkEnvCapable
}

beforeAll(() => {
  configureServerCore({
    crypto: new NodeAesGcmCryptoProvider(),
    envProbe: createNodeEnvProbe(),
    streamSink: new NoopStreamSink(),
  })
})

let defaultRoot: string

beforeEach(() => {
  defaultRoot = mkdtempSync(join(tmpdir(), 'proma-sdk-env-'))
  // 无 setDataRoot 调用时，getDataRoot() 即时读取 PROMA_DATA_ROOT
  process.env.PROMA_DATA_ROOT = defaultRoot
})

afterEach(() => {
  delete process.env.PROMA_DATA_ROOT
  delete process.env.PROMA_DEV
  rmSync(defaultRoot, { recursive: true, force: true })
})

test('AC-6 Web scope 有值：buildSdkEnv 注入 PROMA_USER_ID 与 PROMA_DATA_ROOT', async () => {
  const orchestrator = new AgentOrchestrator({} as AgentProviderAdapter, new AgentEventBus())
  const scope: UserScope = { userId: 'alice-id', dataRoot: defaultRoot }

  const env = await asBuildSdkEnv(orchestrator).buildSdkEnv(
    'sk-test',
    undefined,
    'anthropic',
    undefined,
    scope,
  )

  expect(env.PROMA_USER_ID).toBe('alice-id')
  // 注入的是数据根（getDataRoot()），而非 users/{userId} 子层
  expect(env.PROMA_DATA_ROOT).toBe(defaultRoot)
})

test('AC-7 无 scope（桌面端）：buildSdkEnv 不注入 PROMA_USER_ID / PROMA_DATA_ROOT', async () => {
  // 桌面端进程环境不含 PROMA_DATA_ROOT：移除 beforeEach 设置的值，
  // 否则 buildSdkEnv 会经 cleanEnv 继承进程环境，干扰「不注入」断言
  delete process.env.PROMA_DATA_ROOT
  const orchestrator = new AgentOrchestrator({} as AgentProviderAdapter, new AgentEventBus())

  const env = await asBuildSdkEnv(orchestrator).buildSdkEnv(
    'sk-test',
    undefined,
    'anthropic',
    undefined,
    // 不传 scope，模拟桌面端路径
  )

  expect('PROMA_USER_ID' in env).toBe(false)
  expect('PROMA_DATA_ROOT' in env).toBe(false)
})

test('AC-8 CLI resolveConfigDir 识别 PROMA_DATA_ROOT', () => {
  // PROMA_DATA_ROOT 已指向临时数据根 → 直接采用，不再落 ~/.proma
  expect(resolveConfigDir({})).toBe(defaultRoot)
})

test('AC-8 优先级回归：configDir > PROMA_DATA_ROOT > PROMA_DEV', () => {
  // 显式 configDir 优先级最高
  expect(resolveConfigDir({ configDir: '/explicit/dir' })).toBe('/explicit/dir')

  // PROMA_DATA_ROOT 优先于 PROMA_DEV（删除 PROMA_DATA_ROOT 后才轮到 dev 目录）
  delete process.env.PROMA_DATA_ROOT
  process.env.PROMA_DEV = '1'
  expect(resolveConfigDir({})).toBe(join(homedir(), '.proma-dev'))
})
