/**
 * 应用设置类型（Web 端薄再导出）
 *
 * 领域类型已位于 @proma/shared（transport 无关的共享契约，M4 迭代 11 步骤 2）。
 * renderer 中存在相对路径导入（如 `../../types`、`../../types/settings`），搬迁到
 * apps/web 后需在本目录提供同名模块以保证 renderer 源码零改动（M4 迭代 11 步骤 3）。
 *
 * 注意：Electron 专有的 IPC 通道常量不在此处导出（Web 端经 shim 走 HTTP/WS，无 IPC）。
 */

export type {
  NotificationSoundType,
  NotificationSoundId,
  NotificationSoundSettings,
  ShortcutOverrides,
  ThemeMode,
  ThemeStyle,
  InterfaceVariant,
  MarkdownFontSize,
  AppSettings,
  MainWindowState,
  PersistedTabSettings,
  QuickTaskSubmitInput,
  QuickTaskFile,
  QuickTaskOpenSessionData,
  TrayOpenAgentSessionData,
  TrayCreateSessionData,
} from '@proma/shared'

export {
  THEME_STYLES,
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_STYLE,
  DEFAULT_INTERFACE_VARIANT,
  DEFAULT_AGENT_RUNTIME,
  DEFAULT_MARKDOWN_FONT_SIZE,
} from '@proma/shared'
