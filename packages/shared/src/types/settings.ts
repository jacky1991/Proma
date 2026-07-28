/**
 * 应用设置类型
 *
 * 主题模式、语音输入、通知音等设置相关定义（transport 无关的共享契约）。
 * 原 Electron IPC 通道常量已随桌面端删除（M4 迭代 11）。
 */

import type { AgentEffort, ThinkingConfig } from './agent'
import type { AgentRuntime } from './agent-provider'
import type { EnvironmentCheckResult } from './environment'
import type { FeishuSessionMirrorSettings } from './feishu'
import type { TabItem } from './tab'

/** 通知音场景类型 */
export type NotificationSoundType = 'taskComplete' | 'permissionRequest' | 'exitPlanMode'

/** 可选通知音 ID */
export type NotificationSoundId = 'ding' | 'ding-dong' | 'discord' | 'done' | 'down-power' | 'food' | 'lite' | 'quiet' | 'none'

/** 各场景通知音配置 */
export interface NotificationSoundSettings {
  /** 任务完成 */
  taskComplete?: NotificationSoundId
  /** 权限审批（含 AskUser） */
  permissionRequest?: NotificationSoundId
  /** 计划审批 */
  exitPlanMode?: NotificationSoundId
}

/** 语音输入供应商 */
export type VoiceDictationProvider = 'doubao'

/** 豆包 ASR 连接模式 */
export type VoiceDictationEndpointMode = 'async' | 'duplex'

/** 语音输入输出方式 */
export type VoiceDictationOutputMode = 'auto' | 'clipboard' | 'proma-input'

/** 语音输入浮窗位置 */
export interface VoiceDictationWindowPosition {
  x: number
  y: number
  /** 窗口相对于所在屏幕 workArea 的归一化水平偏移 (0~1) */
  relativeX?: number
  /** 窗口相对于所在屏幕 workArea 的归一化垂直偏移 (0~1) */
  relativeY?: number
}

/** 语音输入设置（渲染进程读取到的是解密后的值） */
export interface VoiceDictationSettings {
  /** 是否启用语音输入 */
  enabled: boolean
  /** 语音识别供应商 */
  provider: VoiceDictationProvider
  /** 豆包 APP ID，对应 X-Api-App-Key 请求头 */
  appId: string
  /** 豆包 Access Token，对应 X-Api-Access-Key 请求头 */
  accessToken: string
  /** 豆包 Resource ID */
  resourceId: string
  /** 语言，空字符串表示自动 */
  language: string
  /** WebSocket 端点模式 */
  endpointMode: VoiceDictationEndpointMode
  /** 输出方式 */
  outputMode: VoiceDictationOutputMode
  /** 自定义热词，按行或逗号分隔，启动识别时直传给豆包 ASR */
  customHotwords: string
  /** 语音输入浮窗上次拖动后的位置 */
  windowPosition?: VoiceDictationWindowPosition
}

/** 语音输入设置更新 */
export type VoiceDictationSettingsUpdate = Partial<VoiceDictationSettings>

/** 落盘配置，保留旧字段用于从 MVP 早期版本平滑迁移 */
export interface VoiceDictationPersistedSettings extends Partial<VoiceDictationSettings> {
  /** @deprecated 使用 appId */
  appKey?: string
  /** @deprecated 使用 accessToken */
  accessKey?: string
}

/** 语音输入转写事件 */
export interface VoiceDictationTranscriptEvent {
  sessionId: string
  text: string
  isFinal: boolean
}

/** 语音输入状态事件 */
export interface VoiceDictationStateEvent {
  sessionId?: string
  status: 'idle' | 'connecting' | 'recording' | 'stopping' | 'completed' | 'error'
  message?: string
}

/** 开始语音输入会话参数 */
export interface VoiceDictationStartInput {
  sessionId: string
}

/** 语音音频分片 */
export interface VoiceDictationAudioChunkInput {
  sessionId: string
  data: ArrayBuffer
}

/** 结束语音输入会话参数 */
export interface VoiceDictationStopInput {
  sessionId: string
}

/** 输出语音输入文本参数 */
export interface VoiceDictationCommitInput {
  text: string
}

/** 调整语音输入浮窗尺寸参数 */
export interface VoiceDictationResizeInput {
  height: number
}

/** 输出语音输入文本结果 */
export interface VoiceDictationCommitResult {
  mode: 'proma-input' | 'cursor' | 'clipboard'
  success: boolean
  message: string
}

/** 语音输入测试结果 */
export interface VoiceDictationTestResult {
  success: boolean
  message: string
}

/** 麦克风权限检查结果 */
export interface MicPermissionResult {
  status: 'granted' | 'denied' | 'not-determined' | 'unsupported'
  platform: NodeJS.Platform
}

/**
 * 用户自定义快捷键覆盖（持久化到 settings.json）
 *
 * 字段三态语义：
 * - `undefined`（字段缺失）→ 使用默认快捷键
 * - 非空字符串 → 使用该自定义 accelerator
 * - `null` → 用户已主动禁用此平台的快捷键，不注册任何监听
 */
export interface ShortcutOverrides {
  [shortcutId: string]: {
    mac?: string | null
    win?: string | null
  }
}

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system' | 'special'

/** 所有合法的特殊风格值（白名单，新增主题时只需追加这里） */
export const THEME_STYLES = [
  'default',
  'ocean-light',
  'ocean-dark',
  'forest-light',
  'forest-dark',
  'slate-light',
  'slate-dark',
  'terminal-dark',
] as const

/** 特殊风格主题 */
export type ThemeStyle = (typeof THEME_STYLES)[number]

/** 默认主题模式 */
export const DEFAULT_THEME_MODE: ThemeMode = 'dark'

/** 默认特殊风格 */
export const DEFAULT_THEME_STYLE: ThemeStyle = 'default'

/** 界面风格：经典保留旧版视觉，现代使用当前更克制的 UI */
export type InterfaceVariant = 'classic' | 'modern'

/** 默认界面风格 */
export const DEFAULT_INTERFACE_VARIANT: InterfaceVariant = 'modern'

/** 新建 Agent 会话与自动任务的默认 runtime。历史持久化记录缺失 runtime 时仍按 Claude 兼容。 */
export const DEFAULT_AGENT_RUNTIME: AgentRuntime = 'pi'

/** Markdown 预览字号档位 */
export type MarkdownFontSize = 'small' | 'medium' | 'large'

/** 默认 Markdown 字号档位 */
export const DEFAULT_MARKDOWN_FONT_SIZE: MarkdownFontSize = 'medium'

/** 应用设置 */
export interface AppSettings {
  /** 主题模式 */
  themeMode: ThemeMode
  /** 特殊风格主题 */
  themeStyle?: ThemeStyle
  /** 界面风格 */
  interfaceVariant?: InterfaceVariant
  /** Agent 默认渠道 ID（由当前 Agent Core 解释） — 当前选中的渠道 */
  agentChannelId?: string
  /** Agent 默认模型 ID */
  agentModelId?: string
  /** Claude Agent 可用渠道 ID 列表（由渠道启用状态与协议兼容性派生） */
  agentChannelIds?: string[]
  /** Agent 当前工作区 ID */
  agentWorkspaceId?: string
  /** 新 Agent 会话默认使用的 runtime；历史会话缺省仍按 claude 兼容。 */
  agentRuntime?: AgentRuntime
  /** 侧栏「自动任务」合成项目组在项目列表中的位置索引（默认 0 = 最靠前；可拖拽调整） */
  agentAutomationGroupOrder?: number
  /** 是否已完成 Onboarding 流程 */
  onboardingCompleted?: boolean
  /** 是否跳过了环境检测 */
  environmentCheckSkipped?: boolean
  /** 最后一次环境检测结果（缓存） */
  lastEnvironmentCheck?: EnvironmentCheckResult
  /** 是否启用桌面通知 */
  notificationsEnabled?: boolean
  /** 是否启用通知提示音（阻塞 Hook 触发时播放） */
  notificationSoundEnabled?: boolean
  /** 各场景通知音选择 */
  notificationSounds?: NotificationSoundSettings
  /** 标签页持久化状态（重启恢复） */
  tabState?: PersistedTabSettings
  /** Agent 思考模式 */
  agentThinking?: ThinkingConfig
  /** Agent 推理深度 */
  agentEffort?: AgentEffort
  /** Agent 最大预算（美元/次） */
  agentMaxBudgetUsd?: number
  /** Agent 最大轮次（0 或 undefined = SDK 默认） */
  agentMaxTurns?: number
  /** 教程推荐横幅是否已关闭 */
  tutorialBannerDismissed?: boolean
  /** 自动归档天数（0 = 禁用，默认 7） */
  archiveAfterDays?: number
  /** 发送消息快捷键模式：true = Cmd/Ctrl+Enter 发送，false(默认) = Enter 发送 */
  sendWithCmdEnter?: boolean
  /** 用户自定义快捷键覆盖 */
  shortcutOverrides?: ShortcutOverrides
  /** 是否显示用户消息悬浮置顶条（默认 true） */
  stickyUserMessageEnabled?: boolean
  /** 粘贴超过阈值的长文本时是否自动转为附件（默认 false） */
  longTextPasteAsAttachmentEnabled?: boolean
  /** 输入框是否渲染 Markdown 富文本格式（默认 false，关闭后为纯文本模式，仍保留 Mention 引用） */
  richTextRenderingEnabled?: boolean
  /** Markdown 预览字号档位（默认 'medium'，对应 15px） */
  markdownFontSize?: MarkdownFontSize
  /** 上次是否在 Scratch Pad 页（用于重启恢复） */
  scratchPadActive?: boolean
  /** 应用图标变体 ID（dock + window icon），'default' 或 logo 变体 id */
  appIconVariant?: string
  /** 语音输入设置（Access Token 以加密态存储，由专用服务解密后返回渲染进程） */
  voiceDictation?: VoiceDictationPersistedSettings
  /** 飞书 Session 镜像设置：每个 Proma Session 可创建一个仅包含用户与指定 Bot 的飞书群 */
  feishuSessionMirror?: FeishuSessionMirrorSettings
  /** 用户手动关闭的 Proma 内置 MCP ID 列表（针对默认开启的内置 MCP） */
  builtinMcpDisabledIds?: string[]
  /** 用户手动开启的 Proma 内置 MCP ID 列表（针对默认关闭的内置 MCP，如 nano-banana、mem） */
  builtinMcpEnabledIds?: string[]
  /** 启动时自动清理临时文件（proma-preview、proma-installers），默认 true */
  autoCleanupTempOnStart?: boolean
  /** 自动清理 N 天前已归档会话的 SDK 数据（0 = 禁用，默认 0） */
  autoCleanupArchivedDays?: number
  /** 主窗口状态（大小、位置、是否最大化） */
  mainWindowState?: MainWindowState
}

/** 主窗口大小、位置和最大化状态 */
export interface MainWindowState {
  width: number
  height: number
  x: number
  y: number
  isMaximized: boolean
}

/** 持久化的标签页状态 */
export interface PersistedTabSettings {
  tabs: TabItem[]
  activeTabId: string | null
}

/** 快速任务提交输入 */
export interface QuickTaskSubmitInput {
  /** 任务文本内容 */
  text: string
  /** 目标模式 */
  mode: 'chat' | 'agent'
  /** 附件列表（base64 编码或本地路径引用） */
  files?: QuickTaskFile[]
}

/** 快速任务附件 */
export interface QuickTaskFile {
  filename: string
  mediaType: string
  base64?: string
  sourcePath?: string
  size: number
}

/** 主窗口接收的快速任务打开会话数据 */
export interface QuickTaskOpenSessionData {
  mode: 'chat' | 'agent'
  text: string
  files?: QuickTaskFile[]
}

/** 菜单栏打开 Agent 会话事件 */
export interface TrayOpenAgentSessionData {
  /** Agent 会话 ID */
  sessionId: string
  /** 标签页标题 */
  title: string
}

/** 菜单栏创建会话事件 */
export interface TrayCreateSessionData {
  /** 目标模式 */
  mode: 'chat' | 'agent'
}
