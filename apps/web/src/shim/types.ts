/**
 * electronAPI shim 的契约类型（单源）
 *
 * 契约已正式迁回 @proma/shared（PromaClientAPI，transport 无关，M4 迭代 11 步骤 2）：
 *   - Electron preload 与 Web shim 共享同一契约，两端都写入 window.electronAPI；
 *   - `declare global { Window.electronAPI }` 声明在 @proma/shared 内，
 *     随类型解析在两端一并生效——renderer 中 window.electronAPI.* 的类型
 *     即来自此处（真正单源）。
 */
import type { PromaClientAPI } from '@proma/shared'

export type { PromaClientAPI }
