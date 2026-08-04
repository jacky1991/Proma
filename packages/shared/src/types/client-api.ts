/**
 * Proma 客户端 API 契约（transport 无关）
 *
 * 定义渲染进程可见的 window.electronAPI 全量接口，由两端共享同一契约：
 *   - Electron 端：preload 经 contextBridge.exposeInMainWorld 注入真实 IPC 实现；
 *   - Web 端：apps/web 的 shim 以 HTTP/WS + Proxy 兜底实现同一接口注入浏览器。
 *
 * 本接口自 apps/electron/src/preload 的 ElectronAPI 迁移而来（M4 迭代 11 步骤 2），
 * 是 web 与 electron 之间唯一的客户端契约单源。
 */

import type {
  AgentAttachDirectoryInput,
  AgentAttachFileInput,
  AgentGenerateTitleInput,
  AgentMessageSearchResult,
  AgentQueueMessageInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentSendInput,
  AgentSessionMeta,
  AgentSessionReferenceSearchInput,
  AgentSessionReferenceSearchResult,
  AgentStreamCompletePayload,
  AgentStreamEvent,
  AgentThinkingLevel,
  AgentWorkspace,
  AskUserResponse,
  ExitPlanModeResponse,
  FileEntry,
  FileSearchResult,
  ForkSessionInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  McpServerEntry,
  MoveSessionToWorkspaceInput,
  PendingRequestsSnapshot,
  PermissionResponse,
  PromaPermissionMode,
  RewindSessionInput,
  RewindSessionResult,
  SDKMessage,
  SkillFileContent,
  SkillFileNode,
  SkillGroupDef,
  SkillsGroupConfig,
  SkillMeta,
  StopTaskInput,
  WorkspaceAttachDirectoryInput,
  WorkspaceAttachFileInput,
  WorkspaceCapabilities,
  WorkspaceMcpConfig,
  WorkspaceMemorySummary,
  WorkspaceWorktreeRepo,
} from './agent'
import type {
  AgentRuntime,
} from './agent-provider'
import type {
  AuthUser,
  ChangePasswordInput,
  DeleteUserInput,
  ResetUserPasswordInput,
} from './auth'
import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './automation'
import type {
  Channel,
  ChannelCreateInput,
  ChannelDirectTestInput,
  ChannelPlanQuotaResult,
  ChannelTestResult,
  ChannelUpdateInput,
  CodexOAuthLoginResult,
  FetchModelsInput,
  FetchModelsResult,
} from './channel'
import type {
  AttachmentSaveInput,
  AttachmentSaveResult,
  ChatMessage,
  ChatSendInput,
  ConversationMeta,
  FileDialogResult,
  GenerateTitleInput,
  MessageSearchResult,
  RecentMessagesResult,
  StreamChunkEvent,
  StreamCompleteEvent,
  StreamErrorEvent,
  StreamReasoningEvent,
  StreamToolActivityEvent,
} from './chat'
import type {
  ChatToolInfo,
  ChatToolMeta,
  ChatToolState,
} from './chat-tool'
import type {
  EnvironmentCheckResult,
} from './environment'
import type {
  GitHubRelease,
  GitHubReleaseListOptions,
} from './github'
import type {
  InstallerDownloadRequest,
  InstallerDownloadResult,
  InstallerManifest,
  InstallerProgressPayload,
} from './installer'
import type {
  ProxyConfig,
  SystemProxyDetectResult,
} from './proxy'
import type { BrandingConfig } from './branding'
import type {
  DefaultAppInfo,
  DetachedPreviewWindowData,
  FileAccessOptions,
  GetFileDiffInput,
  GitRepoStatus,
  OfficePreviewResult,
  ResolvedFileUrl,
  RevertFileInput,
  RuntimeStatus,
  UnstagedChangesResult,
  WorktreeInfo,
} from './runtime'
import type {
  AppSettings,
  QuickTaskOpenSessionData,
  QuickTaskSubmitInput,
  TrayCreateSessionData,
  TrayOpenAgentSessionData,
} from './settings'
import type {
  SystemPrompt,
  SystemPromptConfig,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
} from './system-prompt'
import type {
  UserProfile,
} from './user-profile'

export interface PromaClientAPI {
  // ===== 运行时相关 =====

  /**
   * 获取运行时状态
   * @returns 运行时状态，包含 Bun、Git 等信息
   */
  getRuntimeStatus: () => Promise<RuntimeStatus | null>

  /**
   * 重新初始化运行时状态（重新跑 Node / Bun / Git / Shell 检测）
   * 用户安装完 Git / Node 后触发，强制刷新缓存
   */
  reinitRuntime: () => Promise<RuntimeStatus>

  /**
   * 获取指定目录的 Git 仓库状态
   * @param dirPath - 目录路径
   * @returns Git 仓库状态
   */
  getGitRepoStatus: (dirPath: string) => Promise<GitRepoStatus | null>

  /** 获取未暂存的变更文件列表 */
  getUnstagedChanges: (dirPath: string, sessionPath?: string, workspaceFilesPath?: string, extraPaths?: string[], sessionId?: string) => Promise<UnstagedChangesResult>
  /** 还原文件变更 */
  revertFile: (input: RevertFileInput) => Promise<void>
  /** 获取文件新旧版本内容 */
  getDiffContents: (input: GetFileDiffInput) => Promise<{ oldContent: string; newContent: string } | null>
  /** 列出 Git Worktree */
  listWorktrees: (repoPath: string, sessionId: string) => Promise<WorktreeInfo[]>
  /** 获取 Worktree 相对于基准分支的全量变更 */
  getWorktreeChanges: (worktreePath: string, baseBranch: string, sessionId: string) => Promise<UnstagedChangesResult>
  /** 获取独立预览窗口数据 */
  getDetachedPreviewData: (previewId: string) => Promise<DetachedPreviewWindowData | null>

  // ===== 通用工具 =====

  /** 在系统默认浏览器中打开外部链接 */
  openExternal: (url: string) => Promise<void>

  // ===== 窗口控制（Windows 自定义标题栏）=====

  /** 最小化窗口 */
  windowMinimize: () => Promise<void>
  /** 最大化/还原窗口 */
  windowMaximize: () => Promise<void>
  /** 关闭窗口 */
  windowClose: () => Promise<void>
  /** 窗口是否处于最大化状态 */
  windowIsMaximized: () => Promise<boolean>
  /** 订阅窗口最大化/还原事件 */
  onWindowResize: (callback: () => void) => () => void

  // ===== 渠道管理相关 =====

  /** 获取所有渠道列表（apiKey 保持加密态） */
  listChannels: () => Promise<Channel[]>

  /** 创建渠道（apiKey 为明文，主进程加密） */
  createChannel: (input: ChannelCreateInput) => Promise<Channel>

  /** 更新渠道 */
  updateChannel: (id: string, input: ChannelUpdateInput) => Promise<Channel>

  /** 删除渠道 */
  deleteChannel: (id: string) => Promise<void>

  /** 解密获取明文 API Key（仅在用户查看时调用） */
  decryptApiKey: (channelId: string) => Promise<string>

  /** 测试渠道连接 */
  testChannel: (channelId: string) => Promise<ChannelTestResult>

  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  testChannelDirect: (input: ChannelDirectTestInput) => Promise<ChannelTestResult>

  /** 从供应商拉取可用模型列表（直接传入凭证，无需已保存渠道） */
  fetchModels: (input: FetchModelsInput) => Promise<FetchModelsResult>

  /** 查询渠道订阅 Plan 额度 */
  getChannelPlanQuota: (channelId: string) => Promise<ChannelPlanQuotaResult>

  /** 发起 ChatGPT (Codex) OAuth 登录，返回序列化凭据（作为 apiKey 存储） */
  codexOAuthLogin: () => Promise<CodexOAuthLoginResult>

  /** 取消进行中的 ChatGPT (Codex) OAuth 登录 */
  codexOAuthCancel: () => Promise<void>

  // ===== 对话管理相关 =====

  /** 获取对话列表 */
  listConversations: () => Promise<ConversationMeta[]>

  /** 创建对话 */
  createConversation: (title?: string, modelId?: string, channelId?: string) => Promise<ConversationMeta>

  /** 获取对话消息 */
  getConversationMessages: (id: string) => Promise<ChatMessage[]>

  /** 获取对话最近 N 条消息（分页加载） */
  getRecentMessages: (id: string, limit: number) => Promise<RecentMessagesResult>

  /** 更新对话标题 */
  updateConversationTitle: (id: string, title: string) => Promise<ConversationMeta>

  /** 更新对话使用的模型/渠道 */
  updateConversationModel: (id: string, modelId: string, channelId: string) => Promise<ConversationMeta>

  /** 删除对话 */
  deleteConversation: (id: string) => Promise<void>

  /** 切换对话置顶状态 */
  togglePinConversation: (id: string) => Promise<ConversationMeta>

  /** 切换对话归档状态 */
  toggleArchiveConversation: (id: string) => Promise<ConversationMeta>

  /** 搜索对话消息内容 */
  searchConversationMessages: (query: string) => Promise<MessageSearchResult[]>

  // ===== 消息发送 =====

  /** 发送消息（触发 AI 流式响应） */
  sendMessage: (input: ChatSendInput) => Promise<void>

  /** 中止生成 */
  stopGeneration: (conversationId: string) => Promise<void>

  /** 删除指定消息 */
  deleteMessage: (conversationId: string, messageId: string) => Promise<ChatMessage[]>

  /** 从指定消息开始截断（包含该消息） */
  truncateMessagesFrom: (
    conversationId: string,
    messageId: string,
    preserveFirstMessageAttachments?: boolean,
  ) => Promise<ChatMessage[]>

  /** 更新上下文分隔线 */
  updateContextDividers: (conversationId: string, dividers: string[]) => Promise<ConversationMeta>

  /** 生成对话标题 */
  generateTitle: (input: GenerateTitleInput) => Promise<string | null>

  // ===== 附件管理相关 =====

  /** 保存附件到本地 */
  saveAttachment: (input: AttachmentSaveInput) => Promise<AttachmentSaveResult>

  /** 读取附件（返回 base64 字符串） */
  readAttachment: (localPath: string) => Promise<string>

  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  saveImageAs: (localPath: string, defaultFilename: string) => Promise<boolean>

  /** 保存应用内置资源文件到用户选择的位置（原生 Save As 对话框） */
  saveResourceFileAs: (resourceRelativePath: string, defaultFilename: string) => Promise<boolean>

  /** 删除附件 */
  deleteAttachment: (localPath: string) => Promise<void>

  /** 打开文件选择对话框 */
  openFileDialog: () => Promise<FileDialogResult>

  /** 提取附件文档的文本内容 */
  extractAttachmentText: (localPath: string) => Promise<string>

  // ===== 用户档案相关 =====

  /** 获取用户档案 */
  getUserProfile: () => Promise<UserProfile>

  /** 更新用户档案 */
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<UserProfile>

  // ===== 应用设置相关 =====

  /** 获取应用设置 */
  getSettings: () => Promise<AppSettings>

  /** 更新应用设置 */
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>

  /** 同步更新应用设置（用于 beforeunload 场景） */
  updateSettingsSync: (updates: Partial<AppSettings>) => boolean

  /** 获取系统主题（是否深色模式） */
  getSystemTheme: () => Promise<boolean>

  /** 订阅系统主题变化事件（返回清理函数） */
  onSystemThemeChanged: (callback: (isDark: boolean) => void) => () => void

  /** 订阅用户手动切换主题事件（跨窗口同步，返回清理函数） */
  onThemeSettingsChanged: (callback: (payload: { themeMode: string; themeStyle: string; interfaceVariant?: string }) => void) => () => void

  // ===== Scratch Pad =====

  /** 从磁盘加载 scratch-pad.md */
  loadScratchPad: () => Promise<string>

  /** 异步保存内容到 scratch-pad.md */
  saveScratchPad: (content: string) => Promise<boolean>

  /** 同步保存内容到 scratch-pad.md（beforeunload 场景） */
  saveScratchPadSync: (content: string) => boolean

  /** 导出 ScratchPad 内容为 Markdown 文件到指定目录 */
  exportScratchPad: (markdown: string, dirPath: string, filename: string) => Promise<string>

  /** 打开原生保存对话框，返回用户选择的路径 */
  chooseExportPath: (defaultName: string) => Promise<string | null>

  // ===== 应用图标切换 =====

  /** 设置应用图标变体（传入 variant ID，如 'blue'、'cyberpunk'，'default' 恢复默认） */
  setAppIcon: (variantId: string) => Promise<boolean>

  /** 设置 Dock/Launcher 角标数量（0 表示清除） */
  setDockBadgeCount: (count: number) => Promise<boolean>

  // ===== 环境检测相关 =====

  /** 执行环境检测 */
  checkEnvironment: () => Promise<EnvironmentCheckResult>

  // ===== 第三方安装包（Git / Node.js）相关 =====

  /** 获取安装包清单（远程，失败回退内置） */
  fetchInstallerManifest: () => Promise<InstallerManifest>

  /** 开始下载指定安装包，resolve 时文件已落地并通过 sha256 校验 */
  downloadInstaller: (req: InstallerDownloadRequest) => Promise<InstallerDownloadResult>

  /** 取消指定 key 的进行中下载 */
  cancelInstallerDownload: (key: string) => Promise<boolean>

  /** 拉起已下载的安装程序（等效双击） */
  launchInstaller: (filePath: string) => Promise<void>

  /** 订阅下载进度事件，返回取消订阅函数 */
  onInstallerProgress: (
    callback: (payload: InstallerProgressPayload) => void,
  ) => () => void

  // ===== 代理配置相关 =====

  /** 获取代理配置 */
  getProxySettings: () => Promise<ProxyConfig>

  /** 更新代理配置 */
  updateProxySettings: (config: ProxyConfig) => Promise<void>

  /** 检测系统代理 */
  detectSystemProxy: () => Promise<SystemProxyDetectResult>

  // ===== 流式事件订阅（返回清理函数） =====

  /** 订阅内容片段事件 */
  onStreamChunk: (callback: (event: StreamChunkEvent) => void) => () => void

  /** 订阅推理片段事件 */
  onStreamReasoning: (callback: (event: StreamReasoningEvent) => void) => () => void

  /** 订阅流式完成事件 */
  onStreamComplete: (callback: (event: StreamCompleteEvent) => void) => () => void

  /** 订阅流式错误事件 */
  onStreamError: (callback: (event: StreamErrorEvent) => void) => () => void

  /** 订阅流式工具活动事件 */
  onStreamToolActivity: (callback: (event: StreamToolActivityEvent) => void) => () => void

  // ===== Agent 会话管理相关 =====

  /** 获取 Agent 会话列表 */
  listAgentSessions: () => Promise<AgentSessionMeta[]>

  /** 创建 Agent 会话 */
  createAgentSession: (title?: string, channelId?: string, workspaceId?: string, modelId?: string) => Promise<AgentSessionMeta>

  /** 获取 Agent 会话 SDKMessage（Phase 4 新格式） */
  getAgentSessionSDKMessages: (id: string) => Promise<SDKMessage[]>

  /** 更新 Agent 会话标题 */
  updateAgentSessionTitle: (id: string, title: string) => Promise<AgentSessionMeta>

  /** 切换 Agent 会话 runtime */
  updateSessionAgentRuntime: (sessionId: string, runtime: AgentRuntime) => Promise<AgentSessionMeta>

  /** 切换当前会话的 ChatGPT Codex Fast Mode */
  updateSessionCodexFastMode: (sessionId: string, enabled: boolean) => Promise<AgentSessionMeta>

  /** 更新当前会话的 Codex 思考深度 */
  updateSessionOpenAIThinkingLevel: (sessionId: string, thinkingLevel: AgentThinkingLevel) => Promise<AgentSessionMeta>

  /** 更新 Agent 会话模型选择 */
  updateAgentSessionModel: (id: string, channelId?: string, modelId?: string) => Promise<AgentSessionMeta>

  /** 删除 Agent 会话 */
  deleteAgentSession: (id: string) => Promise<void>

  /** 迁移 Chat 对话记录到 Agent 会话 */
  migrateChatToAgent: (conversationId: string, agentSessionId: string) => Promise<void>

  /** 切换 Agent 会话置顶状态 */
  togglePinAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 清除 Agent 会话完成状态（兼容清除旧版 manualWorking） */
  clearAgentCompletionState: (id: string) => Promise<AgentSessionMeta>

  /** 切换 Agent 会话归档状态 */
  toggleArchiveAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 搜索 Agent 会话消息内容 */
  searchAgentSessionMessages: (query: string) => Promise<AgentMessageSearchResult[]>

  /** 搜索当前工作区可引用的 Agent 会话 */
  searchAgentSessionReferences: (input: AgentSessionReferenceSearchInput) => Promise<AgentSessionReferenceSearchResult[]>

  /** 迁移 Agent 会话到另一个工作区 */
  moveAgentSessionToWorkspace: (input: MoveSessionToWorkspaceInput) => Promise<AgentSessionMeta>

  /** 分叉 Agent 会话 */
  forkAgentSession: (input: ForkSessionInput) => Promise<AgentSessionMeta>

  /** 快照回退（同一会话内回退到指定点，恢复文件 + 截断对话） */
  rewindSession: (input: RewindSessionInput) => Promise<RewindSessionResult>

  /** 生成 Agent 会话标题 */
  generateAgentTitle: (input: AgentGenerateTitleInput) => Promise<string | null>

  /** 发送 Agent 消息 */
  sendAgentMessage: (input: AgentSendInput) => Promise<void>

  /** 中止 Agent 执行 */
  stopAgent: (sessionId: string) => Promise<void>

  // ===== Agent 队列消息 =====

  /** 流式追加发送 Agent 消息（Agent 运行中） */
  queueAgentMessage: (input: AgentQueueMessageInput) => Promise<string>

  // ===== Agent 后台任务管理 =====

  /** 获取任务输出 */
  getTaskOutput: (input: GetTaskOutputInput) => Promise<GetTaskOutputResult>

  /** 停止任务 */
  stopTask: (input: StopTaskInput) => Promise<void>

  // ===== Agent 工作区管理相关 =====

  /** 获取 Agent 工作区列表 */
  listAgentWorkspaces: () => Promise<AgentWorkspace[]>

  /** 创建 Agent 工作区 */
  createAgentWorkspace: (name: string) => Promise<AgentWorkspace>

  /** 更新 Agent 工作区 */
  updateAgentWorkspace: (id: string, updates: { name: string }) => Promise<AgentWorkspace>

  /** 删除 Agent 工作区 */
  deleteAgentWorkspace: (id: string) => Promise<void>

  /** 重排工作区顺序 */
  reorderAgentWorkspaces: (orderedIds: string[]) => Promise<AgentWorkspace[]>

  // ===== 工作区能力（MCP + Skill） =====

  /** 获取工作区能力摘要 */
  getWorkspaceCapabilities: (workspaceSlug: string) => Promise<WorkspaceCapabilities>

  /** 获取工作区 MCP 配置 */
  getWorkspaceMcpConfig: (workspaceSlug: string) => Promise<WorkspaceMcpConfig>

  /** 保存工作区 MCP 配置 */
  saveWorkspaceMcpConfig: (workspaceSlug: string, config: WorkspaceMcpConfig) => Promise<void>

  /** 测试 MCP 服务器连接 */
  testMcpServer: (name: string, entry: McpServerEntry) => Promise<{ success: boolean; message: string }>

  /** 启用或关闭 Proma 内置 MCP */
  setBuiltinMcpEnabled: (workspaceSlug: string, id: string, enabled: boolean) => Promise<WorkspaceCapabilities>

  /** 获取工作区 Skill 列表（含活跃和不活跃） */
  getWorkspaceSkills: (workspaceSlug: string) => Promise<SkillMeta[]>

  /** 获取工作区 Skills 目录绝对路径 */
  getWorkspaceSkillsDir: (workspaceSlug: string) => Promise<string>

  /** 删除工作区 Skill */
  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => Promise<void>

  /** 切换工作区 Skill 启用/禁用 */
  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => Promise<void>

  /** 获取默认 Skills 的 slug 列表（来自 ~/.proma/default-skills/） */
  getDefaultSkillSlugs: () => Promise<string[]>

  /** 获取用户技能分组配置（groups + assignments） */
  getSkillGroups: (workspaceSlug: string) => Promise<SkillsGroupConfig>

  /** 新建用户技能分组 */
  createSkillGroup: (workspaceSlug: string, name: string) => Promise<SkillGroupDef>

  /** 重命名用户技能分组 */
  renameSkillGroup: (workspaceSlug: string, groupId: string, name: string) => Promise<void>

  /** 删除用户技能分组（组内技能归"未分组"） */
  deleteSkillGroup: (workspaceSlug: string, groupId: string) => Promise<void>

  /** 设置技能所属分组（groupId=null 移到未分组） */
  setSkillAssignment: (workspaceSlug: string, skillSlug: string, groupId: string | null) => Promise<void>

  /** 上传 zip 技能包并解压到用户技能目录 */
  uploadSkillZip: (workspaceSlug: string, file: File) => Promise<{ skills: SkillMeta[] }>

  /** 读取 SKILL.md 全文内容 */
  readSkillContent: (workspaceSlug: string, skillSlug: string) => Promise<string>

  /** 写入 SKILL.md 全文内容 */
  writeSkillContent: (workspaceSlug: string, skillSlug: string, content: string) => Promise<void>

  /** 列出 Skill 目录下的子文件树（不含 SKILL.md） */
  listSkillFiles: (workspaceSlug: string, skillSlug: string) => Promise<SkillFileNode[]>

  /** 读取 Skill 目录下的子文件内容 */
  readSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string) => Promise<SkillFileContent>

  /** 写入 Skill 目录下的子文件内容（文本） */
  writeSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string, content: string) => Promise<void>

  /** 在 Skill 目录下创建文件或目录 */
  createSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory') => Promise<void>

  /** 删除 Skill 目录下的文件或目录 */
  deleteSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string) => Promise<void>

  /** 重命名/移动 Skill 目录下的文件或目录 */
  renameSkillEntry: (workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string) => Promise<void>

  /** 获取工作区记忆摘要 */
  getWorkspaceMemorySummary: (workspaceSlug: string) => Promise<WorkspaceMemorySummary>

  /** 读取工作区 CLAUDE.md */
  readWorkspaceClaudeMd: (workspaceSlug: string) => Promise<SkillFileContent>

  /** 写入工作区 CLAUDE.md */
  writeWorkspaceClaudeMd: (workspaceSlug: string, content: string) => Promise<void>

  /** 列出工作区 auto memory 文件树 */
  listWorkspaceAutoMemoryFiles: (workspaceSlug: string) => Promise<SkillFileNode[]>

  /** 读取工作区 auto memory 文件 */
  readWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string) => Promise<SkillFileContent>

  /** 写入工作区 auto memory 文件 */
  writeWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string, content: string) => Promise<void>

  /** 订阅 Agent 流式事件（返回清理函数） */
  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => () => void

  /** 订阅 Agent 流式完成事件 */
  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => () => void

  /** 订阅 Agent 流式错误事件 */
  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => () => void

  /** 订阅 Agent 标题自动更新事件 */
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void

  // ===== Agent 权限系统 =====

  /** 响应权限请求 */
  respondPermission: (response: PermissionResponse) => Promise<void>

  /** 热切换指定会话的权限模式（运行中生效，仅影响该 session） */
  updateSessionPermissionMode: (sessionId: string, mode: PromaPermissionMode) => Promise<void>

  // ===== Chat 工具管理 =====

  /** 获取所有工具信息 */
  getChatTools: () => Promise<ChatToolInfo[]>

  /** 获取工具凭据 */
  getChatToolCredentials: (toolId: string) => Promise<Record<string, string>>

  /** 更新工具开关状态 */
  updateChatToolState: (toolId: string, state: ChatToolState) => Promise<void>

  /** 更新工具凭据 */
  updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) => Promise<void>

  /** 创建自定义工具 */
  createCustomChatTool: (meta: ChatToolMeta) => Promise<void>

  /** 删除自定义工具 */
  deleteCustomChatTool: (toolId: string) => Promise<void>

  /** 监听自定义工具配置变更 */
  onCustomToolChanged: (callback: () => void) => () => void

  /** 测试工具连接 */
  testChatTool: (toolId: string) => Promise<{ success: boolean; message: string }>

  // ===== AskUserQuestion 交互式问答 =====

  /** 响应 AskUser 请求 */
  respondAskUser: (response: AskUserResponse) => Promise<void>

  // ===== ExitPlanMode 计划审批 =====

  /** 响应 ExitPlanMode 请求 */
  respondExitPlanMode: (response: ExitPlanModeResponse) => Promise<void>

  /** 获取所有待处理的交互请求快照（渲染进程重载后恢复状态） */
  getPendingRequests: () => Promise<PendingRequestsSnapshot>

  // ===== Agent 附件 =====

  /** 保存文件到 Agent session 工作目录 */
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => Promise<AgentSavedFile[]>

  /** 保存文件到工作区文件目录 */
  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => Promise<AgentSavedFile[]>

  /** 获取工作区文件目录路径 */
  getWorkspaceFilesPath: (workspaceSlug: string) => Promise<string>

  /** 打开文件夹选择对话框 */
  openFolderDialog: () => Promise<{ path: string; name: string } | null>

  /** 附加外部目录到 Agent 会话 */
  attachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  /** 移除会话的附加目录 */
  detachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  /** 附加外部文件到 Agent 会话 */
  attachFile: (input: AgentAttachFileInput) => Promise<string[]>

  /** 移除会话的附加文件 */
  detachFile: (input: AgentAttachFileInput) => Promise<string[]>

  /** 附加外部目录到工作区（所有会话可访问） */
  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 移除工作区的附加目录 */
  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 附加外部文件到工作区（所有会话可访问） */
  attachWorkspaceFile: (input: WorkspaceAttachFileInput) => Promise<string[]>

  /** 移除工作区的附加文件 */
  detachWorkspaceFile: (input: WorkspaceAttachFileInput) => Promise<string[]>

  /** 获取工作区附加目录列表 */
  getWorkspaceDirectories: (workspaceSlug: string) => Promise<string[]>

  /** 获取工作区附加文件列表 */
  getWorkspaceAttachedFiles: (workspaceSlug: string) => Promise<string[]>
  /** 获取工作区 worktree 仓库配置列表 */
  getWorktreeRepos: (workspaceSlug: string) => Promise<WorkspaceWorktreeRepo[]>
  /** 添加 worktree 仓库到工作区配置 */
  addWorktreeRepo: (workspaceSlug: string, repo: WorkspaceWorktreeRepo) => Promise<WorkspaceWorktreeRepo[]>
  /** 从工作区配置移除 worktree 仓库 */
  removeWorktreeRepo: (workspaceSlug: string, repoPath: string) => Promise<WorkspaceWorktreeRepo[]>

  // ===== Agent 文件系统操作 =====

  /** 获取 session 工作路径 */
  getAgentSessionPath: (workspaceId: string, sessionId: string) => Promise<string | null>

  /** 列出目录内容 */
  listDirectory: (dirPath: string) => Promise<FileEntry[]>

  /** 删除文件/目录 */
  deleteFile: (filePath: string) => Promise<void>

  /** 用系统默认应用打开文件 */
  openFile: (filePath: string) => Promise<void>

  /** 将剪贴板文本写入临时预览文件并返回绝对路径 */
  writeClipboardPreview: (filename: string, content: string) => Promise<string>

  /** 用系统默认应用打开任意文件（无工作区限制） */
  systemOpenFile: (filePath: string, appName?: string, access?: FileAccessOptions) => Promise<void>

  /** 查询本机为该文件类型注册的默认打开应用（含图标 dataURL） */
  getDefaultAppForFile: (filePath: string, access?: FileAccessOptions) => Promise<DefaultAppInfo | null>

  /** 在系统文件管理器中显示文件 */
  showInFolder: (filePath: string) => Promise<void>

  /** 在系统文件管理器中显示文件（无工作区限制，支持候选基础目录） */
  showItemInFolder: (filePath: string, candidateBasePaths?: string[]) => Promise<boolean>

  /** 解析文件路径并读取内容（供内联预览使用） */
  resolveAndReadFile: (filePath: string, access?: FileAccessOptions) => Promise<{ resolvedPath: string; content: string } | null>

  /** 写入文本文件（供 Markdown 内联编辑使用） */
  writeTextFile: (filePath: string, content: string, access?: FileAccessOptions) => Promise<boolean>

  /** 仅解析文件路径（供 PDF/图片等用 file:// 加载） */
  resolveFilePath: (filePath: string, access?: FileAccessOptions) => Promise<ResolvedFileUrl | null>

  /** 为内联 PDF 预览生成临时 HTML 文件，返回文件路径 */
  preparePdfPreview: (filePath: string, access?: FileAccessOptions) => Promise<{ tmpHtmlUrl: string } | null>

  /** 读取文件为 base64（带路径校验，供内联图片预览等） */
  readBinaryBase64: (filePath: string, access?: FileAccessOptions, maxSize?: number) => Promise<string | null>

  /** DOCX 转 HTML（内联预览） */
  docxToHtml: (filePath: string, access?: FileAccessOptions) => Promise<{ resolvedPath: string; html: string } | null>

  /** XLSX/PPTX 转 HTML（内联预览） */
  officeToHtml: (filePath: string, access?: FileAccessOptions) => Promise<OfficePreviewResult | null>

  /** 截图导出：将 HTML 渲染为 PNG 并复制到剪贴板或保存文件 */
  screenshotCapture: (input: { html: string; isDark: boolean; width?: number; mode: 'clipboard' | 'file'; css?: string; themeClass?: string }) => Promise<{ success: boolean; message: string; filePath?: string }>

  /** 重命名文件/目录 */
  renameFile: (filePath: string, newName: string) => Promise<void>

  /** 移动文件/目录到目标目录 */
  moveFile: (filePath: string, targetDir: string) => Promise<void>

  /** 列出附加目录内容 */
  listAttachedDirectory: (dirPath: string, access?: FileAccessOptions) => Promise<FileEntry[]>

  /** 读取附加目录文件内容为 base64（限制在已附加目录范围内） */
  readAttachedFile: (filePath: string, sessionId?: string, workspaceSlug?: string) => Promise<string>

  /** 在文件管理器中显示附加目录文件 */
  showAttachedInFolder: (filePath: string, access?: FileAccessOptions) => Promise<void>

  /** 重命名附加目录文件/目录（无工作区路径限制） */
  renameAttachedFile: (filePath: string, newName: string, access?: FileAccessOptions) => Promise<void>

  /** 移动附加目录文件/目录（无工作区路径限制） */
  moveAttachedFile: (filePath: string, targetDir: string, access?: FileAccessOptions) => Promise<void>

  /** 检查路径类型（文件 or 目录），用于拖拽检测 */
  checkPathsType: (paths: string[]) => Promise<{ directories: string[]; files: string[] }>

  /** 获取拖拽文件的本地路径（替代已废弃的 File.path） */
  getPathForFile: (file: File) => string

  /** 搜索工作区文件（用于 @ 引用，支持附加目录） */
  searchWorkspaceFiles: (rootPath: string, query: string, limit?: number, additionalPaths?: string[], sessionPaths?: string[]) => Promise<FileSearchResult>

  // ===== 系统提示词管理 =====

  /** 获取系统提示词配置 */
  getSystemPromptConfig: () => Promise<SystemPromptConfig>

  /** 创建提示词 */
  createSystemPrompt: (input: SystemPromptCreateInput) => Promise<SystemPrompt>

  /** 更新提示词 */
  updateSystemPrompt: (id: string, input: SystemPromptUpdateInput) => Promise<SystemPrompt>

  /** 删除提示词 */
  deleteSystemPrompt: (id: string) => Promise<void>

  /** 更新追加日期时间和用户名开关 */
  updateAppendSetting: (enabled: boolean) => Promise<void>

  /** 设置默认提示词 */
  setDefaultPrompt: (id: string | null) => Promise<void>

  // GitHub Release
  getLatestRelease: () => Promise<GitHubRelease | null>
  listReleases: (options?: GitHubReleaseListOptions) => Promise<GitHubRelease[]>
  getReleaseByTag: (tag: string) => Promise<GitHubRelease | null>

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => () => void
  onWorkspaceFilesChanged: (callback: () => void) => () => void

  /** 订阅菜单关闭标签页事件（Cmd+W 被菜单拦截后转发） */
  onMenuCloseTab: (callback: () => void) => () => void

  // ===== 快速任务窗口 =====

  /** 提交快速任务 */
  submitQuickTask: (input: QuickTaskSubmitInput) => Promise<void>
  /** 隐藏快速任务窗口 */
  hideQuickTask: () => Promise<void>
  /** 订阅快速任务窗口聚焦事件 */
  onQuickTaskFocus: (callback: () => void) => () => void
  /** 订阅快速任务打开会话事件（主窗口接收，由渲染进程负责创建会话） */
  onQuickTaskOpenSession: (callback: (data: QuickTaskOpenSessionData) => void) => () => void

  // ===== 菜单栏 =====

  /** 订阅菜单栏打开 Agent 会话事件 */
  onTrayOpenAgentSession: (callback: (data: TrayOpenAgentSessionData) => void) => () => void
  /** 订阅菜单栏创建会话事件 */
  onTrayCreateSession: (callback: (data: TrayCreateSessionData) => void) => () => void

  // ===== 存储管理 =====

  /** 获取各目录存储统计 */
  getStorageStats: () => Promise<unknown>
  /** 按选项清理存储 */
  cleanupStorage: (options: unknown) => Promise<unknown>
  /** 清理临时文件（快速） */
  cleanupTempStorage: () => Promise<unknown>

  // ===== 定时任务（Automation）=====
  /** 获取全部定时任务 */
  listAutomations: () => Promise<Automation[]>
  /** 创建定时任务 */
  createAutomation: (input: CreateAutomationInput) => Promise<Automation>
  /** 更新定时任务 */
  updateAutomation: (input: UpdateAutomationInput) => Promise<Automation | undefined>
  /** 删除定时任务 */
  deleteAutomation: (id: string) => Promise<boolean>
  /** 切换启用/暂停 */
  toggleAutomation: (id: string, active: boolean) => Promise<Automation | undefined>
  /** 立即运行一次 */
  runAutomationNow: (id: string) => Promise<void>
  /** 订阅任务列表变更事件 */
  onAutomationChanged: (callback: () => void) => () => void

  // ===== Web 账号与用户管理（仅 Web 端实现，Electron 端不存在）=====

  /** 获取当前登录用户（含角色）；未登录返回 null */
  getAuthUser?: () => Promise<AuthUser | null>
  /** 修改当前用户密码（需校验旧密码） */
  changePassword?: (input: ChangePasswordInput) => Promise<{ ok: boolean }>
  /** 列出全部用户（仅管理员） */
  listUsers?: () => Promise<AuthUser[]>
  /** 管理员重置任意用户密码 */
  resetUserPassword?: (input: ResetUserPasswordInput) => Promise<{ ok: boolean }>
  /** 管理员删除用户（级联清理其私有数据；confirm 必填，防误删） */
  deleteUser?: (input: DeleteUserInput) => Promise<{ ok: boolean }>
  /** 退出登录：清空本地 token 与用户信息（跳转登录页由调用方完成） */
  logout?: () => Promise<{ ok: boolean }>

  // ===== Web 品牌定制（仅 Web 端实现，Electron 端不存在）=====

  /** 获取品牌配置（产品名称 + Logo）；未配置时返回空对象，由前端兜默认值。读取对所有用户公开 */
  getBrandingConfig?: () => Promise<BrandingConfig>
  /** 更新品牌配置（仅管理员）；logoDataUrl 为 base64 data URL，传 undefined 清除自定义 Logo */
  updateBrandingConfig?: (updates: Partial<BrandingConfig>) => Promise<BrandingConfig>
}

// 扩展 Window 接口的类型定义：两端均通过 window.electronAPI 访问客户端 API
declare global {
  interface Window {
    electronAPI: PromaClientAPI
  }
}
