/**
 * Chat 工具配置文件监听器（服务端）
 *
 * 监听 ~/.proma-web/chat-tools.json 的变化，当配置文件被外部修改（如原子替换）
 * 后通过 WS 广播 chat-tool:custom-tool-changed 通知前端刷新工具列表。
 *
 * M4 迭代 10 修复：原实现 error 后关闭监听不重建，文件被原子替换（写临时文件
 * 再 rename）后监听会静默停止。现改为 rename / error 后延迟重建，保证持续监听。
 */

import { watch, existsSync, type FSWatcher } from 'node:fs'
import { CHAT_TOOL_IPC_CHANNELS } from '@proma/shared'
import { getChatToolsConfigPath } from '@proma/server-core/config-paths'
import { createLogger } from '@proma/server-core/logger'
import type { WsStreamSink } from './ws'

const logger = createLogger('Chat 工具监听')

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 500
/** watcher 失效后重建延迟（ms） */
const RESTART_DELAY_MS = 1000
/** 配置文件不存在时的轮询间隔（ms）—— 较长以避免刷屏 */
const MISSING_CHECK_DELAY_MS = 10_000

let sinkRef: WsStreamSink | null = null
let filePath = ''
let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
/** 是否已主动停止（避免停止后自动重建） */
let stopped = true
/** 「配置文件不存在」是否已记过日志（避免轮询刷屏，仅首次记录） */
let missingLogged = false

/** 广播配置变更事件 */
function broadcast(): void {
  sinkRef?.emit('*', {}, CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED)
  logger.info('配置变更 → 广播 custom-tool-changed')
}

/** 延迟重建 watcher（去抖：短时间内多次失效只重建一次） */
function scheduleRestart(delay = RESTART_DELAY_MS): void {
  if (stopped) return
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    startInternal()
  }, delay)
}

/** 实际启动 watcher（不重置 stopped / sinkRef，供初次启动与重建共用） */
function startInternal(): void {
  if (stopped) return
  if (!existsSync(filePath)) {
    // 配置文件尚未创建：轮询等待其出现后自动恢复监听。
    // 仅首次记录日志（避免每轮刷屏），用较长间隔降低空轮询开销
    if (!missingLogged) {
      logger.info('配置文件不存在，等待创建后监听', { path: filePath })
      missingLogged = true
    }
    scheduleRestart(MISSING_CHECK_DELAY_MS)
    return
  }
  missingLogged = false

  // 关闭可能残留的旧 watcher
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* 已关闭 */
    }
    watcher = null
  }

  try {
    watcher = watch(filePath, (eventType) => {
      // 任何变化都 debounce 广播
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        broadcast()
      }, DEBOUNCE_MS)

      // rename（文件被替换 / 删除 / 创建）：旧 watcher 绑定的 inode 失效，需重建
      if (eventType === 'rename') {
        logger.info('检测到 rename，将重建监听', { path: filePath })
        scheduleRestart()
      }
    })

    watcher.on('error', (err) => {
      logger.warn('监听异常，将重建', { path: filePath, error: err })
      try {
        watcher?.close()
      } catch {
        /* 已关闭 */
      }
      watcher = null
      scheduleRestart()
    })

    logger.info('已启动', { path: filePath })
  } catch (err) {
    logger.error('启动失败，将重试', { error: err })
    scheduleRestart()
  }
}

/**
 * 启动 chat-tools.json 文件监听
 *
 * 文件变化时通过 WS 广播 CUSTOM_TOOL_CHANGED 事件；
 * rename / error / 文件缺失时自动重建，保证持续监听。
 */
export function startChatToolsWatcher(sink: WsStreamSink): void {
  stopped = false
  sinkRef = sink
  filePath = getChatToolsConfigPath()
  startInternal()
}

/**
 * 停止 chat-tools.json 文件监听
 */
export function stopChatToolsWatcher(): void {
  stopped = true
  missingLogged = false
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* 已关闭 */
    }
    watcher = null
  }
  logger.info('已停止')
}
