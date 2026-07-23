/**
 * electronAPI shim 的契约类型（单源）
 *
 * 直接 type-only 复用 preload 的 ElectronAPI 接口，避免重复声明 900+ 行签名：
 *   - electron 运行时类型由根 node_modules/electron 提供，根 tsconfig 已开 skipLibCheck；
 *   - preload 顶部对 'electron' 的运行时 import 在类型擦除后不存在，此处仅做类型解析；
 *   - preload 末尾的 `declare global { Window.electronAPI }` 会随类型解析一并生效，
 *     renderer 中 window.electronAPI.* 的类型即来自此处（真正单源）。
 *
 * TODO（后续迭代）：将此接口连同 apps/electron/src/types 下的领域类型
 *   （UserProfile / AppSettings / VoiceDictation* / Tray* 等）正式迁回 @proma/shared，
 *   使契约成为 transport 无关的共享契约（架构文档 §8 关键权衡 2）。
 */
import type { ElectronAPI } from '../../../electron/src/preload/index.ts'

export type { ElectronAPI }
