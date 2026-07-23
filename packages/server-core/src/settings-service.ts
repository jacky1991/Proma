/**
 * 应用设置服务
 *
 * 管理应用设置（主题模式等）的读写。
 * 存储在 ~/.proma/settings.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getSettingsPath } from './config-paths'

// 默认值常量（与 Electron types 保持一致；server-core 自持以避免依赖 renderer 类型）
const DEFAULT_AGENT_RUNTIME = 'pi' as const
const DEFAULT_THEME_MODE = 'dark' as const
const DEFAULT_INTERFACE_VARIANT = 'modern' as const

/**
 * 应用设置（server-core 视角）
 *
 * 仅声明 server-core 实际读写的核心字段；其余字段（themeStyle / agentChannelId /
 * voiceDictation / tabState 等桌面或 UI 字段）经 index signature 透传，不在此强类型化。
 * Electron 端 lib/settings-service.ts re-export 时会还原为完整 AppSettings 类型。
 */
export interface AppSettings {
  themeMode?: string
  interfaceVariant?: string
  agentRuntime?: string
  agentThinking?: { type: string; budget_tokens?: number }
  builtinMcpEnabledIds?: string[]
  builtinMcpDisabledIds?: string[]
  onboardingCompleted?: boolean
  environmentCheckSkipped?: boolean
  notificationsEnabled?: boolean
  longTextPasteAsAttachmentEnabled?: boolean
  richTextRenderingEnabled?: boolean
  feishuSessionMirror?: { mode: string }
  [key: string]: unknown
}

/**
 * 获取应用设置
 *
 * 如果文件不存在，返回默认设置。
 */
export function getSettings(): AppSettings {
  const filePath = getSettingsPath()

  if (!existsSync(filePath)) {
    return {
      themeMode: DEFAULT_THEME_MODE,
      interfaceVariant: DEFAULT_INTERFACE_VARIANT,
      onboardingCompleted: false,
      environmentCheckSkipped: false,
      notificationsEnabled: true,
      longTextPasteAsAttachmentEnabled: false,
      richTextRenderingEnabled: false,
      feishuSessionMirror: { mode: 'off' },
      builtinMcpDisabledIds: [],
      agentRuntime: DEFAULT_AGENT_RUNTIME,
      agentThinking: { type: 'adaptive' },
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppSettings> & { experimentalAgentRuntimeSwitchEnabled?: boolean }
    // Pi runtime 已默认可用；读取时清理旧版本遗留的实验开关。
    const { experimentalAgentRuntimeSwitchEnabled: _legacyRuntimeSwitch, ...settings } = data
    return {
      ...settings,
      themeMode: data.themeMode || DEFAULT_THEME_MODE,
      interfaceVariant: data.interfaceVariant || DEFAULT_INTERFACE_VARIANT,
      onboardingCompleted: data.onboardingCompleted ?? false,
      environmentCheckSkipped: data.environmentCheckSkipped ?? false,
      notificationsEnabled: data.notificationsEnabled ?? true,
      longTextPasteAsAttachmentEnabled: data.longTextPasteAsAttachmentEnabled ?? false,
      richTextRenderingEnabled: data.richTextRenderingEnabled ?? false,
      feishuSessionMirror: data.feishuSessionMirror ?? { mode: 'off' },
      builtinMcpDisabledIds: settings.builtinMcpDisabledIds ?? [],
      agentRuntime: settings.agentRuntime ?? DEFAULT_AGENT_RUNTIME,
      agentThinking: settings.agentThinking ?? { type: 'adaptive' },
    }
  } catch (error) {
    console.error('[设置] 读取失败:', error)
    return {
      themeMode: DEFAULT_THEME_MODE,
      interfaceVariant: DEFAULT_INTERFACE_VARIANT,
      onboardingCompleted: false,
      environmentCheckSkipped: false,
      notificationsEnabled: true,
      longTextPasteAsAttachmentEnabled: false,
      richTextRenderingEnabled: false,
      feishuSessionMirror: { mode: 'off' },
      builtinMcpDisabledIds: [],
      agentRuntime: DEFAULT_AGENT_RUNTIME,
      agentThinking: { type: 'adaptive' },
    }
  }
}

/**
 * 更新应用设置
 *
 * 合并更新字段并写入文件。
 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ...updates,
  }
  const filePath = getSettingsPath()

  try {
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    console.log('[设置] 已更新 keys:', Object.keys(updates).join(', '))
  } catch (error) {
    console.error('[设置] 写入失败:', error)
    throw new Error('写入应用设置失败')
  }

  return updated
}
