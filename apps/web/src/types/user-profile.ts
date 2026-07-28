/**
 * 用户档案类型（Web 端薄再导出）
 *
 * 领域类型已位于 @proma/shared（M4 迭代 11 步骤 2）。renderer 中存在相对路径导入
 * （`../../types`），搬迁到 apps/web 后需在本目录提供同名模块以保证源码零改动。
 *
 * 注意：Electron 专有的 IPC 通道常量不在此处导出（Web 端经 shim 走 HTTP/WS，无 IPC）。
 */

export type { UserProfile } from '@proma/shared'
export { DEFAULT_USER_AVATAR, DEFAULT_USER_NAME } from '@proma/shared'
