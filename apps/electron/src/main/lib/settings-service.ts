/**
 * 应用设置服务（Electron 端）
 *
 * 逻辑真源在 @proma/server-core/settings-service；此处仅做类型还原包装：
 * server-core 持宽松 AppSettings（避开 renderer TabItem 依赖），Electron 端还原为完整 AppSettings。
 * 运行时读写的是同一份 ~/.proma/settings.json，行为与迁移前一致。
 */

import type { AppSettings } from '../../types'
import {
  getSettings as scGetSettings,
  updateSettings as scUpdateSettings,
} from '@proma/server-core/settings-service'

/** 获取应用设置（类型还原为 Electron 完整 AppSettings）。 */
export function getSettings(): AppSettings {
  return scGetSettings() as AppSettings
}

/** 更新应用设置（合并字段并写回，类型还原）。 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  return scUpdateSettings(updates as Record<string, unknown>) as AppSettings
}
