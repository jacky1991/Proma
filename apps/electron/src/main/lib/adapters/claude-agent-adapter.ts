/**
 * Claude Agent SDK 适配器（已移除）
 *
 * M2 迭代 3：Claude runtime 已下线，Pi 为唯一 Agent runtime。
 * 保留此文件仅为兼容 re-export 链（错误处理工具函数仍被其他模块引用）。
 */

export * from '@proma/server-core/sdk-error-utils'

/** @deprecated Claude runtime 已移除，此函数为空操作。 */
export function scanAndKillOrphanedClaudeSubprocesses(): void {
  // no-op：Claude runtime 已移除
}
