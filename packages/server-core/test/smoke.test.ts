/**
 * server-core 冒烟测试（M1 可行性验证）
 *
 * 验证：
 * - AC-1 零 Electron 依赖（typecheck + grep 已保证；本测试聚焦运行时）
 * - AC-2 注入端口后核心域可实例化 / 可调用
 * - AC-3 listAgentSessions() 返回数组（证明 fs 门面 + 路径计算正确）
 * - AC-4 CryptoPort 加解密往返还原（证明 safeStorage 抽象无损）
 */

import { test, expect, beforeAll } from 'bun:test'
import { configureServerCore, getCryptoPort, getEnvProbe } from '../src/config'
import {
  NodeAesGcmCryptoProvider,
  NoopStreamSink,
  createNodeEnvProbe,
} from '../src/node'
import { listAgentSessions } from '../src/agent-session-manager'

beforeAll(() => {
  // 显式注入端口实现（覆盖 node 子入口注册的降级默认）
  configureServerCore({
    crypto: new NodeAesGcmCryptoProvider(),
    envProbe: createNodeEnvProbe(),
    streamSink: new NoopStreamSink(),
  })
})

test('AC-2 核心域注入端口后可调用', () => {
  expect(typeof listAgentSessions).toBe('function')
  expect(getEnvProbe().isPackaged).toBe(true)
  expect(getCryptoPort().isAvailable()).toBe(false) // 未设主密钥，降级态
})

test('AC-3 listAgentSessions 返回数组（读 ~/.proma）', () => {
  const sessions = listAgentSessions()
  expect(Array.isArray(sessions)).toBe(true)
})

test('AC-4 CryptoPort 加解密往返（降级模式：无主密钥）', () => {
  const crypto = getCryptoPort()
  const plain = 'sk-test-api-key-SECRET-12345'
  const enc = crypto.encryptString(plain)
  // 降级模式仍加 'plain:' 前缀，确保 enc !== plain
  expect(enc).not.toBe(plain)
  expect(crypto.decryptString(enc)).toBe(plain)
})

test('AC-4 CryptoPort 加解密往返（AES-256-GCM：带主密钥）', () => {
  // 构造前注入 32 字节主密钥；构造后立即恢复，避免污染其他测试
  const prev = process.env.PROMA_SERVER_MASTER_KEY
  process.env.PROMA_SERVER_MASTER_KEY = Buffer.alloc(32, 7).toString('hex')
  const crypto = new NodeAesGcmCryptoProvider()
  process.env.PROMA_SERVER_MASTER_KEY = prev

  expect(crypto.isAvailable()).toBe(true)
  const plain = 'sk-another-api-key-明文密钥-🔒'
  const enc = crypto.encryptString(plain)
  expect(enc).not.toBe(plain)
  expect(crypto.decryptString(enc)).toBe(plain)
})
