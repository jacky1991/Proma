import type { ElectronAPI } from './types'
import type { AgentSessionMeta, AgentStreamEvent, AgentStreamCompletePayload, PermissionResponse, AskUserResponse, ExitPlanModeResponse, PendingRequestsSnapshot } from '@proma/shared'
import { createHttpClient, type ShimConfig } from './http-client'
import { createWsClient } from './ws-client'

/**
 * 已迁移方法注册表
 *
 * 结构：方法名 → 实现（走 invoke 或 WS）。
 *   每完成一个域的迁移：
 *     1. 在此登记方法实现；
 *     2. 在 docs/plans/api-migration-board.md 将对应通道状态标「已迁移」。
 *
 * M2 迭代 2：Agent 会话 CRUD / 消息发送 / 流式订阅 / 渠道 / 设置。
 */
export function createMigrated(config: ShimConfig): Partial<ElectronAPI> {
  const invoke = createHttpClient(config.apiBase)
  const wsClient = createWsClient(config)

  return {
    // ===== Agent 会话 CRUD =====
    listAgentSessions: () => invoke<AgentSessionMeta[]>('agent:list-sessions'),
    createAgentSession: (input: unknown) => invoke('agent:create-session', input),
    deleteAgentSession: (id: string) => invoke('agent:delete-session', { id }),
    getAgentSDKMessages: (id: string) => invoke('agent:get-sdk-messages', { id }),
    updateAgentTitle: (id: string, title: string) => invoke('agent:update-title', { sessionId: id, title }),
    updateSessionModel: (id: string, model: string) => invoke('agent:update-session-model', { sessionId: id, model }),
    togglePinSession: (id: string) => invoke('agent:toggle-pin', { id }),
    toggleArchiveSession: (id: string) => invoke('agent:toggle-archive', { id }),
    updateSessionPermissionMode: (id: string, mode: string) => invoke('agent:update-session-permission-mode', { sessionId: id, mode }),

    // ===== Agent 消息发送 & 控制 =====
    sendAgentMessage: (input: unknown) => invoke('agent:send-message', input),
    stopAgent: (id: string) => invoke('agent:stop', { sessionId: id }),
    generateAgentTitle: (input: unknown) => invoke('agent:generate-title', input),

    // ===== Agent 工作区 =====
    getAgentWorkspaces: () => invoke('agent:list-workspaces'),
    createAgentWorkspace: (input: unknown) => invoke('agent:create-workspace', input),
    updateAgentWorkspace: (input: unknown) => invoke('agent:update-workspace', input),
    deleteAgentWorkspace: (id: string) => invoke('agent:delete-workspace', { id }),
    reorderAgentWorkspaces: (orderedIds: string[]) => invoke('agent:reorder-workspaces', { orderedIds }),
    getWorkspaceCapabilities: (id: string) => invoke('agent:get-capabilities', { workspaceId: id }),

    // ===== Agent MCP 配置 =====
    getWorkspaceMcpConfig: (workspaceSlug: string) => invoke('agent:get-mcp-config', { workspaceSlug }),
    saveWorkspaceMcpConfig: (workspaceSlug: string, config: unknown) => invoke('agent:save-mcp-config', { workspaceSlug, config }),
    testMcpServer: (name: string, entry: unknown) => invoke('agent:test-mcp-server', { name, entry }),
    setBuiltinMcpEnabled: (workspaceSlug: string, id: string, enabled: boolean) => invoke('agent:set-builtin-mcp-enabled', { workspaceSlug, id, enabled }),

    // ===== Agent Skills =====
    getWorkspaceSkills: (workspaceSlug: string) => invoke('agent:get-skills', { workspaceSlug }),
    getWorkspaceSkillsDir: (workspaceSlug: string) => invoke('agent:get-skills-dir', { workspaceSlug }),
    deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => invoke('agent:delete-skill', { workspaceSlug, skillSlug }),
    toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => invoke('agent:toggle-skill', { workspaceSlug, skillSlug, enabled }),
    getOtherWorkspaceSkills: (currentSlug: string) => invoke('agent:get-other-workspace-skills', { currentSlug }),
    getDefaultSkillSlugs: () => invoke('agent:get-default-skill-slugs'),
    importSkillFromWorkspace: (targetSlug: string, sourceSlug: string, skillSlug: string) => invoke('agent:import-skill-from-workspace', { targetSlug, sourceSlug, skillSlug }),
    updateSkillFromSource: (targetSlug: string, skillSlug: string) => invoke('agent:update-skill-from-source', { targetSlug, skillSlug }),
    readSkillContent: (workspaceSlug: string, skillSlug: string) => invoke('agent:read-skill-content', { workspaceSlug, skillSlug }),
    writeSkillContent: (workspaceSlug: string, skillSlug: string, content: string) => invoke('agent:write-skill-content', { workspaceSlug, skillSlug, content }),
    listSkillFiles: (workspaceSlug: string, skillSlug: string) => invoke('agent:list-skill-files', { workspaceSlug, skillSlug }),
    readSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string) => invoke('agent:read-skill-file', { workspaceSlug, skillSlug, relativePath }),
    writeSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string, content: string) => invoke('agent:write-skill-file', { workspaceSlug, skillSlug, relativePath, content }),
    createSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory') => invoke('agent:create-skill-entry', { workspaceSlug, skillSlug, relativePath, type }),
    deleteSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string) => invoke('agent:delete-skill-entry', { workspaceSlug, skillSlug, relativePath }),
    renameSkillEntry: (workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string) => invoke('agent:rename-skill-entry', { workspaceSlug, skillSlug, fromRelative, toRelative }),

    // ===== 工作区记忆文件 =====
    getWorkspaceMemorySummary: (workspaceSlug: string) => invoke('agent:get-workspace-memory-summary', { workspaceSlug }),
    readWorkspaceClaudeMd: (workspaceSlug: string) => invoke('agent:read-workspace-claude-md', { workspaceSlug }),
    writeWorkspaceClaudeMd: (workspaceSlug: string, content: string) => invoke('agent:write-workspace-claude-md', { workspaceSlug, content }),
    listWorkspaceAutoMemoryFiles: (workspaceSlug: string) => invoke('agent:list-workspace-auto-memory-files', { workspaceSlug }),
    readWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string) => invoke('agent:read-workspace-auto-memory-file', { workspaceSlug, relativePath }),
    writeWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string, content: string) => invoke('agent:write-workspace-auto-memory-file', { workspaceSlug, relativePath, content }),

    // ===== Agent 文件操作 =====
    getAgentSessionPath: (workspaceId: string, sessionId: string) => invoke('agent:get-session-path', { workspaceId, sessionId }),
    listDirectory: (dirPath: string) => invoke('agent:list-directory', { dirPath }),
    deleteFile: (filePath: string) => invoke('agent:delete-file', { filePath }),
    renameFile: (filePath: string, newName: string) => invoke('agent:rename-file', { filePath, newName }),
    moveFile: (filePath: string, targetDir: string) => invoke('agent:move-file', { filePath, targetDir }),
    getWorkspaceFilesPath: (workspaceSlug: string) => invoke('agent:get-workspace-files-path', { workspaceSlug }),
    checkPathsType: (paths: string[]) => invoke('agent:check-paths-type', { paths }),
    searchWorkspaceFiles: (rootPath: string, query: string, limit?: number) => invoke('agent:search-workspace-files', { rootPath, query, limit }),

    // ===== Agent 流式订阅（走 WS） =====
    onAgentStreamEvent: (cb: (event: AgentStreamEvent) => void) =>
      wsClient.on('agent:stream-event', cb as (payload: unknown) => void),
    onAgentStreamComplete: (cb: (data: AgentStreamCompletePayload) => void) =>
      wsClient.on('agent:stream-complete', cb as (payload: unknown) => void),
    onAgentStreamError: (cb: (data: { sessionId: string; error: string }) => void) =>
      wsClient.on('agent:stream-error', cb as (payload: unknown) => void),
    onAgentTitleUpdated: (cb: (data: { sessionId: string; title: string }) => void) =>
      wsClient.on('agent:title-updated', cb as (payload: unknown) => void),

    // ===== Agent 权限 / AskUser / ExitPlanMode 交互 =====
    respondPermission: (response: PermissionResponse) => invoke('agent:permission:respond', response),
    respondAskUser: (response: AskUserResponse) => invoke('agent:ask-user:respond', response),
    respondExitPlanMode: (response: ExitPlanModeResponse) => invoke('agent:exit-plan-mode:respond', response),
    getPendingRequests: () => invoke<PendingRequestsSnapshot>('agent:get-pending-requests'),

    // ===== Channel 域 =====
    listChannels: () => invoke('channel:list'),
    createChannel: (input: unknown) => invoke('channel:create', input),
    updateChannel: (input: unknown) => invoke('channel:update', input),
    deleteChannel: (id: string) => invoke('channel:delete', { id }),
    testChannel: (input: unknown) => invoke('channel:test', input),
    fetchChannelModels: (input: unknown) => invoke('channel:fetch-models', input),

    // ===== Settings / Profile 域 =====
    getSettings: () => invoke('settings:get'),
    updateSettings: (input: unknown) => invoke('settings:update', input),
    getUserProfile: () => invoke('user-profile:get'),
    updateUserProfile: (input: unknown) => invoke('user-profile:update', input),

    // ===== System Prompt 域 =====
    getSystemPromptConfig: () => invoke('system-prompt:get-config'),
    createSystemPrompt: (input: unknown) => invoke('system-prompt:create', input),
    updateSystemPrompt: (id: string, input: unknown) => invoke('system-prompt:update', { id, input }),
    deleteSystemPrompt: (id: string) => invoke('system-prompt:delete', { id }),
    updateAppendSetting: (enabled: boolean) => invoke('system-prompt:update-append-setting', { enabled }),
    setDefaultPrompt: (id: string | null) => invoke('system-prompt:set-default', { id }),

    // ===== Chat 域 =====
    listConversations: () => invoke('chat:list-conversations'),
    createConversation: (title?: string, modelId?: string, channelId?: string) => invoke('chat:create-conversation', { title, modelId, channelId }),
    getConversationMessages: (id: string) => invoke('chat:get-messages', { id }),
    getRecentMessages: (id: string, limit: number) => invoke('chat:get-recent-messages', { id, limit }),
    updateConversationTitle: (id: string, title: string) => invoke('chat:update-title', { id, title }),
    deleteConversation: (id: string) => invoke('chat:delete-conversation', { id }),
    updateConversationModel: (id: string, modelId: string, channelId: string) => invoke('chat:update-conversation-model', { id, modelId, channelId }),
    togglePinConversation: (id: string) => invoke('chat:toggle-pin', { id }),
    deleteChatMessage: (conversationId: string, messageId: string) => invoke('chat:delete-message', { conversationId, messageId }),
    truncateMessagesFrom: (conversationId: string, messageId: string) => invoke('chat:truncate-messages-from', { conversationId, messageId }),
    updateContextDividers: (conversationId: string, dividers: string[]) => invoke('chat:update-context-dividers', { conversationId, dividers }),
    sendMessage: (input: unknown) => invoke('chat:send-message', input),
    stopGeneration: (conversationId: string) => invoke('chat:stop-generation', { conversationId }),
    generateTitle: (input: unknown) => invoke('chat:generate-title', input),

    // ===== Chat 流式订阅（走 WS） =====
    onStreamChunk: (cb: (event: unknown) => void) =>
      wsClient.on('chat:stream:chunk', cb),
    onStreamReasoning: (cb: (event: unknown) => void) =>
      wsClient.on('chat:stream:reasoning', cb),
    onStreamComplete: (cb: (event: unknown) => void) =>
      wsClient.on('chat:stream:complete', cb),
    onStreamError: (cb: (event: unknown) => void) =>
      wsClient.on('chat:stream:error', cb),
    onStreamToolActivity: (cb: (event: unknown) => void) =>
      wsClient.on('chat:stream:tool-activity', cb),
  } as Partial<ElectronAPI>
}

/**
 * 已迁移方法名集合
 * 供 Proxy 快速判断，亦可作为看板自动校验来源
 */
export const migratedNames: ReadonlySet<string> = new Set([
  // Agent 会话 CRUD
  'listAgentSessions',
  'createAgentSession',
  'deleteAgentSession',
  'getAgentSDKMessages',
  'updateAgentTitle',
  'updateSessionModel',
  'togglePinSession',
  'toggleArchiveSession',
  'updateSessionPermissionMode',
  // Agent 消息发送 & 控制
  'sendAgentMessage',
  'stopAgent',
  'generateAgentTitle',
  // Agent 工作区
  'getAgentWorkspaces',
  'createAgentWorkspace',
  'updateAgentWorkspace',
  'deleteAgentWorkspace',
  'reorderAgentWorkspaces',
  'getWorkspaceCapabilities',
  // Agent MCP 配置
  'getWorkspaceMcpConfig',
  'saveWorkspaceMcpConfig',
  'testMcpServer',
  'setBuiltinMcpEnabled',
  // Agent Skills
  'getWorkspaceSkills',
  'getWorkspaceSkillsDir',
  'deleteWorkspaceSkill',
  'toggleWorkspaceSkill',
  'getOtherWorkspaceSkills',
  'getDefaultSkillSlugs',
  'importSkillFromWorkspace',
  'updateSkillFromSource',
  'readSkillContent',
  'writeSkillContent',
  'listSkillFiles',
  'readSkillFile',
  'writeSkillFile',
  'createSkillEntry',
  'deleteSkillEntry',
  'renameSkillEntry',
  // 工作区记忆文件
  'getWorkspaceMemorySummary',
  'readWorkspaceClaudeMd',
  'writeWorkspaceClaudeMd',
  'listWorkspaceAutoMemoryFiles',
  'readWorkspaceAutoMemoryFile',
  'writeWorkspaceAutoMemoryFile',
  // Agent 文件操作
  'getAgentSessionPath',
  'listDirectory',
  'deleteFile',
  'renameFile',
  'moveFile',
  'getWorkspaceFilesPath',
  'checkPathsType',
  'searchWorkspaceFiles',
  // Agent 流式订阅
  'onAgentStreamEvent',
  'onAgentStreamComplete',
  'onAgentStreamError',
  'onAgentTitleUpdated',
  // Agent 权限 / AskUser / ExitPlanMode 交互
  'respondPermission',
  'respondAskUser',
  'respondExitPlanMode',
  'getPendingRequests',
  // Channel 域
  'listChannels',
  'createChannel',
  'updateChannel',
  'deleteChannel',
  'testChannel',
  'fetchChannelModels',
  // Settings / Profile 域
  'getSettings',
  'updateSettings',
  'getUserProfile',
  'updateUserProfile',
  // System Prompt 域
  'getSystemPromptConfig',
  'createSystemPrompt',
  'updateSystemPrompt',
  'deleteSystemPrompt',
  'updateAppendSetting',
  'setDefaultPrompt',
  // Chat 域
  'listConversations',
  'createConversation',
  'getConversationMessages',
  'getRecentMessages',
  'updateConversationTitle',
  'deleteConversation',
  'updateConversationModel',
  'togglePinConversation',
  'deleteChatMessage',
  'truncateMessagesFrom',
  'updateContextDividers',
  'sendMessage',
  'stopGeneration',
  'generateTitle',
  // Chat 流式订阅
  'onStreamChunk',
  'onStreamReasoning',
  'onStreamComplete',
  'onStreamError',
  'onStreamToolActivity',
])
