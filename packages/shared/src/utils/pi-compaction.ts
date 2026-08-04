/**
 * Pi 自动压缩阈值计算。移植自 main e5fd4152（#1321）。
 *
 * Pi 在上下文达到模型窗口约 80% 时自动压缩；此前仅设 `compaction:{enabled:true}`
 * 未设 reserveTokens，压缩起点依赖 SDK 默认值，Web 多用户长会话更易在压缩触发前
 * 撞上窗口上限。
 */

/** Pi 自动压缩开始时的上下文占用比例。 */
export const PI_AUTO_COMPACTION_THRESHOLD_RATIO = 0.8

/**
 * 将目标上下文占用比例换算为 Pi SDK 的 reserveTokens 配置。
 *
 * Pi 在 `contextTokens > contextWindow - reserveTokens` 时自动压缩，
 * 因此预留 20% 的窗口即可在约 80% 占用时开始压缩。
 */
export function calculatePiAutoCompactionReserveTokens(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError('Pi context window must be a positive finite number')
  }

  return Math.ceil(contextWindow * (1 - PI_AUTO_COMPACTION_THRESHOLD_RATIO))
}

/** 返回 Pi SDK 会开始自动压缩的上下文 token 阈值。 */
export function calculatePiAutoCompactionThresholdTokens(contextWindow: number): number {
  return contextWindow - calculatePiAutoCompactionReserveTokens(contextWindow)
}
