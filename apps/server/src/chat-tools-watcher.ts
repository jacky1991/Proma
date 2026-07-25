/**
 * Chat 工具配置文件监听器（服务端）
 *
 * 监听 ~/.proma/chat-tools.json 的变化，
 * 当配置文件被外部修改（如 Agent 通过文件系统操作）后，
 * 通过 WS 广播 chat-tool:custom-tool-changed 通知前端刷新工具列表。
 *
 * 使用 node:fs.watch + debounce 防抖，避免高频写入导致多次通知。
 */

import { watch, existsSync, type FSWatcher } from 'node:fs'
import { CHAT_TOOL_IPC_CHANNELS } from '@proma/shared'
import { getChatToolsConfigPath } from '@proma/server-core/config-paths'
import type { WsStreamSink } from './ws'

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 500

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 启动 chat-tools.json 文件监听
 *
 * 文件变化时通过 WS 广播 CUSTOM_TOOL_CHANGED 事件。
 */
export function startChatToolsWatcher(sink: WsStreamSink): void {
  const filePath = getChatToolsConfigPath()

  if (!existsSync(filePath)) {
    console.log('[Chat 工具监听] 配置文件不存在，跳过:', filePath)
    return
  }

  try {
    watcher = watch(filePath, (_eventType) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        sink.emit('*', {}, CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED)
        console.log('[Chat 工具监听] 配置变更 → 广播 custom-tool-changed')
      }, DEBOUNCE_MS)
    })

    // 配置文件被外部工具替换/删除时可能触发 error 事件
    watcher.on('error', (err) => {
      console.error('[Chat 工具监听] 运行时错误，关闭监听:', err)
      try { watcher?.close() } catch { /* 已关闭 */ }
      watcher = null
    })

    console.log('[Chat 工具监听] 已启动，监听:', filePath)
  } catch (err) {
    console.error('[Chat 工具监听] 启动失败:', err)
  }
}

/**
 * 停止 chat-tools.json 文件监听
 */
export function stopChatToolsWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  console.log('[Chat 工具监听] 已停止')
}
