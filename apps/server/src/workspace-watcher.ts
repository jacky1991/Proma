/**
 * 服务端工作区文件监听
 *
 * 替代 Electron 端 workspace-watcher.ts（依赖 chokidar + BrowserWindow）。
 * 使用 node:fs watch 监听工作区目录变化，通过 WsStreamSink 广播事件。
 *
 * 监听策略：
 * - mcp.json / skills/ 变化 → 广播 agent:capabilities-changed
 * - 其他文件变化 → 广播 agent:workspace-files-changed
 *
 * M2.5 单用户：启动时监听所有工作区目录，debounce 500ms 合并事件。
 */

import { watch, existsSync, type FSWatcher } from 'node:fs'
import { join, basename } from 'node:path'
import { getAgentWorkspacesDir } from '@proma/server-core/config-paths'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { WsStreamSink } from './ws'

/** 能力相关文件/目录名 */
const CAPABILITY_NAMES = new Set(['mcp.json', 'skills'])

/** debounce 定时器 */
let capabilitiesTimer: ReturnType<typeof setTimeout> | null = null
let filesChangedTimer: ReturnType<typeof setTimeout> | null = null

/** 活跃的文件监听器 */
const watchers: FSWatcher[] = []

/**
 * 启动工作区文件监听
 *
 * 监听 ~/.proma/agent-workspaces/ 下所有工作区目录。
 * 使用 recursive watch（仅 macOS 原生支持；Linux inotify 不支持 recursive，
 * Bun/Node 在 Linux 上会静默降级为仅监听顶层目录，子目录变化不会触发回调）。
 * Linux 部署时需改用 chokidar 或手动递归注册各工作区子目录。
 */
export function startWorkspaceWatcher(sink: WsStreamSink): void {
  const workspacesDir = getAgentWorkspacesDir()
  if (!existsSync(workspacesDir)) {
    console.log('[工作区监听] 工作区目录不存在，跳过监听')
    return
  }

  try {
    const watcher = watch(workspacesDir, { recursive: true }, (_event, filename) => {
      if (!filename) return

      const name = basename(filename)

      // 能力相关文件变化 → debounce 广播 capabilities-changed
      if (CAPABILITY_NAMES.has(name) || filename.includes('/skills/')) {
        if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
        capabilitiesTimer = setTimeout(() => {
          capabilitiesTimer = null
          sink.emit('*', {}, AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED)
          console.log('[工作区监听] 能力变更 → 广播 capabilities-changed')
        }, 500)
        return
      }

      // 其他文件变化 → debounce 广播 workspace-files-changed
      if (filesChangedTimer) clearTimeout(filesChangedTimer)
      filesChangedTimer = setTimeout(() => {
        filesChangedTimer = null
        sink.emit('*', {}, AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
      }, 500)
    })

    watchers.push(watcher)
    console.log('[工作区监听] 已启动，监听:', workspacesDir)
  } catch (err) {
    console.warn('[工作区监听] 启动失败（recursive watch 可能不支持）:', err)
  }
}

/**
 * 停止所有工作区文件监听
 */
export function stopWorkspaceWatcher(): void {
  for (const w of watchers) {
    w.close()
  }
  watchers.length = 0
  if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
  if (filesChangedTimer) clearTimeout(filesChangedTimer)
  console.log('[工作区监听] 已停止')
}
