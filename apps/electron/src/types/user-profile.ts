/**
 * 用户档案类型
 *
 * 类型定义已迁回 @proma/shared（transport 无关的共享契约，M4 迭代 11 步骤 2）。
 * 本文件保留薄再导出，使 Electron 端现有 `../types` / `@/types/*` 引用零改动；
 * IPC 通道常量仍属 Electron 专有，保留在此处。
 */

export type { UserProfile } from '@proma/shared'
export { DEFAULT_USER_AVATAR, DEFAULT_USER_NAME } from '@proma/shared'

/** 用户档案 IPC 通道 */
export const USER_PROFILE_IPC_CHANNELS = {
  GET: 'user-profile:get',
  UPDATE: 'user-profile:update',
} as const
