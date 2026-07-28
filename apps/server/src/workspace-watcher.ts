/**
 * 服务端工作区文件监听
 *
 * 替代 Electron 端 workspace-watcher.ts（依赖 chokidar + BrowserWindow）。
 * 监听工作区目录变化，通过 WsStreamSink 广播事件：
 * - mcp.json / skills/ 变化 → 广播 agent:capabilities-changed
 * - 其他文件变化 → 广播 agent:workspace-files-changed
 *
 * 平台分流（M4 迭代 10 修复 Linux 静默失效）：
 * - macOS：node:fs.watch 原生支持 recursive（单 watcher 覆盖整棵目录树）
 * - Linux / 其他：node:fs.watch 的 recursive: true 在 inotify 下静默降级为
 *   只监听顶层目录，子目录变化不触发回调。故手动为每个子目录注册独立 watcher，
 *   并在父目录回调中检测「新增子目录」动态补注册（AC-11）。
 */

import { watch, existsSync, readdirSync, statSync, type FSWatcher } from 'node:fs'
import { platform } from 'node:os'
import { join, basename, sep } from 'node:path'
import { getAgentWorkspacesDir } from '@proma/server-core/config-paths'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import { createLogger } from '@proma/server-core/logger'
import type { WsStreamSink } from './ws'

const logger = createLogger('工作区监听')

/** 是否 macOS（原生支持 recursive watch） */
const IS_MACOS = platform() === 'darwin'

/** 能力相关文件/目录名 */
const CAPABILITY_NAMES = new Set(['mcp.json', 'skills'])

/** debounce 定时器 */
let capabilitiesTimer: ReturnType<typeof setTimeout> | null = null
let filesChangedTimer: ReturnType<typeof setTimeout> | null = null

/** 活跃 watcher：key = 监听目录绝对路径（macOS 单键；Linux 按目录多键） */
const watchers = new Map<string, FSWatcher>()

/**
 * 处理文件变化事件（按完整路径判定能力 vs 普通文件）
 *
 * @param fullPath 变化文件的绝对路径
 * @param sink WS 推送下沉
 */
function handleChange(fullPath: string, sink: WsStreamSink): void {
  const name = basename(fullPath)
  const isCapability =
    CAPABILITY_NAMES.has(name) || fullPath.includes(`${sep}skills${sep}`)

  if (isCapability) {
    if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
    capabilitiesTimer = setTimeout(() => {
      capabilitiesTimer = null
      sink.emit('*', {}, AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED)
      logger.info('能力变更 → 广播 capabilities-changed')
    }, 500)
    return
  }

  if (filesChangedTimer) clearTimeout(filesChangedTimer)
  filesChangedTimer = setTimeout(() => {
    filesChangedTimer = null
    sink.emit('*', {}, AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
  }, 500)
}

/** 列出目录的直接子目录（绝对路径）；读取失败返回空数组 */
function listChildDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

/**
 * 注册单个目录的非 recursive watcher（Linux 路径）
 *
 * 回调中检测新增子目录 → 递归补注册，保证新建子目录也能被监听。
 * 单个目录注册失败仅 warn，不中断整体监听。
 */
function registerDirWatcher(dir: string, sink: WsStreamSink): void {
  if (watchers.has(dir)) return
  try {
    const w = watch(dir, (_event, filename) => {
      if (!filename) return
      const fullPath = join(dir, filename)
      // 检测新增子目录 → 补注册其整棵子树
      try {
        if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
          registerDirTree(fullPath, sink)
        }
      } catch {
        /* 文件可能已被删除，忽略 stat 失败 */
      }
      handleChange(fullPath, sink)
    })
    watchers.set(dir, w)
  } catch (err) {
    logger.warn('注册目录 watcher 失败', { dir, error: err })
  }
}

/** 递归注册目录树下所有子目录的 watcher（Linux 路径） */
function registerDirTree(rootDir: string, sink: WsStreamSink): void {
  registerDirWatcher(rootDir, sink)
  for (const child of listChildDirs(rootDir)) {
    registerDirTree(child, sink)
  }
}

/**
 * 启动工作区文件监听
 *
 * 平台分流见文件顶部说明。macOS 走原生 recursive；Linux 逐工作区目录递归注册，
 * 顶层 watcher 监听新增工作区 slug 并动态补注册。
 */
export function startWorkspaceWatcher(sink: WsStreamSink): void {
  const workspacesDir = getAgentWorkspacesDir()
  if (!existsSync(workspacesDir)) {
    logger.info('工作区目录不存在，跳过监听')
    return
  }

  try {
    if (IS_MACOS) {
      // macOS 原生 recursive：单 watcher 覆盖整棵树
      const watcher = watch(
        workspacesDir,
        { recursive: true },
        (_event, filename) => {
          if (!filename) return
          // macOS 回调 filename 相对 workspacesDir（POSIX 分隔符），拼绝对路径统一处理
          handleChange(join(workspacesDir, filename), sink)
        },
      )
      watchers.set(workspacesDir, watcher)
      logger.info('已启动（macOS recursive）', { dir: workspacesDir })
    } else {
      // Linux：顶层监听新增工作区目录 + 为每个现有工作区目录树递归注册
      registerDirWatcher(workspacesDir, sink)
      for (const slug of listChildDirs(workspacesDir)) {
        registerDirTree(slug, sink)
      }
      logger.info('已启动（Linux per-dir）', { dir: workspacesDir, watchers: watchers.size })
    }
  } catch (err) {
    logger.warn('启动失败', { error: err })
  }
}

/**
 * 停止所有工作区文件监听，释放全部 watcher 句柄（避免 FD 泄漏）
 */
export function stopWorkspaceWatcher(): void {
  for (const [, w] of watchers) {
    try {
      w.close()
    } catch {
      /* 已关闭 */
    }
  }
  watchers.clear()
  if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
  if (filesChangedTimer) clearTimeout(filesChangedTimer)
  logger.info('已停止')
}

/** @internal 暴露内部 helper 供测试使用（平台模拟 / 回调验证） */
export const __test__ = { handleChange, registerDirTree, registerDirWatcher, listChildDirs, IS_MACOS }
