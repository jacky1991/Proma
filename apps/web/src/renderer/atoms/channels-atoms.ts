/**
 * Channels Atoms - 全局渠道列表缓存（Chat 与 Agent 共享）
 *
 * 从 chat-atoms 上提为共享层：渠道列表被 Chat 与 Agent 两端共用，
 * 放在 chat-atoms 会让 Agent chunk 为取渠道而传递性引入整个 chat-atoms，
 * 破坏 bundle 隔离。这里独立成共享 atom，两端都从这里引用。
 */

import { atom } from 'jotai'
import type { Channel } from '@proma/shared'

/** 全局渠道列表缓存（启动时加载一次，设置变更时刷新） */
export const channelsAtom = atom<Channel[]>([])

/** 渠道列表是否已完成首次加载 */
export const channelsLoadedAtom = atom(false)
