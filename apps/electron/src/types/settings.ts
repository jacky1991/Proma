/**
 * 应用设置类型
 *
 * 类型定义已迁回 @proma/shared（transport 无关的共享契约，M4 迭代 11 步骤 2）。
 * 本文件保留薄再导出，使 Electron 端现有 `../types` / `@/types/*` 引用零改动；
 * IPC 通道常量仍属 Electron 专有，保留在此处。
 */

export type {
  NotificationSoundType,
  NotificationSoundId,
  NotificationSoundSettings,
  VoiceDictationProvider,
  VoiceDictationEndpointMode,
  VoiceDictationOutputMode,
  VoiceDictationWindowPosition,
  VoiceDictationSettings,
  VoiceDictationSettingsUpdate,
  VoiceDictationPersistedSettings,
  VoiceDictationTranscriptEvent,
  VoiceDictationStateEvent,
  VoiceDictationStartInput,
  VoiceDictationAudioChunkInput,
  VoiceDictationStopInput,
  VoiceDictationCommitInput,
  VoiceDictationResizeInput,
  VoiceDictationCommitResult,
  VoiceDictationTestResult,
  MicPermissionResult,
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

/** 设置 IPC 通道 */
export const SETTINGS_IPC_CHANNELS = {
  GET: 'settings:get',
  UPDATE: 'settings:update',
  UPDATE_SYNC: 'settings:update-sync',
  GET_SYSTEM_THEME: 'settings:get-system-theme',
  ON_SYSTEM_THEME_CHANGED: 'settings:system-theme-changed',
  /** 用户手动切换主题时广播给所有窗口 */
  ON_THEME_SETTINGS_CHANGED: 'settings:theme-settings-changed',
} as const

/** Scratch Pad IPC 通道 */
export const SCRATCH_PAD_IPC_CHANNELS = {
  /** 从磁盘加载 scratch-pad.md 内容 */
  LOAD: 'scratch-pad:load',
  /** 保存内容到 scratch-pad.md */
  SAVE: 'scratch-pad:save',
  /** 同步保存（beforeunload 场景） */
  SAVE_SYNC: 'scratch-pad:save-sync',
  /** 导出为 Markdown 到指定目录 */
  EXPORT: 'scratch-pad:export',
  /** 打开保存对话框选择导出路径 */
  CHOOSE_EXPORT_PATH: 'scratch-pad:choose-export-path',
} as const

/** 应用图标 IPC 通道 */
export const APP_ICON_IPC_CHANNELS = {
  /** 设置应用图标（variant ID） */
  SET: 'app-icon:set',
} as const

/** Dock/Launcher 角标 IPC 通道 */
export const DOCK_BADGE_IPC_CHANNELS = {
  /** 设置系统应用角标数量 */
  SET_COUNT: 'dock-badge:set-count',
} as const

/** 快速任务窗口 IPC 通道 */
export const QUICK_TASK_IPC_CHANNELS = {
  /** 提交快速任务（渲染进程 → 主进程） */
  SUBMIT: 'quick-task:submit',
  /** 隐藏快速任务窗口 */
  HIDE: 'quick-task:hide',
  /** 通知渲染进程聚焦输入框 */
  FOCUS: 'quick-task:focus',
  /** 重新注册全局快捷键（设置变更后） */
  REREGISTER_GLOBAL_SHORTCUTS: 'quick-task:reregister-global-shortcuts',
} as const

/** 语音输入 IPC 通道 */
export const VOICE_DICTATION_IPC_CHANNELS = {
  /** 获取语音输入设置 */
  GET_SETTINGS: 'voice-dictation:get-settings',
  /** 更新语音输入设置 */
  UPDATE_SETTINGS: 'voice-dictation:update-settings',
  /** 测试豆包 ASR 连接 */
  TEST_CONNECTION: 'voice-dictation:test-connection',
  /** 唤起或停止语音输入浮窗 */
  TOGGLE: 'voice-dictation:toggle',
  /** 开始语音输入会话 */
  START: 'voice-dictation:start',
  /** 发送音频分片 */
  SEND_AUDIO: 'voice-dictation:send-audio',
  /** 停止语音输入会话 */
  STOP: 'voice-dictation:stop',
  /** 取消语音输入会话 */
  CANCEL: 'voice-dictation:cancel',
  /** 输出最终文本 */
  COMMIT: 'voice-dictation:commit',
  /** 隐藏语音输入窗口 */
  HIDE: 'voice-dictation:hide',
  /** 调整语音输入窗口高度 */
  RESIZE: 'voice-dictation:resize',
  /** 窗口显示后通知渲染进程开始 */
  SHOWN: 'voice-dictation:shown',
  /** 全局快捷键请求当前录音停止 */
  TOGGLE_STOP: 'voice-dictation:toggle-stop',
  /** 转写文本事件 */
  TRANSCRIPT: 'voice-dictation:transcript',
  /** 状态事件 */
  STATE: 'voice-dictation:state',
  /** 主窗口插入文本 */
  INSERT_TEXT: 'voice-dictation:insert-text',
  /** 检查麦克风权限状态 */
  CHECK_MIC_PERMISSION: 'voice-dictation:check-mic-permission',
  /** 请求麦克风权限 */
  REQUEST_MIC_PERMISSION: 'voice-dictation:request-mic-permission',
} as const

/** 菜单栏 IPC 事件通道 */
export const TRAY_IPC_CHANNELS = {
  /** 打开已有 Agent 会话 */
  OPEN_AGENT_SESSION: 'tray:open-agent-session',
  /** 创建新会话 */
  CREATE_SESSION: 'tray:create-session',
} as const

/** 存储管理 IPC 通道 */
export const STORAGE_IPC_CHANNELS = {
  /** 计算各目录存储统计 */
  GET_STATS: 'storage:get-stats',
  /** 按选项清理存储 */
  CLEANUP: 'storage:cleanup',
  /** 仅清理临时文件（启动时/快速清理） */
  CLEANUP_TEMP: 'storage:cleanup-temp',
} as const
