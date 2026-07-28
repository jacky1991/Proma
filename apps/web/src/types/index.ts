/**
 * Web 端内部类型导出（薄再导出 barrel）
 *
 * 对应 renderer 中的相对路径导入 `../../types`（即 src/types）。搬迁后保持与
 * Electron 端 `src/types` 相同的领域类型导出面，使 renderer 源码零改动复用。
 */

export * from './settings'
export * from './user-profile'
