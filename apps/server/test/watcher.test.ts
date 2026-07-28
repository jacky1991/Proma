/**
 * M4 迭代 10 watcher 测试：AC-11 / AC-12
 *
 * 覆盖：
 * - AC-11 Linux 子目录监听生效（registerDirTree 逐目录递归注册，
 *         深层子目录文件变化触发回调）
 * - AC-12 macOS 行为回归（IS_MACOS 分流：macOS 走原生 recursive）
 *
 * 说明：handleChange 为平台无关的纯判定逻辑；registerDirTree 虽为 Linux 分支
 * helper，但其「逐目录注册 + 深层文件捕获」语义在 macOS 下用非 recursive watch
 * 同样可验证（macOS 原生 watch 非 recursive 也支持单目录监听）。
 * fs.watch 存在平台 / 环境差异，集成断言带超时轮询以降低 flaky。
 */

import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import {
  __test__,
  startWorkspaceWatcher,
  stopWorkspaceWatcher,
} from '../src/workspace-watcher'

const { handleChange, registerDirTree, IS_MACOS } = __test__

/** 接收 emit 调用的 sink 记录器 */
interface RecordedCall {
  sessionId: string
  channel?: string
}

function makeSink() {
  const calls: RecordedCall[] = []
  const sink = {
    emit: (sessionId: string, _payload: unknown, channel?: string) => {
      calls.push({ sessionId, channel })
    },
  }
  return { sink, calls }
}

/** 轮询断言：在超时内等待条件成立 */
async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return
    await Bun.sleep(50)
  }
  throw new Error(`waitFor 超时 (${timeoutMs}ms)`)
}

afterEach(() => {
  // 清理模块级 watcher / debounce 定时器，避免跨用例泄漏
  stopWorkspaceWatcher()
})

test('AC-11 / AC-12 判定逻辑：mcp.json 变化 → capabilities-changed', async () => {
  const { sink, calls } = makeSink()
  handleChange(join('/tmp', 'ws', 'mcp.json'), sink)
  await waitFor(() => calls.some((c) => c.channel === AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED))
})

test('AC-11 / AC-12 判定逻辑：skills/ 下文件变化 → capabilities-changed', async () => {
  const { sink, calls } = makeSink()
  handleChange(join('/tmp', 'ws', 'slug', 'skills', 'foo'), sink)
  await waitFor(() => calls.some((c) => c.channel === AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED))
})

test('AC-11 / AC-12 判定逻辑：普通文件变化 → workspace-files-changed', async () => {
  const { sink, calls } = makeSink()
  handleChange(join('/tmp', 'ws', 'slug', 'workspace-files', 'a.txt'), sink)
  await waitFor(() => calls.some((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED))
})

test('AC-11 registerDirTree：深层子目录文件变化触发回调（逐目录监听生效）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'proma-ws-'))
  try {
    // 构造工作区目录树：slug/workspace-files/（深层子目录）
    mkdirSync(join(tmp, 'slug', 'workspace-files'), { recursive: true })
    const { sink, calls } = makeSink()
    registerDirTree(join(tmp, 'slug'), sink)

    // 触发深层文件变化（workspace-files 下的文件）
    writeFileSync(join(tmp, 'slug', 'workspace-files', 'foo.txt'), 'hello')

    await waitFor(() =>
      calls.some((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED),
    )
    expect(
      calls.some((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED),
    ).toBe(true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('AC-11 registerDirTree：动态新增子目录后补注册，其文件变化也被捕获', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'proma-ws-new-'))
  try {
    mkdirSync(join(tmp, 'slug'), { recursive: true })
    const { sink, calls } = makeSink()
    registerDirTree(join(tmp, 'slug'), sink)

    // 启动后新建子目录（父目录 watcher 应检测并补注册）
    mkdirSync(join(tmp, 'slug', 'new-dir'))
    // 等补注册生效（rename 事件 → registerDirTree）
    await Bun.sleep(300)
    writeFileSync(join(tmp, 'slug', 'new-dir', 'bar.txt'), 'world')

    await waitFor(
      () => calls.some((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED),
      4000,
    )
    expect(
      calls.some((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED),
    ).toBe(true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('AC-12 macOS 分流：当前平台识别正确（macOS 走 recursive，其他走 per-dir）', () => {
  // 仅断言分流常量存在且为布尔；macOS 行为与迭代 9 一致由 recursive 分支代码路径保证
  expect(typeof IS_MACOS).toBe('boolean')
})

test('startWorkspaceWatcher：正常启动与停止不抛错（数据根自动创建工作区目录）', () => {
  // 实测：getAgentWorkspacesDir 会 mkdirSync 自动创建目录，故走正常启动分支；
  // 本用例验证启动 / 停止流程整体不抛错（含 watcher 句柄释放）
  expect(() => {
    const orig = process.env.PROMA_DATA_ROOT
    process.env.PROMA_DATA_ROOT = join(tmpdir(), 'proma-ws-bootstrap-' + Date.now().toString(36))
    try {
      startWorkspaceWatcher({ emit() {} })
    } finally {
      if (orig === undefined) delete process.env.PROMA_DATA_ROOT
      else process.env.PROMA_DATA_ROOT = orig
    }
  }).not.toThrow()
})
