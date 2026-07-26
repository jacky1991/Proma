import type { ElectronAPI } from './types'
import type { AgentSessionMeta, AgentStreamEvent, AgentStreamCompletePayload, PermissionResponse, AskUserResponse, ExitPlanModeResponse, PendingRequestsSnapshot, AttachmentSaveInput, FileDialogResult, AgentQueueMessageInput, ForkSessionInput, RewindSessionInput, AgentAttachDirectoryInput, AgentAttachFileInput, WorkspaceAttachDirectoryInput, WorkspaceAttachFileInput, AgentSaveFilesInput, AgentSaveWorkspaceFilesInput, AgentSessionReferenceSearchInput, MoveSessionToWorkspaceInput, WorkspaceWorktreeRepo, FileAccessOptions, ChannelDirectTestInput, ChannelUpdateInput, CodexOAuthLoginResult, AuthUser, ChangePasswordInput, ResetUserPasswordInput } from '@proma/shared'
import { createHttpClient, type ShimConfig } from './http-client'
import { createWsClient } from './ws-client'
import { getStoredUser, clearTokens, getAccessToken } from './auth-store.ts'

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
    createAgentSession: (title?: string, channelId?: string, workspaceId?: string, modelId?: string) =>
      invoke('agent:create-session', { title, channelId, workspaceId, modelId }),
    deleteAgentSession: (id: string) => invoke('agent:delete-session', { id }),
    getAgentSDKMessages: (id: string) => invoke('agent:get-sdk-messages', { id }),
    getAgentSessionSDKMessages: (id: string) => invoke('agent:get-sdk-messages', { id }),  // 别名
    updateAgentSessionTitle: (id: string, title: string) => invoke('agent:update-title', { sessionId: id, title }),
    updateAgentSessionModel: (id: string, channelId?: string, modelId?: string) => invoke('agent:update-session-model', { sessionId: id, channelId, modelId }),
    togglePinAgentSession: (id: string) => invoke('agent:toggle-pin', { id }),
    toggleArchiveAgentSession: (id: string) => invoke('agent:toggle-archive', { id }),
    updateSessionPermissionMode: (id: string, mode: string) => invoke('agent:update-session-permission-mode', { sessionId: id, mode }),

    // ===== Agent 消息发送 & 控制 =====
    sendAgentMessage: (input: unknown) => invoke('agent:send-message', input),
    stopAgent: (id: string) => invoke('agent:stop', { sessionId: id }),
    generateAgentTitle: (input: unknown) => invoke('agent:generate-title', input),

    // ===== Agent 工作区 =====
    getAgentWorkspaces: () => invoke('agent:list-workspaces'),
    listAgentWorkspaces: () => invoke('agent:list-workspaces'),  // 别名（main.tsx 使用）
    createAgentWorkspace: (input: unknown) => invoke('agent:create-workspace', input),
    updateAgentWorkspace: (id: string, updates: { name: string }) => invoke('agent:update-workspace', { id, ...updates }),
    deleteAgentWorkspace: (id: string) => invoke('agent:delete-workspace', { id }),
    reorderAgentWorkspaces: (orderedIds: string[]) => invoke('agent:reorder-workspaces', { orderedIds }),
    getWorkspaceCapabilities: (workspaceSlug: string) => invoke('agent:get-capabilities', { workspaceSlug }),

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
    searchWorkspaceFiles: (rootPath: string, query: string, limit?: number, additionalPaths?: string[], sessionPaths?: string[]) =>
      invoke('agent:search-workspace-files', { rootPath, query, limit, additionalPaths, sessionPaths }),

    // ===== Agent 流式订阅（走 WS） =====
    // ws-client 传递 { sessionId, payload } 结构
    // stream-event 直接透传；其他事件需要解包 payload
    onAgentStreamEvent: (cb: (event: AgentStreamEvent) => void) =>
      wsClient.on('agent:stream-event', cb as (payload: unknown) => void),
    onAgentStreamComplete: (cb: (data: AgentStreamCompletePayload) => void) =>
      wsClient.on('agent:stream-complete', (msg: unknown) => {
        const { sessionId, payload } = msg as { sessionId: string; payload: Record<string, unknown> }
        cb({ sessionId, ...payload } as AgentStreamCompletePayload)
      }),
    onAgentStreamError: (cb: (data: { sessionId: string; error: string }) => void) =>
      wsClient.on('agent:stream-error', (msg: unknown) => {
        const { sessionId, payload } = msg as { sessionId: string; payload: Record<string, unknown> }
        cb({ sessionId, ...payload } as { sessionId: string; error: string })
      }),
    onAgentTitleUpdated: (cb: (data: { sessionId: string; title: string }) => void) =>
      wsClient.on('agent:title-updated', (msg: unknown) => {
        const { sessionId, payload } = msg as { sessionId: string; payload: Record<string, unknown> }
        cb({ sessionId, ...payload } as { sessionId: string; title: string })
      }),

    // ===== Agent 权限 / AskUser / ExitPlanMode 交互 =====
    respondPermission: (response: PermissionResponse) => invoke('agent:permission:respond', response),
    respondAskUser: (response: AskUserResponse) => invoke('agent:ask-user:respond', response),
    respondExitPlanMode: (response: ExitPlanModeResponse) => invoke('agent:exit-plan-mode:respond', response),
    getPendingRequests: () => invoke<PendingRequestsSnapshot>('agent:get-pending-requests'),

    // ===== Channel 域 =====
    listChannels: () => invoke('channel:list'),
    createChannel: (input: unknown) => invoke('channel:create', input),
    updateChannel: (id: string, input: ChannelUpdateInput) => invoke('channel:update', { id, ...input }),
    deleteChannel: (id: string) => invoke('channel:delete', { id }),
    testChannel: (channelId: string) => invoke('channel:test', { channelId }),
    fetchModels: (input: unknown) => invoke('channel:fetch-models', input),

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
    deleteMessage: (conversationId: string, messageId: string) => invoke('chat:delete-message', { conversationId, messageId }),
    truncateMessagesFrom: (conversationId: string, messageId: string, preserveFirstMessageAttachments?: boolean) =>
      invoke('chat:truncate-messages-from', { conversationId, messageId, preserveFirstMessageAttachments }),
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

    // ===== Chat 附件管理 =====
    saveAttachment: (input: AttachmentSaveInput) => invoke('chat:save-attachment', input),
    readAttachment: (localPath: string) => invoke('chat:read-attachment', { localPath }),
    deleteAttachment: (localPath: string) => invoke('chat:delete-attachment', { localPath }),
    extractAttachmentText: (localPath: string) => invoke('chat:extract-attachment-text', { localPath }),

    /**
     * 浏览器文件选择器（替代 Electron 文件对话框）
     *
     * 创建隐藏 <input type="file">，用户选择后读取为 base64，
     * 返回与 Electron 端一致的 FileDialogResult 格式。
     */
    openFileDialog: () => {
      return new Promise<FileDialogResult>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.style.display = 'none'
        // 接受图片、文档、文本等常见类型
        input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json,.csv,.xml,.html,.js,.ts,.py,.zip,.rtf,.odt,.odp,.ods'

        input.onchange = async () => {
          const fileList = Array.from(input.files ?? [])
          document.body.removeChild(input)

          if (fileList.length === 0) {
            resolve({ files: [] })
            return
          }

          const files: FileDialogResult['files'] = []
          const skippedFiles: FileDialogResult['skippedFiles'] = []
          // 10MB 以上走大文件路径（Web 端不做本地路径引用，直接读取）
          const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024

          for (const file of fileList) {
            try {
              if (file.size > LARGE_FILE_THRESHOLD) {
                skippedFiles.push({
                  filename: file.name,
                  mediaType: file.type,
                  size: file.size,
                  reason: 'unreadable',
                  message: `文件超过 ${LARGE_FILE_THRESHOLD / 1024 / 1024}MB 限制`,
                })
                continue
              }
              const buffer = await file.arrayBuffer()
              const base64 = btoa(
                new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
              )
              files.push({
                filename: file.name,
                mediaType: file.type || 'application/octet-stream',
                data: base64,
                size: file.size,
              })
            } catch {
              skippedFiles.push({
                filename: file.name,
                mediaType: file.type,
                size: file.size,
                reason: 'unreadable',
                message: '读取文件失败',
              })
            }
          }

          resolve({ files, skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined })
        }

        // 用户取消选择
        input.oncancel = () => {
          document.body.removeChild(input)
          resolve({ files: [] })
        }

        document.body.appendChild(input)
        input.click()
      })
    },

    // ===== Chat 辅助功能 =====
    toggleArchiveConversation: (id: string) => invoke('chat:toggle-archive', { id }),
    searchConversationMessages: (query: string) => invoke('chat:search-messages', { query }),
    getTutorialContent: () => invoke('chat:get-tutorial-content'),
    createWelcomeConversation: () => invoke('chat:create-welcome-conversation'),

    // ===== Agent 上下文挂载（会话级） =====
    attachDirectory: (input: AgentAttachDirectoryInput) => invoke('agent:attach-directory', input),
    detachDirectory: (input: AgentAttachDirectoryInput) => invoke('agent:detach-directory', input),
    attachFile: (input: AgentAttachFileInput) => invoke('agent:attach-file', input),
    detachFile: (input: AgentAttachFileInput) => invoke('agent:detach-file', input),

    // ===== Agent 上下文挂载（工作区级） =====
    attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => invoke('agent:attach-workspace-directory', input),
    detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => invoke('agent:detach-workspace-directory', input),
    attachWorkspaceFile: (input: WorkspaceAttachFileInput) => invoke('agent:attach-workspace-file', input),
    detachWorkspaceFile: (input: WorkspaceAttachFileInput) => invoke('agent:detach-workspace-file', input),
    getWorkspaceDirectories: (workspaceSlug: string) => invoke('agent:get-workspace-directories', { workspaceSlug }),
    getWorkspaceAttachedFiles: (workspaceSlug: string) => invoke('agent:get-workspace-attached-files', { workspaceSlug }),

    /**
     * Web 端文件夹选择（替代 Electron 文件夹对话框）
     *
     * 浏览器无法选择服务端目录，降级为 prompt 输入路径。
     */
    openFolderDialog: () => {
      const path = window.prompt('请输入服务端目录的绝对路径：')
      if (!path) return Promise.resolve(null)
      const name = path.split('/').filter(Boolean).pop() ?? path
      return Promise.resolve({ path, name })
    },

    // ===== Agent 会话高级操作 =====
    forkAgentSession: (input: ForkSessionInput) => invoke('agent:fork-session', input),
    rewindSession: (input: RewindSessionInput) => invoke('agent:rewind-session', input),
    searchAgentSessionMessages: (query: string) => invoke('agent:search-messages', { query }),
    queueAgentMessage: (input: AgentQueueMessageInput) => invoke('agent:queue-message', input),

    // ===== Agent 会话设置 =====
    updateSessionAgentRuntime: (sessionId: string, runtime: string) => invoke('agent:update-session-agent-runtime', { sessionId, runtime }),
    updateSessionCodexFastMode: (sessionId: string, enabled: boolean) => invoke('agent:update-session-codex-fast-mode', { sessionId, enabled }),
    updateSessionOpenAIThinkingLevel: (sessionId: string, thinkingLevel: string) => invoke('agent:update-session-openai-reasoning', { sessionId, thinkingLevel }),

    // ===== WS 推送事件订阅 =====
    onCapabilitiesChanged: (cb: () => void) =>
      wsClient.on('agent:capabilities-changed', cb as (payload: unknown) => void),
    onWorkspaceFilesChanged: (cb: () => void) =>
      wsClient.on('agent:workspace-files-changed', cb as (payload: unknown) => void),

    // ===== 迭代 5：Chat Tool 域 =====
    getAllTools: () => invoke('chat-tool:get-all-tools'),
    getChatTools: () => invoke('chat-tool:get-all-tools'),  // 别名（main.tsx 使用）
    getChatToolCredentials: (toolId: string) => invoke('chat-tool:get-credentials', { toolId }),
    updateChatToolState: (toolId: string, state: unknown) => invoke('chat-tool:update-state', { toolId, state }),
    updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) => invoke('chat-tool:update-credentials', { toolId, credentials }),
    testChatTool: (toolId: string) => invoke('chat-tool:test', { toolId }),
    createCustomTool: (meta: unknown) => invoke('chat-tool:create-custom', meta),
    deleteCustomChatTool: (toolId: string) => invoke('chat-tool:delete-custom', { toolId }),
    onCustomToolChanged: (cb: () => void) =>
      wsClient.on('chat-tool:custom-tool-changed', cb as (payload: unknown) => void),

    // ===== 迭代 5：Channel 扩展 =====
    decryptApiKey: (channelId: string) => invoke('channel:decrypt-key', { channelId }),
    testChannelDirect: (input: ChannelDirectTestInput) => invoke('channel:test-direct', input),
    getChannelPlanQuota: (channelId: string) => invoke('channel:get-plan-quota', { channelId }),
    codexOAuthLogin: async () => {
      const result = await invoke<CodexOAuthLoginResult & { authUrl?: string }>('channel:codex-oauth-login')
      // 如果返回了授权 URL，在新窗口打开
      if (result.success && result.authUrl) {
        window.open(result.authUrl, '_blank', 'width=600,height=700')
      }
      return result
    },
    codexOauthCancel: () => invoke('channel:codex-oauth-cancel'),
    onCodexOauthComplete: (cb: (result: CodexOAuthLoginResult) => void) =>
      wsClient.on('channel:codex-oauth-complete', cb as (payload: unknown) => void),

    // ===== 迭代 5：Agent 挂载文件操作 =====
    listAttachedDirectory: (dirPath: string, access?: FileAccessOptions) => invoke('agent:list-attached-directory', { dirPath, access }),
    readAttachedFile: (filePath: string, sessionId?: string, workspaceSlug?: string) => invoke('agent:read-attached-file', { filePath, sessionId, workspaceSlug }),
    renameAttachedFile: (filePath: string, newName: string, access?: FileAccessOptions) => invoke('agent:rename-attached-file', { filePath, newName, access }),
    moveAttachedFile: (filePath: string, targetDir: string, access?: FileAccessOptions) => invoke('agent:move-attached-file', { filePath, targetDir, access }),

    // ===== 迭代 5：Agent Worktree =====
    getWorktreeRepos: (workspaceSlug: string) => invoke('agent:get-worktree-repos', { workspaceSlug }),
    addWorktreeRepo: (workspaceSlug: string, repo: WorkspaceWorktreeRepo) => invoke('agent:add-worktree-repo', { workspaceSlug, repo }),
    removeWorktreeRepo: (workspaceSlug: string, repoPath: string) => invoke('agent:remove-worktree-repo', { workspaceSlug, repoPath }),

    // ===== 迭代 5：Agent 杂项 =====
    migrateChatToAgent: (conversationId: string, agentSessionId: string) => invoke('agent:migrate-chat-to-agent', { conversationId, agentSessionId }),
    // 键名须与 preload 契约一致（channel 字符串是 AGENT_IPC_CHANNELS.CLEAR_COMPLETION_STATE 的值）
    clearAgentCompletionState: (id: string) => invoke('agent:confirm-working-done', { id }),
    searchAgentSessionReferences: (input: AgentSessionReferenceSearchInput) => invoke('agent:search-session-references', input),
    moveAgentSessionToWorkspace: (input: MoveSessionToWorkspaceInput) => invoke('agent:move-session-to-workspace', input),
    saveFilesToAgentSession: (input: AgentSaveFilesInput) => invoke('agent:save-files-to-session', input),
    saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => invoke('agent:save-files-to-workspace', input),
    getTaskOutput: (input: unknown) => invoke('agent:get-task-output', input),
    stopTask: (input: unknown) => invoke('agent:stop-task', input),

    // ===== 迭代 6：Storage 管理 =====
    getStorageStats: () => invoke('storage:get-stats'),
    cleanupStorage: (options: unknown) => invoke('storage:cleanup', options),
    cleanupTempStorage: () => invoke('storage:cleanup-temp'),

    // ===== 迭代 6：Scratch-pad =====
    loadScratchPad: () => invoke<string>('scratch-pad:load'),
    saveScratchPad: (content: string) => invoke('scratch-pad:save', { content }),
    exportScratchPad: (markdown: string, _dirPath: string, filename: string) => {
      // Web 端无文件系统概念：忽略 dirPath，通过服务端生成文件 → 浏览器下载。
      // 下载走 blob 不经 invoke，需手动附加鉴权头（/api/* 路由强制鉴权）。
      const safeName = filename || 'scratch-pad.md'
      const token = getAccessToken()
      return fetch(`${config.apiBase}/scratch-pad:export`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ markdown, filename: safeName }),
      }).then(async (res) => {
        if (!res.ok) throw new Error('导出失败')
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = safeName
        a.click()
        URL.revokeObjectURL(url)
        return safeName
      })
    },

    // ===== 迭代 6：Proxy =====
    getProxySettings: () => invoke('proxy:get-settings'),
    updateProxySettings: (config: unknown) => invoke('proxy:update-settings', config),
    detectSystemProxy: () => invoke('proxy:detect-system'),

    // ===== 迭代 6：GitHub Release =====
    getLatestRelease: () => invoke('github-release:get-latest'),
    listReleases: (options?: unknown) => invoke('github-release:list', options),
    getReleaseByTag: (tag: string) => invoke('github-release:get-by-tag', { tag }),

    // ===== 迭代 6：Automation =====
    listAutomations: () => invoke('automation:list'),
    createAutomation: (input: unknown) => invoke('automation:create', input),
    updateAutomation: (input: unknown) => invoke('automation:update', input),
    deleteAutomation: (id: string) => invoke('automation:delete', { id }),
    toggleAutomation: (id: string, active: boolean) => invoke('automation:toggle', { id, active }),
    runAutomationNow: (id: string) => invoke('automation:run-now', { id }),
    onAutomationChanged: (cb: () => void) =>
      wsClient.on('automation:changed', cb as (payload: unknown) => void),

    // ===== 迭代 6：Settings 主题事件（浏览器端实现，不走服务端） =====
    onSystemThemeChanged: (cb: (isDark: boolean) => void) => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => cb(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    },
    onThemeSettingsChanged: (cb: (payload: { themeMode: string; themeStyle: string; interfaceVariant?: string }) => void) => {
      const bc = new BroadcastChannel('proma-theme')
      bc.onmessage = (e) => cb(e.data as { themeMode: string; themeStyle: string; interfaceVariant?: string })
      return () => bc.close()
    },

    // ===== M3 迭代 7：账号与用户管理（Web 专属，Electron 端不实现） =====
    getAuthUser: () => Promise.resolve(getStoredUser()),
    changePassword: (input: ChangePasswordInput) => invoke<{ ok: boolean }>('auth:change-password', input),
    listUsers: () => invoke<AuthUser[]>('user:list'),
    resetUserPassword: (input: ResetUserPasswordInput) => invoke<{ ok: boolean }>('user:reset-password', input),
    // 退出登录：清空本地 token 与用户信息（JWT 无状态，服务端无需吊销）；
    // 跳转登录页由调用方完成（window.location.href = '/login'）
    logout: () => {
      clearTokens()
      return Promise.resolve({ ok: true })
    },
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
  'updateAgentSessionTitle',
  'updateAgentSessionModel',
  'togglePinAgentSession',
  'toggleArchiveAgentSession',
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
  'fetchModels',
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
  'deleteMessage',
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
  // Chat 附件管理
  'saveAttachment',
  'readAttachment',
  'deleteAttachment',
  'extractAttachmentText',
  'openFileDialog',
  // Chat 辅助功能
  'toggleArchiveConversation',
  'searchConversationMessages',
  'getTutorialContent',
  'createWelcomeConversation',
  // Agent 上下文挂载（会话级）
  'attachDirectory',
  'detachDirectory',
  'attachFile',
  'detachFile',
  // Agent 上下文挂载（工作区级）
  'attachWorkspaceDirectory',
  'detachWorkspaceDirectory',
  'attachWorkspaceFile',
  'detachWorkspaceFile',
  'getWorkspaceDirectories',
  'getWorkspaceAttachedFiles',
  'openFolderDialog',
  // Agent 会话高级操作
  'forkAgentSession',
  'rewindSession',
  'searchAgentSessionMessages',
  'queueAgentMessage',
  // Agent 会话设置
  'updateSessionAgentRuntime',
  'updateSessionCodexFastMode',
  'updateSessionOpenAIThinkingLevel',
  // WS 推送事件订阅
  'onCapabilitiesChanged',
  'onWorkspaceFilesChanged',
  // 迭代 5：Chat Tool 域
  'getAllTools',
  'getChatToolCredentials',
  'updateChatToolState',
  'updateChatToolCredentials',
  'testChatTool',
  'createCustomTool',
  'deleteCustomChatTool',
  'onCustomToolChanged',
  // 迭代 5：Channel 扩展
  'decryptApiKey',
  'testChannelDirect',
  'getChannelPlanQuota',
  'codexOAuthLogin',
  'codexOauthCancel',
  'onCodexOauthComplete',
  // 迭代 5：Agent 挂载文件操作
  'listAttachedDirectory',
  'readAttachedFile',
  'renameAttachedFile',
  'moveAttachedFile',
  // 迭代 5：Agent Worktree
  'getWorktreeRepos',
  'addWorktreeRepo',
  'removeWorktreeRepo',
  // 迭代 5：Agent 杂项
  'migrateChatToAgent',
  'clearAgentCompletionState',
  'searchAgentSessionReferences',
  'moveAgentSessionToWorkspace',
  'saveFilesToAgentSession',
  'saveFilesToWorkspaceFiles',
  'getTaskOutput',
  'stopTask',
  // 迭代 6：Storage 管理
  'getStorageStats',
  'cleanupStorage',
  'cleanupTempStorage',
  // 迭代 6：Scratch-pad
  'loadScratchPad',
  'saveScratchPad',
  'exportScratchPad',
  // 迭代 6：Proxy
  'getProxySettings',
  'updateProxySettings',
  'detectSystemProxy',
  // 迭代 6：GitHub Release
  'getLatestRelease',
  'listReleases',
  'getReleaseByTag',
  // 迭代 6：Automation
  'listAutomations',
  'createAutomation',
  'updateAutomation',
  'deleteAutomation',
  'toggleAutomation',
  'runAutomationNow',
  'onAutomationChanged',
  // 迭代 6：Settings 主题事件
  'onSystemThemeChanged',
  'onThemeSettingsChanged',
  // M3 迭代 7：账号与用户管理
  'getAuthUser',
  'changePassword',
  'listUsers',
  'resetUserPassword',
  'logout',
])
