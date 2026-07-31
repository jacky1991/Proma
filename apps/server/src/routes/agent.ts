/**
 * Agent 域 HTTP 路由
 *
 * 将 Electron IPC handler 映射为 Hono 路由。
 * M2 阶段：P0 路由（会话 CRUD / 消息发送 / 工作区）。
 */

import { Hono } from 'hono'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { AgentSendInput, AgentGenerateTitleInput, AgentMessage, PermissionResponse, AskUserResponse, ExitPlanModeResponse, PendingRequestsSnapshot, PromaPermissionMode, WorkspaceMcpConfig, McpServerEntry, FileEntry, AgentAttachDirectoryInput, AgentAttachFileInput, WorkspaceAttachDirectoryInput, WorkspaceAttachFileInput, ForkSessionInput, RewindSessionInput, AgentQueueMessageInput, AgentThinkingLevel, AgentSaveFilesInput, AgentSaveWorkspaceFilesInput, AgentSavedFile, AgentSessionReferenceSearchInput, MoveSessionToWorkspaceInput, WorkspaceWorktreeRepo, GetTaskOutputInput, GetTaskOutputResult, StopTaskInput, FileAccessOptions } from '@proma/shared'
import { isPromaPermissionMode } from '@proma/shared'
import { existsSync, readdirSync, statSync, rmSync, renameSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, join, dirname, basename, sep } from 'node:path'
import {
  listAgentSessions,
  createAgentSession,
  deleteAgentSession,
  getAgentSessionSDKMessages,
  updateAgentSessionMeta,
  getAgentSessionMeta,
  forkAgentSession,
  searchAgentSessionMessages,
  migrateChatToAgentSession,
  moveSessionToWorkspace,
  searchAgentSessionReferences,
} from '@proma/server-core/agent-session-manager'
import {
  listAgentWorkspaces,
  createAgentWorkspace,
  updateAgentWorkspace,
  deleteAgentWorkspace,
  getWorkspaceCapabilities,
  getAgentWorkspace,
  reorderAgentWorkspaces,
  getWorkspaceMcpConfig,
  saveWorkspaceMcpConfig,
  getAllWorkspaceSkills,
  deleteWorkspaceSkill,
  toggleWorkspaceSkill,
  getDefaultSkillSlugs,
  getSkillsGroupConfig,
  createSkillGroup,
  renameSkillGroup,
  deleteSkillGroup,
  setSkillAssignment,
  uploadSkillsFromZip,
  readWorkspaceSkillContent,
  writeWorkspaceSkillContent,
  listSkillFiles,
  readSkillFile,
  writeSkillFile,
  createSkillEntry,
  deleteSkillEntry,
  renameSkillEntry,
  getWorkspaceMemorySummary,
  readWorkspaceClaudeMd,
  writeWorkspaceClaudeMd,
  listWorkspaceAutoMemoryFiles,
  readWorkspaceAutoMemoryFile,
  writeWorkspaceAutoMemoryFile,
  getWorkspaceAttachedDirectories,
  getWorkspaceAttachedFiles,
  attachWorkspaceDirectory,
  detachWorkspaceDirectory,
  attachWorkspaceFile,
  detachWorkspaceFile,
  getWorktreeRepos,
  addWorktreeRepo,
  removeWorktreeRepo,
} from '@proma/server-core/agent-workspace-manager'
import { setBuiltinMcpUserEnabled } from '@proma/server-core/builtin-mcp/settings'
import { getWorkspaceSkillsDir, getUserCustomSkillsDir, getAgentWorkspacesDir, getAgentSessionWorkspacePath, getWorkspaceFilesDir, getDataRoot, getUserSessionWorkspacesDir } from '@proma/server-core/config-paths'
import type { UserScope } from '@proma/server-core/config-paths'
import { getUserScope } from '../utils/user-scope'
import { adminOnly } from '../middleware/role.ts'
import { validateMcpServer } from '@proma/server-core/mcp-validator'
import { permissionService } from '@proma/server-core/agent-permission-service'
import { askUserService } from '@proma/server-core/agent-ask-user-service'
import { exitPlanService } from '@proma/server-core/agent-exit-plan-service'
import { orchestrator, streamSink } from '../engine'
import { createLogger } from '@proma/server-core/logger'

/** 模块日志器 */
const logger = createLogger('Agent 路由')

const agent = new Hono()

// ===== 会话 CRUD =====

/** POST /api/agent:list-sessions → AgentSessionMeta[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_SESSIONS}`, (c) => {
  const scope = getUserScope(c)
  return c.json(listAgentSessions(scope))
})

/** POST /api/agent:create-session → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.CREATE_SESSION}`, async (c) => {
  const scope = getUserScope(c)
  const { title, channelId, workspaceId, modelId } = await c.req.json()
  const session = createAgentSession(title, channelId, workspaceId, modelId, undefined, scope)
  return c.json(session)
})

/** POST /api/agent:delete-session → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_SESSION}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json()
  deleteAgentSession(id, scope)
  return c.json({ ok: true })
})

/** POST /api/agent:get-sdk-messages → SDKMessage[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SDK_MESSAGES}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json()
  return c.json(getAgentSessionSDKMessages(id, scope))
})

/** POST /api/agent:update-title → AgentSessionMeta（与 chat:update-title 契约对齐） */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_TITLE}`, async (c) => {
  const scope = getUserScope(c)
  const { sessionId, title } = await c.req.json()
  const updated = updateAgentSessionMeta(sessionId, { title }, scope)
  return c.json(updated)
})

/** POST /api/agent:update-session-model → AgentSessionMeta（与 preload 契约一致） */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SESSION_MODEL}`, async (c) => {
  const scope = getUserScope(c)
  const { sessionId, channelId, modelId } = await c.req.json()
  const updated = updateAgentSessionMeta(sessionId, { channelId, modelId }, scope)
  return c.json(updated)
})

/** POST /api/agent:toggle-pin → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.TOGGLE_PIN}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json()
  const meta = getAgentSessionMeta(id, scope)
  if (!meta) return c.json({ error: 'Session not found' }, 404)
  const updated = updateAgentSessionMeta(id, { pinned: !meta.pinned }, scope)
  return c.json(updated)
})

/** POST /api/agent:toggle-archive → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json()
  const meta = getAgentSessionMeta(id, scope)
  if (!meta) return c.json({ error: 'Session not found' }, 404)
  const updated = updateAgentSessionMeta(id, { archived: !meta.archived }, scope)
  return c.json(updated)
})

/** POST /api/agent:update-session-permission-mode → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE}`, async (c) => {
  const scope = getUserScope(c)
  const { sessionId, mode } = await c.req.json()
  updateAgentSessionMeta(sessionId, { permissionMode: mode }, scope)
  return c.json({ ok: true })
})

// ===== 消息发送 & 控制 =====

/** POST /api/agent:send-message → { ok: true }（流式事件经 WS 推送） */
agent.post(`/${AGENT_IPC_CHANNELS.SEND_MESSAGE}`, async (c) => {
  const input = await c.req.json<AgentSendInput>()
  const sessionId = input.sessionId
  const scope = getUserScope(c)

  // 构建 SessionCallbacks：将事件转发到 StreamSink（WS 推送）
  // 控制信号携带会话归属（scope.userId）：前端仅订阅 '*'，WS 层据此让归属用户收到事件
  const callbacks = {
    onError: (error: string) => {
      streamSink.emit(sessionId, { type: 'stream-error', error }, undefined, scope.userId)
    },
    onComplete: (messages?: AgentMessage[], opts?: { stoppedByUser?: boolean }) => {
      streamSink.emit(sessionId, { type: 'stream-complete', messages, ...opts }, undefined, scope.userId)
    },
    onTitleUpdated: (title: string) => {
      streamSink.emit(sessionId, { type: 'title-updated', title }, undefined, scope.userId)
    },
    onRunStarted: (opts: { startedAt: number }) => {
      streamSink.emit(sessionId, { type: 'run-started', ...opts }, undefined, scope.userId)
    },
  }

  // 异步执行，不等待完成（流式事件经 WS 推送）
  orchestrator.sendMessage(input, callbacks, scope).catch((err: unknown) => {
    logger.error('sendMessage 失败', { error: err })
  })
  return c.json({ ok: true })
})

/** POST /api/agent:stop → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.STOP_AGENT}`, async (c) => {
  const { sessionId } = await c.req.json()
  orchestrator.stop(sessionId)
  return c.json({ ok: true })
})

/** POST /api/agent:generate-title → string | null（与 preload 契约一致） */
agent.post(`/${AGENT_IPC_CHANNELS.GENERATE_TITLE}`, async (c) => {
  const input = await c.req.json<AgentGenerateTitleInput>()
  const title = await orchestrator.generateTitle(input)
  return c.json(title ?? null)
})

// ===== 工作区管理 =====

/** POST /api/agent:list-workspaces → AgentWorkspace[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_WORKSPACES}`, (c) => {
  return c.json(listAgentWorkspaces())
})

/** POST /api/agent:create-workspace → AgentWorkspace（仅管理员：全局共享资源写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.CREATE_WORKSPACE}`, adminOnly, async (c) => {
  const input = await c.req.json()
  const workspace = createAgentWorkspace(input)
  return c.json(workspace)
})

/** POST /api/agent:update-workspace → AgentWorkspace（仅管理员：全局共享资源写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_WORKSPACE}`, adminOnly, async (c) => {
  const { id, ...updates } = await c.req.json()
  const workspace = updateAgentWorkspace(id, updates)
  return c.json(workspace)
})

/** POST /api/agent:delete-workspace → { ok: true }（仅管理员：全局共享资源写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_WORKSPACE}`, adminOnly, async (c) => {
  const { id } = await c.req.json()
  deleteAgentWorkspace(id)
  return c.json({ ok: true })
})

/** POST /api/agent:reorder-workspaces → AgentWorkspace[]（仅管理员：全局共享资源写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.REORDER_WORKSPACES}`, adminOnly, async (c) => {
  const { orderedIds } = await c.req.json()
  return c.json(reorderAgentWorkspaces(orderedIds))
})

/** POST /api/agent:get-capabilities → WorkspaceCapabilities */
agent.post(`/${AGENT_IPC_CHANNELS.GET_CAPABILITIES}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getWorkspaceCapabilities(workspaceSlug, getUserScope(c)))
})

// ===== 权限 / AskUser / ExitPlanMode 双向交互 =====

/** POST /api/agent:permission:respond → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.PERMISSION_RESPOND}`, async (c) => {
  const response = await c.req.json<PermissionResponse>()
  const { requestId, behavior, alwaysAllow } = response
  const sessionId = permissionService.respondToPermission(requestId, behavior, alwaysAllow)

  // 发送 permission_resolved 事件到 WS（归属按会话所有者，管理员代答时所有者仍能收到）
  if (sessionId) {
    streamSink.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'permission_resolved', requestId, behavior },
    }, undefined, orchestrator.getSessionOwner(sessionId))
  }
  return c.json({ ok: true })
})

/** POST /api/agent:ask-user:respond → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.ASK_USER_RESPOND}`, async (c) => {
  const response = await c.req.json<AskUserResponse>()
  const { requestId, answers } = response
  const sessionId = askUserService.respondToAskUser(requestId, answers)

  if (sessionId) {
    streamSink.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'ask_user_resolved', requestId },
    }, undefined, orchestrator.getSessionOwner(sessionId))
  }
  return c.json({ ok: true })
})

/** POST /api/agent:exit-plan-mode:respond → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND}`, async (c) => {
  const scope = getUserScope(c)
  const response = await c.req.json<ExitPlanModeResponse>()
  const result = exitPlanService.respondToExitPlanMode(response)

  if (result) {
    const { sessionId, targetMode } = result
    // 事件归属按会话所有者（管理员代答时所有者仍能收到）
    const ownerUserId = orchestrator.getSessionOwner(sessionId)

    // 通知渲染进程请求已处理
    streamSink.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'exit_plan_mode_resolved', requestId: response.requestId },
    }, undefined, ownerUserId)

    // 如果用户选择了新的权限模式，持久化并通知 UI
    if (targetMode) {
      const meta = getAgentSessionMeta(sessionId, scope)
      if (meta) {
        try {
          updateAgentSessionMeta(sessionId, { permissionMode: targetMode }, scope)
        } catch (err) {
          logger.warn('ExitPlanMode 持久化权限模式失败', { sessionId, error: err })
        }
      }
      streamSink.emit(sessionId, {
        kind: 'proma_event',
        event: { type: 'permission_mode_changed', mode: targetMode },
      }, undefined, ownerUserId)
    }
  }
  return c.json({ ok: true })
})

/** POST /api/agent:get-pending-requests → PendingRequestsSnapshot */
agent.post(`/${AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS}`, (c) => {
  const snapshot: PendingRequestsSnapshot = {
    permissions: permissionService.getPendingRequests(),
    askUsers: askUserService.getPendingRequests(),
    exitPlans: exitPlanService.getPendingRequests(),
  }
  return c.json(snapshot)
})

// ===== MCP 配置 =====

/** POST /api/agent:get-mcp-config → WorkspaceMcpConfig（仅管理员：含命令/参数/env 等敏感配置） */
agent.post(`/${AGENT_IPC_CHANNELS.GET_MCP_CONFIG}`, adminOnly, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getWorkspaceMcpConfig(workspaceSlug))
})

/** POST /api/agent:save-mcp-config → { ok: true }（仅管理员：全局共享资源写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG}`, adminOnly, async (c) => {
  const { workspaceSlug, config } = await c.req.json()
  saveWorkspaceMcpConfig(workspaceSlug, config as WorkspaceMcpConfig)
  return c.json({ ok: true })
})

/**
 * POST /api/agent:test-mcp-server → { success, message }（仅管理员）
 *
 * 非持久写，但会向用户指定地址 / 命令发起连接，同档门控以收敛 SSRF / 任意命令探测面。
 */
agent.post(`/${AGENT_IPC_CHANNELS.TEST_MCP_SERVER}`, adminOnly, async (c) => {
  const { name, entry } = await c.req.json()
  const result = await validateMcpServer(name, entry as McpServerEntry)
  return c.json({
    success: result.valid,
    message: result.valid ? '连接成功' : (result.reason || '连接失败'),
  })
})

/** POST /api/agent:set-builtin-mcp-enabled → WorkspaceCapabilities（仅管理员：全局共享资源写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.SET_BUILTIN_MCP_ENABLED}`, adminOnly, async (c) => {
  const { workspaceSlug, id, enabled } = await c.req.json()
  setBuiltinMcpUserEnabled(id, enabled)
  return c.json(getWorkspaceCapabilities(workspaceSlug))
})

// ===== Skills 管理 =====

/** POST /api/agent:get-skills → SkillMeta[]（含启用+禁用，按用户隔离） */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SKILLS}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getAllWorkspaceSkills(workspaceSlug, getUserScope(c)))
})

/** POST /api/agent:get-skills-dir → string（用户自建技能目录） */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SKILLS_DIR}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getUserCustomSkillsDir(workspaceSlug, getUserScope(c)))
})

/** POST /api/agent:delete-skill → { ok: true }（用户可删除自己的自建技能；内置由 service 拦截） */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_SKILL}`, async (c) => {
  const { workspaceSlug, skillSlug } = await c.req.json()
  deleteWorkspaceSkill(workspaceSlug, skillSlug, getUserScope(c))
  return c.json({ ok: true })
})

/** POST /api/agent:toggle-skill → { ok: true }（用户个人启停，黑名单 per-user） */
agent.post(`/${AGENT_IPC_CHANNELS.TOGGLE_SKILL}`, async (c) => {
  const { workspaceSlug, skillSlug, enabled } = await c.req.json()
  toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled, getUserScope(c))
  return c.json({ ok: true })
})

/** POST /api/agent:get-default-skill-slugs → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_DEFAULT_SKILL_SLUGS}`, (c) => {
  return c.json(getDefaultSkillSlugs())
})

// ===== 用户技能分组（per-user，非管理员专属）=====

/** POST /api/agent:get-skill-groups → SkillsGroupConfig */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SKILL_GROUPS}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getSkillsGroupConfig(workspaceSlug, getUserScope(c)))
})

/** POST /api/agent:create-skill-group → SkillGroupDef */
agent.post(`/${AGENT_IPC_CHANNELS.CREATE_SKILL_GROUP}`, async (c) => {
  const { workspaceSlug, name } = await c.req.json()
  return c.json(createSkillGroup(workspaceSlug, name, getUserScope(c)))
})

/** POST /api/agent:rename-skill-group → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.RENAME_SKILL_GROUP}`, async (c) => {
  const { workspaceSlug, groupId, name } = await c.req.json()
  renameSkillGroup(workspaceSlug, groupId, name, getUserScope(c))
  return c.json({ ok: true })
})

/** POST /api/agent:delete-skill-group → { ok: true }（组内技能归"未分组"） */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_SKILL_GROUP}`, async (c) => {
  const { workspaceSlug, groupId } = await c.req.json()
  deleteSkillGroup(workspaceSlug, groupId, getUserScope(c))
  return c.json({ ok: true })
})

/** POST /api/agent:set-skill-assignment → { ok: true }（groupId=null 移到未分组） */
agent.post(`/${AGENT_IPC_CHANNELS.SET_SKILL_ASSIGNMENT}`, async (c) => {
  const { workspaceSlug, skillSlug, groupId } = await c.req.json()
  setSkillAssignment(workspaceSlug, skillSlug, groupId ?? null, getUserScope(c))
  return c.json({ ok: true })
})

// ===== 用户技能 zip 上传 =====

/** POST /api/agent:upload-skill → { skills: SkillMeta[] }（multipart/form-data） */
agent.post(`/${AGENT_IPC_CHANNELS.UPLOAD_SKILL}`, async (c) => {
  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: '需要 multipart/form-data 格式' }, 400)
  }
  let body: Record<string, string | File>
  try {
    body = await c.req.parseBody()
  } catch {
    return c.json({ error: '解析请求体失败' }, 400)
  }
  const file = body.file
  const workspaceSlug = body.workspaceSlug as string | undefined
  if (!workspaceSlug) return c.json({ error: '缺少 workspaceSlug' }, 400)
  if (!file || !(file instanceof File)) return c.json({ error: '缺少 file 字段' }, 400)
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return c.json({ error: '仅支持 .zip 包' }, 400)
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const fallbackSlug = file.name.replace(/\.zip$/i, '')
  const skills = uploadSkillsFromZip(workspaceSlug, buffer, fallbackSlug, getUserScope(c))
  return c.json({ skills })
})

/** POST /api/agent:read-skill-content → string */
agent.post(`/${AGENT_IPC_CHANNELS.READ_SKILL_CONTENT}`, async (c) => {
  const { workspaceSlug, skillSlug } = await c.req.json()
  return c.json(readWorkspaceSkillContent(workspaceSlug, skillSlug, getUserScope(c)))
})

/** POST /api/agent:write-skill-content → { ok: true }（用户可编辑自建技能；内置由 service 拦截） */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_SKILL_CONTENT}`, async (c) => {
  const { workspaceSlug, skillSlug, content } = await c.req.json()
  writeWorkspaceSkillContent(workspaceSlug, skillSlug, content, getUserScope(c))
  return c.json({ ok: true })
})

// ===== Skill 子文件管理 =====

/** POST /api/agent:list-skill-files → SkillFileNode[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_SKILL_FILES}`, async (c) => {
  const { workspaceSlug, skillSlug } = await c.req.json()
  return c.json(listSkillFiles(workspaceSlug, skillSlug, getUserScope(c)))
})

/** POST /api/agent:read-skill-file → SkillFileContent */
agent.post(`/${AGENT_IPC_CHANNELS.READ_SKILL_FILE}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath } = await c.req.json()
  return c.json(readSkillFile(workspaceSlug, skillSlug, relativePath, getUserScope(c)))
})

/** POST /api/agent:write-skill-file → { ok: true }（用户可编辑自建技能文件；内置由 service 拦截） */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_SKILL_FILE}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath, content } = await c.req.json()
  writeSkillFile(workspaceSlug, skillSlug, relativePath, content, getUserScope(c))
  return c.json({ ok: true })
})

/** POST /api/agent:create-skill-entry → { ok: true }（用户可在自建技能下创建子项） */
agent.post(`/${AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath, type } = await c.req.json()
  createSkillEntry(workspaceSlug, skillSlug, relativePath, type, getUserScope(c))
  return c.json({ ok: true })
})

/** POST /api/agent:delete-skill-entry → { ok: true }（用户可删除自建技能子项） */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath } = await c.req.json()
  deleteSkillEntry(workspaceSlug, skillSlug, relativePath, getUserScope(c))
  return c.json({ ok: true })
})

/** POST /api/agent:rename-skill-entry → { ok: true }（用户可重命名自建技能子项） */
agent.post(`/${AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY}`, async (c) => {
  const { workspaceSlug, skillSlug, fromRelative, toRelative } = await c.req.json()
  renameSkillEntry(workspaceSlug, skillSlug, fromRelative, toRelative, getUserScope(c))
  return c.json({ ok: true })
})

// ===== 工作区记忆文件 =====

/** POST /api/agent:get-workspace-memory-summary → WorkspaceMemorySummary（auto memory 按用户隔离） */
agent.post(`/${AGENT_IPC_CHANNELS.GET_WORKSPACE_MEMORY_SUMMARY}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getWorkspaceMemorySummary(workspaceSlug, getUserScope(c)))
})

/** POST /api/agent:read-workspace-claude-md → SkillFileContent（仅管理员：CLAUDE.md 为团队共享项目指令） */
agent.post(`/${AGENT_IPC_CHANNELS.READ_WORKSPACE_CLAUDE_MD}`, adminOnly, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(readWorkspaceClaudeMd(workspaceSlug))
})

/** POST /api/agent:write-workspace-claude-md → { ok: true }（仅管理员：全局共享项目指令） */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_WORKSPACE_CLAUDE_MD}`, adminOnly, async (c) => {
  const { workspaceSlug, content } = await c.req.json()
  writeWorkspaceClaudeMd(workspaceSlug, content)
  return c.json({ ok: true })
})

/** POST /api/agent:list-workspace-auto-memory-files → SkillFileNode[]（按用户隔离） */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_WORKSPACE_AUTO_MEMORY_FILES}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(listWorkspaceAutoMemoryFiles(workspaceSlug, getUserScope(c)))
})

/** POST /api/agent:read-workspace-auto-memory-file → SkillFileContent（按用户隔离） */
agent.post(`/${AGENT_IPC_CHANNELS.READ_WORKSPACE_AUTO_MEMORY_FILE}`, async (c) => {
  const { workspaceSlug, relativePath } = await c.req.json()
  return c.json(readWorkspaceAutoMemoryFile(workspaceSlug, relativePath, getUserScope(c)))
})

/** POST /api/agent:write-workspace-auto-memory-file → { ok: true }（用户可读写自己的个人记忆） */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AUTO_MEMORY_FILE}`, async (c) => {
  const { workspaceSlug, relativePath, content } = await c.req.json()
  writeWorkspaceAutoMemoryFile(workspaceSlug, relativePath, content, getUserScope(c))
  return c.json({ ok: true })
})

// ===== 文件系统操作 =====

const HIDDEN_FS_ENTRIES = new Set(['.DS_Store', 'Thumbs.db'])

/** 安全校验：路径必须在全局工作区或用户级会话工作区目录下 */
function assertWorkspacePath(safePath: string, scope?: UserScope): void {
  const globalRoot = resolve(getAgentWorkspacesDir())
  if (safePath.startsWith(globalRoot)) return
  // 用户级会话工作区（Web 多用户隔离）
  if (scope) {
    const userRoot = resolve(getUserSessionWorkspacesDir(scope))
    if (safePath.startsWith(userRoot)) return
  }
  throw new Error('访问路径超出 Agent 工作区范围')
}

/** POST /api/agent:get-session-path → string | null */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SESSION_PATH}`, async (c) => {
  const { workspaceId, sessionId } = await c.req.json()
  const ws = getAgentWorkspace(workspaceId)
  if (!ws) return c.json(null)
  return c.json(getAgentSessionWorkspacePath(ws.slug, sessionId, getUserScope(c)))
})

/** POST /api/agent:list-directory → FileEntry[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_DIRECTORY}`, async (c) => {
  const { dirPath } = await c.req.json()
  const safePath = resolve(dirPath)
  assertWorkspacePath(safePath, getUserScope(c))

  if (!existsSync(safePath)) return c.json([])

  const entries: FileEntry[] = []
  const items = readdirSync(safePath, { withFileTypes: true })
  for (const item of items) {
    if (HIDDEN_FS_ENTRIES.has(item.name)) continue
    const fullPath = resolve(safePath, item.name)
    const isDirectory = item.isDirectory()
    const size = isDirectory ? undefined : statSync(fullPath).size
    entries.push({ name: item.name, path: fullPath, isDirectory, size })
  }

  // 目录在前，文件在后；隐藏文件排在同类末尾
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const aHidden = a.name.startsWith('.')
    const bHidden = b.name.startsWith('.')
    if (aHidden !== bHidden) return aHidden ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return c.json(entries)
})

/** POST /api/agent:delete-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_FILE}`, async (c) => {
  const { filePath } = await c.req.json()
  const safePath = resolve(filePath)
  assertWorkspacePath(safePath, getUserScope(c))
  rmSync(safePath, { recursive: true, force: true })
  return c.json({ ok: true })
})

/** POST /api/agent:rename-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.RENAME_FILE}`, async (c) => {
  const { filePath, newName } = await c.req.json()
  const safePath = resolve(filePath)
  assertWorkspacePath(safePath, getUserScope(c))
  const dir = safePath.substring(0, safePath.lastIndexOf('/'))
  const newPath = join(dir, newName)
  renameSync(safePath, newPath)
  return c.json({ ok: true })
})

/** POST /api/agent:move-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.MOVE_FILE}`, async (c) => {
  const { filePath, targetDir } = await c.req.json()
  const safePath = resolve(filePath)
  const safeTarget = resolve(targetDir)
  assertWorkspacePath(safePath, getUserScope(c))
  assertWorkspacePath(safeTarget, getUserScope(c))
  const fileName = safePath.substring(safePath.lastIndexOf('/') + 1)
  renameSync(safePath, join(safeTarget, fileName))
  return c.json({ ok: true })
})

/** POST /api/agent:get-workspace-files-path → string */
agent.post(`/${AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(join(getAgentWorkspacesDir(), workspaceSlug, 'workspace-files'))
})

/** POST /api/agent:check-paths-type → { type: 'file' | 'directory' | 'unknown' }[] */
agent.post(`/${AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE}`, async (c) => {
  const { paths } = await c.req.json<{ paths: string[] }>()
  const results = paths.map((p) => {
    try {
      const s = statSync(resolve(p))
      return { type: s.isDirectory() ? 'directory' : 'file' }
    } catch {
      return { type: 'unknown' }
    }
  })
  return c.json(results)
})

/** POST /api/agent:search-workspace-files → FileSearchResult */
agent.post(`/${AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES}`, async (c) => {
  const { rootPath, query, limit = 20, additionalPaths, sessionPaths } = await c.req.json<{
    rootPath: string; query: string; limit?: number; additionalPaths?: string[]; sessionPaths?: string[]
  }>()
  const safeRoot = resolve(rootPath)
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache'])
  const ignoreFiles = new Set(['.DS_Store', '.Spotlight-V100', '.Trashes', 'Thumbs.db', 'desktop.ini'])
  const BROWSE_LIMIT_PER_GROUP = 2000
  const BROWSE_TOTAL_CAP = 3000

  // 按来源分组收集文件（对齐 Electron ipc.ts 实现）
  type Entry = { name: string; path: string; type: 'file' | 'dir'; source: 'session' | 'workspace' }
  const rootEntries: Entry[] = []
  const workspaceEntries: Entry[] = []

  function scan(
    dir: string, depth: number, baseRoot: string,
    target: Entry[], useAbsPath: boolean, source: 'session' | 'workspace',
  ): void {
    if (depth > 10) return
    try {
      const items = readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        if (ignoreFiles.has(item.name)) continue
        if (item.isDirectory() && ignoreDirs.has(item.name)) continue
        const fullPath = resolve(dir, item.name)
        target.push({
          name: item.name,
          path: useAbsPath ? fullPath : relative(baseRoot, fullPath),
          type: item.isDirectory() ? 'dir' : 'file',
          source,
        })
        if (item.isDirectory()) scan(fullPath, depth + 1, baseRoot, target, useAbsPath, source)
      }
    } catch { /* 忽略无权限目录 */ }
  }

  function addAttachedPath(pathValue: string, target: Entry[], source: 'session' | 'workspace'): void {
    try {
      const attachedPath = resolve(pathValue)
      const name = basename(attachedPath)
      if (ignoreFiles.has(name)) return
      const stats = statSync(attachedPath)
      if (stats.isFile()) {
        target.push({ name, path: attachedPath, type: 'file', source })
        return
      }
      if (!stats.isDirectory()) return
      if (ignoreDirs.has(name)) return
      target.push({
        name: name === 'workspace-files' ? '工作文件' : name,
        path: attachedPath, type: 'dir', source,
      })
      scan(attachedPath, 0, attachedPath, target, true, source)
    } catch { /* 忽略不存在或无权限的附加路径 */ }
  }

  // session 目录：相对路径
  scan(safeRoot, 0, safeRoot, rootEntries, false, 'session')

  // 会话级附加路径：绝对路径
  if (sessionPaths && sessionPaths.length > 0) {
    for (const sp of sessionPaths) addAttachedPath(sp, rootEntries, 'session')
  }

  // 工作区文件 + 工作区级附加路径：绝对路径
  if (additionalPaths && additionalPaths.length > 0) {
    for (const addPath of additionalPaths) addAttachedPath(addPath, workspaceEntries, 'workspace')
  }

  // 排序：目录优先、前缀匹配优先、路径短优先
  function sortGroup(entries: Entry[], q: string): void {
    entries.sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bStartsWith = b.name.toLowerCase().startsWith(q) ? 0 : 1
      if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      return a.path.length - b.path.length
    })
  }

  function matchEntries(entries: Entry[], q: string): Entry[] {
    return entries.filter((entry) => {
      const nameLower = entry.name.toLowerCase()
      const pathLower = entry.path.toLowerCase()
      if (nameLower.startsWith(q)) return true
      if (nameLower.includes(q) || pathLower.includes(q)) return true
      // 模糊子序列匹配
      let qi = 0
      for (let i = 0; i < nameLower.length && qi < q.length; i++) {
        if (nameLower[i] === q[qi]) qi++
      }
      return qi === q.length
    })
  }

  function sortDirsFirst(entries: Entry[]): void {
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      return a.path.length - b.path.length || a.name.localeCompare(b.name)
    })
  }

  const q = query.toLowerCase()

  if (!q) {
    // 空 query：目录优先排序后截断
    sortDirsFirst(rootEntries)
    sortDirsFirst(workspaceEntries)
    const maxPerGroup = Math.max(limit, BROWSE_LIMIT_PER_GROUP)
    const sessionSlice = rootEntries.slice(0, maxPerGroup)
    const workspaceSlice = workspaceEntries.slice(0, maxPerGroup)
    const combined = [...sessionSlice, ...workspaceSlice]
    const capped = combined.length > BROWSE_TOTAL_CAP ? combined.slice(0, BROWSE_TOTAL_CAP) : combined
    return c.json({
      entries: capped,
      total: rootEntries.length + workspaceEntries.length,
      sessionEntries: sessionSlice,
      workspaceEntries: workspaceSlice,
    })
  }

  const sessionMatched = matchEntries(rootEntries, q)
  const workspaceMatched = matchEntries(workspaceEntries, q)
  sortGroup(sessionMatched, q)
  sortGroup(workspaceMatched, q)

  const totalMatched = sessionMatched.length + workspaceMatched.length
  let sessionSlice: Entry[]
  let workspaceSlice: Entry[]
  if (totalMatched <= limit) {
    sessionSlice = sessionMatched
    workspaceSlice = workspaceMatched
  } else {
    const sessionQuota = Math.max(
      sessionMatched.length > 0 ? 1 : 0,
      Math.round(limit * sessionMatched.length / totalMatched),
    )
    const workspaceQuota = Math.max(
      workspaceMatched.length > 0 ? 1 : 0,
      limit - sessionQuota,
    )
    sessionSlice = sessionMatched.slice(0, sessionQuota)
    workspaceSlice = workspaceMatched.slice(0, workspaceQuota)
  }

  return c.json({
    entries: [...sessionSlice, ...workspaceSlice],
    total: sessionMatched.length + workspaceMatched.length,
    sessionEntries: sessionSlice,
    workspaceEntries: workspaceSlice,
  })
})

// ===== 上下文挂载（会话级） =====

/** 路径安全黑名单（M2.5 单用户基础版，M3 多用户时加强） */
const PATH_BLACKLIST_STATIC = ['/etc', '/root', '/sys', '/proc', '/dev', '/boot', '/var/run']

function assertPathSafe(targetPath: string): void {
  const resolved = resolve(targetPath)
  // 静态系统目录 + Web 数据根目录（多用户场景覆盖真实数据根 ~/.proma-web/，避免挂载隔离绕过）
  const blacklist = [...PATH_BLACKLIST_STATIC, getDataRoot()]
  for (const blocked of blacklist) {
    if (resolved === blocked || resolved.startsWith(blocked + '/')) {
      throw new Error(`不允许挂载受保护目录: ${blocked}`)
    }
  }
}

/** POST /api/agent:attach-directory → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.ATTACH_DIRECTORY}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<AgentAttachDirectoryInput>()
  const meta = getAgentSessionMeta(input.sessionId, scope)
  if (!meta) return c.json({ error: `会话不存在: ${input.sessionId}` }, 404)

  assertPathSafe(input.directoryPath)
  if (!existsSync(input.directoryPath)) {
    return c.json({ error: `目录不存在: ${input.directoryPath}` }, 400)
  }

  const existing = meta.attachedDirectories ?? []
  if (existing.includes(input.directoryPath)) return c.json(existing)

  const updated = [...existing, input.directoryPath]
  updateAgentSessionMeta(input.sessionId, { attachedDirectories: updated }, scope)
  return c.json(updated)
})

/** POST /api/agent:detach-directory → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.DETACH_DIRECTORY}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<AgentAttachDirectoryInput>()
  const meta = getAgentSessionMeta(input.sessionId, scope)
  if (!meta) return c.json({ error: `会话不存在: ${input.sessionId}` }, 404)

  const existing = meta.attachedDirectories ?? []
  const updated = existing.filter((d) => d !== input.directoryPath)
  updateAgentSessionMeta(input.sessionId, { attachedDirectories: updated }, scope)
  return c.json(updated)
})

/** POST /api/agent:attach-file → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.ATTACH_FILE}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<AgentAttachFileInput>()
  const meta = getAgentSessionMeta(input.sessionId, scope)
  if (!meta) return c.json({ error: `会话不存在: ${input.sessionId}` }, 404)

  assertPathSafe(input.filePath)
  const safePath = resolve(input.filePath)
  if (!existsSync(safePath)) {
    return c.json({ error: `文件不存在: ${input.filePath}` }, 400)
  }
  const stats = statSync(safePath)
  if (!stats.isFile()) return c.json({ error: '只能附加文件' }, 400)

  const existing = meta.attachedFiles ?? []
  if (existing.includes(safePath)) return c.json(existing)

  const updated = [...existing, safePath]
  updateAgentSessionMeta(input.sessionId, { attachedFiles: updated }, scope)
  return c.json(updated)
})

/** POST /api/agent:detach-file → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.DETACH_FILE}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<AgentAttachFileInput>()
  const meta = getAgentSessionMeta(input.sessionId, scope)
  if (!meta) return c.json({ error: `会话不存在: ${input.sessionId}` }, 404)

  const existing = meta.attachedFiles ?? []
  const updated = existing.filter((f) => f !== input.filePath)
  updateAgentSessionMeta(input.sessionId, { attachedFiles: updated }, scope)
  return c.json(updated)
})

// ===== 上下文挂载（工作区级） =====

/**
 * POST /api/agent:attach-workspace-directory → string[]（仅管理员）
 *
 * 计划外审计补挂：修改全局工作区的挂载配置（可引入任意主机目录供所有会话访问），
 * 与 §2.1 工作区写路由同档门控。会话级挂载（attach-directory）不受影响。
 */
agent.post(`/${AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY}`, adminOnly, async (c) => {
  const input = await c.req.json<WorkspaceAttachDirectoryInput>()
  assertPathSafe(input.directoryPath)
  if (!existsSync(input.directoryPath)) {
    return c.json({ error: `目录不存在: ${input.directoryPath}` }, 400)
  }
  return c.json(attachWorkspaceDirectory(input.workspaceSlug, input.directoryPath))
})

/** POST /api/agent:detach-workspace-directory → string[]（仅管理员：全局工作区挂载配置写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY}`, adminOnly, async (c) => {
  const input = await c.req.json<WorkspaceAttachDirectoryInput>()
  return c.json(detachWorkspaceDirectory(input.workspaceSlug, input.directoryPath))
})

/** POST /api/agent:attach-workspace-file → string[]（仅管理员：全局工作区挂载配置写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_FILE}`, adminOnly, async (c) => {
  const input = await c.req.json<WorkspaceAttachFileInput>()
  assertPathSafe(input.filePath)
  const safePath = resolve(input.filePath)
  if (!existsSync(safePath)) {
    return c.json({ error: `文件不存在: ${input.filePath}` }, 400)
  }
  const stats = statSync(safePath)
  if (!stats.isFile()) return c.json({ error: '只能附加文件' }, 400)
  return c.json(attachWorkspaceFile(input.workspaceSlug, safePath))
})

/** POST /api/agent:detach-workspace-file → string[]（仅管理员：全局工作区挂载配置写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.DETACH_WORKSPACE_FILE}`, adminOnly, async (c) => {
  const input = await c.req.json<WorkspaceAttachFileInput>()
  return c.json(detachWorkspaceFile(input.workspaceSlug, input.filePath))
})

/** POST /api/agent:get-workspace-directories → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES}`, async (c) => {
  const { workspaceSlug } = await c.req.json<{ workspaceSlug: string }>()
  return c.json(getWorkspaceAttachedDirectories(workspaceSlug))
})

/** POST /api/agent:get-workspace-attached-files → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_WORKSPACE_ATTACHED_FILES}`, async (c) => {
  const { workspaceSlug } = await c.req.json<{ workspaceSlug: string }>()
  return c.json(getWorkspaceAttachedFiles(workspaceSlug))
})

// ===== 会话高级操作 =====

/** POST /api/agent:fork-session → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.FORK_SESSION}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<ForkSessionInput>()
  const newMeta = await forkAgentSession(input, scope)
  return c.json(newMeta)
})

/** POST /api/agent:rewind-session → RewindSessionResult */
agent.post(`/${AGENT_IPC_CHANNELS.REWIND_SESSION}`, async (c) => {
  const input = await c.req.json<RewindSessionInput>()
  const result = await orchestrator.rewindSession(input.sessionId, input.assistantMessageUuid, getUserScope(c))
  return c.json(result)
})

/** POST /api/agent:search-messages → AgentMessageSearchResult[] */
agent.post(`/${AGENT_IPC_CHANNELS.SEARCH_MESSAGES}`, async (c) => {
  const scope = getUserScope(c)
  const { query } = await c.req.json<{ query: string }>()
  return c.json(await searchAgentSessionMessages(query, scope))
})

/** POST /api/agent:queue-message → string (uuid) */
agent.post(`/${AGENT_IPC_CHANNELS.QUEUE_MESSAGE}`, async (c) => {
  const input = await c.req.json<AgentQueueMessageInput>()
  const uuid = await orchestrator.queueMessage(
    input.sessionId,
    input.userMessage,
    input.rawUserMessage,
    undefined,
    input.uuid,
    { interrupt: input.interrupt },
    input.mentionedSkills,
    input.mentionedMcpServers,
    input.mentionedSessionIds,
    getUserScope(c),
  )
  return c.json(uuid)
})

// ===== 会话设置 =====

/** POST /api/agent:update-session-agent-runtime → AgentSessionMeta（降级为 no-op） */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SESSION_AGENT_RUNTIME}`, async (c) => {
  const scope = getUserScope(c)
  const { sessionId } = await c.req.json<{ sessionId: string; runtime: string }>()
  const meta = getAgentSessionMeta(sessionId, scope)
  if (!meta) return c.json({ error: `Agent 会话不存在: ${sessionId}` }, 404)
  // Pi 为唯一 runtime，返回当前元数据即可
  return c.json(meta)
})

/** POST /api/agent:update-session-codex-fast-mode → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SESSION_CODEX_FAST_MODE}`, async (c) => {
  const scope = getUserScope(c)
  const { sessionId, enabled } = await c.req.json<{ sessionId: string; enabled: boolean }>()
  if (typeof enabled !== 'boolean') {
    return c.json({ error: `无效的 Codex Fast Mode 状态: ${String(enabled)}` }, 400)
  }
  const meta = getAgentSessionMeta(sessionId, scope)
  if (!meta) return c.json({ error: `Agent 会话不存在: ${sessionId}` }, 404)
  if (orchestrator.isActive(sessionId)) {
    return c.json({ error: 'Agent 正在运行，完成后再切换快速模式' }, 409)
  }
  return c.json(updateAgentSessionMeta(sessionId, { codexFastMode: enabled }, scope))
})

/** POST /api/agent:update-session-openai-reasoning → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SESSION_OPENAI_REASONING}`, async (c) => {
  const scope = getUserScope(c)
  const { sessionId, thinkingLevel } = await c.req.json<{ sessionId: string; thinkingLevel: AgentThinkingLevel }>()
  const validLevels: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
  if (!validLevels.includes(thinkingLevel)) {
    return c.json({ error: `无效的 Codex 思考深度: ${String(thinkingLevel)}` }, 400)
  }
  const meta = getAgentSessionMeta(sessionId, scope)
  if (!meta) return c.json({ error: `Agent 会话不存在: ${sessionId}` }, 404)
  if (orchestrator.isActive(sessionId)) {
    return c.json({ error: 'Agent 正在运行，完成后再切换思考深度' }, 409)
  }
  return c.json(updateAgentSessionMeta(sessionId, { openAIThinkingLevel: thinkingLevel }, scope))
})

// ===== 迭代 5：挂载文件操作 =====

/** 路径安全校验：确保路径在已授权目录内（供其他文件类路由复用，多用户 scope 隔离红线） */
export function assertAttachedPathAllowed(targetPath: string, access?: FileAccessOptions, scope?: UserScope): void {
  const resolved = resolve(targetPath)
  const allowedDirs: string[] = []
  const allowedFiles: string[] = []

  // 收集会话级挂载
  if (access?.sessionId) {
    const meta = getAgentSessionMeta(access.sessionId, scope)
    if (meta?.attachedDirectories) allowedDirs.push(...meta.attachedDirectories)
    if (meta?.attachedFiles) allowedFiles.push(...meta.attachedFiles)
    // 也允许访问会话工作目录
    if (meta?.workspaceId) {
      const ws = getAgentWorkspace(meta.workspaceId)
      if (ws) allowedDirs.push(getAgentSessionWorkspacePath(ws.slug, access.sessionId, scope))
    }
  }

  // 收集工作区级挂载
  if (access?.workspaceSlug) {
    allowedDirs.push(...getWorkspaceAttachedDirectories(access.workspaceSlug))
    allowedFiles.push(...getWorkspaceAttachedFiles(access.workspaceSlug))
    allowedDirs.push(getWorkspaceFilesDir(access.workspaceSlug))
  }

  // 始终允许 agent-workspaces 根目录
  allowedDirs.push(getAgentWorkspacesDir())

  const isAllowed = allowedDirs.some((dir) => {
    const resolvedDir = resolve(dir)
    return resolved === resolvedDir || resolved.startsWith(resolvedDir + sep)
  }) || allowedFiles.some((file) => resolve(file) === resolved)

  if (!isAllowed) {
    throw new Error('访问路径不在允许范围内')
  }
}

/** POST /api/agent:list-attached-directory → FileEntry[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY}`, async (c) => {
  const scope = getUserScope(c)
  const { dirPath, access } = await c.req.json<{ dirPath: string; access?: FileAccessOptions }>()
  const safePath = resolve(dirPath)
  assertAttachedPathAllowed(safePath, access, scope)

  if (!existsSync(safePath)) return c.json([])

  const entries: FileEntry[] = []
  const items = readdirSync(safePath, { withFileTypes: true })
  for (const item of items) {
    if (HIDDEN_FS_ENTRIES.has(item.name)) continue
    const fullPath = resolve(safePath, item.name)
    const isDirectory = item.isDirectory()
    const size = isDirectory ? undefined : statSync(fullPath).size
    entries.push({ name: item.name, path: fullPath, isDirectory, size })
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const aHidden = a.name.startsWith('.')
    const bHidden = b.name.startsWith('.')
    if (aHidden !== bHidden) return aHidden ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return c.json(entries)
})

/** POST /api/agent:read-attached-file → string（base64） */
agent.post(`/${AGENT_IPC_CHANNELS.READ_ATTACHED_FILE}`, async (c) => {
  const scope = getUserScope(c)
  const { filePath, sessionId, workspaceSlug } = await c.req.json<{
    filePath: string
    sessionId?: string
    workspaceSlug?: string
  }>()

  if (!filePath || typeof filePath !== 'string') {
    return c.json({ error: '无效的文件路径' }, 400)
  }

  const safePath = resolve(filePath)
  assertAttachedPathAllowed(safePath, { sessionId, workspaceSlug }, scope)

  const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
  const fileStat = statSync(safePath)
  if (fileStat.size > MAX_FILE_SIZE) {
    return c.json({ error: `文件过大（${Math.round(fileStat.size / 1024 / 1024)}MB），最大支持 20MB` }, 400)
  }

  const buffer = readFileSync(safePath)
  return c.json(buffer.toString('base64'))
})

/** POST /api/agent:rename-attached-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE}`, async (c) => {
  const scope = getUserScope(c)
  const { filePath, newName, access } = await c.req.json<{
    filePath: string
    newName: string
    access?: FileAccessOptions
  }>()

  if (newName.includes('/') || newName.includes('\\') || newName.includes('..') || newName.includes(sep)) {
    return c.json({ error: '文件名不能包含路径分隔符或 ".."' }, 400)
  }

  const safePath = resolve(filePath)
  assertAttachedPathAllowed(safePath, access, scope)
  const newPath = join(dirname(safePath), newName)
  renameSync(safePath, newPath)
  return c.json({ ok: true })
})

/** POST /api/agent:move-attached-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE}`, async (c) => {
  const scope = getUserScope(c)
  const { filePath, targetDir, access } = await c.req.json<{
    filePath: string
    targetDir: string
    access?: FileAccessOptions
  }>()

  const safePath = resolve(filePath)
  const safeTarget = resolve(targetDir)
  assertAttachedPathAllowed(safePath, access, scope)
  assertAttachedPathAllowed(safeTarget, access, scope)
  renameSync(safePath, join(safeTarget, basename(safePath)))
  return c.json({ ok: true })
})

// ===== 迭代 5：Worktree 管理 =====

/** POST /api/agent:get-worktree-repos → WorkspaceWorktreeRepo[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_WORKTREE_REPOS}`, async (c) => {
  const { workspaceSlug } = await c.req.json<{ workspaceSlug: string }>()
  return c.json(await getWorktreeRepos(workspaceSlug))
})

/**
 * POST /api/agent:add-worktree-repo → WorkspaceWorktreeRepo[]（仅管理员）
 *
 * 计划外审计补挂：worktree 仓库登记写入全局工作区配置，与工作区写路由同档门控。
 */
agent.post(`/${AGENT_IPC_CHANNELS.ADD_WORKTREE_REPO}`, adminOnly, async (c) => {
  const { workspaceSlug, repo } = await c.req.json<{ workspaceSlug: string; repo: WorkspaceWorktreeRepo }>()
  return c.json(addWorktreeRepo(workspaceSlug, repo))
})

/** POST /api/agent:remove-worktree-repo → WorkspaceWorktreeRepo[]（仅管理员：全局工作区配置写操作） */
agent.post(`/${AGENT_IPC_CHANNELS.REMOVE_WORKTREE_REPO}`, adminOnly, async (c) => {
  const { workspaceSlug, repoPath } = await c.req.json<{ workspaceSlug: string; repoPath: string }>()
  return c.json(removeWorktreeRepo(workspaceSlug, repoPath))
})

// ===== 迭代 5：Agent 杂项通道 =====

/** POST /api/agent:migrate-chat-to-agent → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.MIGRATE_CHAT_TO_AGENT}`, async (c) => {
  const scope = getUserScope(c)
  const { conversationId, agentSessionId } = await c.req.json<{ conversationId: string; agentSessionId: string }>()
  migrateChatToAgentSession(conversationId, agentSessionId, scope)
  return c.json({ ok: true })
})

/** POST /api/agent:confirm-working-done → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.CLEAR_COMPLETION_STATE}`, async (c) => {
  const scope = getUserScope(c)
  const { id } = await c.req.json<{ id: string }>()
  const meta = getAgentSessionMeta(id, scope)
  if (!meta) return c.json({ error: `Agent 会话不存在: ${id}` }, 404)
  const updates: Partial<import('@proma/shared').AgentSessionMeta> = {}
  if (meta.manualWorking) updates.manualWorking = false
  if (meta.completedButUnconfirmed) updates.completedButUnconfirmed = false
  if (Object.keys(updates).length === 0) return c.json(meta)
  return c.json(updateAgentSessionMeta(id, updates, scope))
})

/** POST /api/agent:search-session-references → AgentSessionReferenceSearchResult[] */
agent.post(`/${AGENT_IPC_CHANNELS.SEARCH_SESSION_REFERENCES}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<AgentSessionReferenceSearchInput>()
  return c.json(searchAgentSessionReferences(input, scope))
})

/** POST /api/agent:move-session-to-workspace → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.MOVE_SESSION_TO_WORKSPACE}`, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<MoveSessionToWorkspaceInput>()
  if (orchestrator.isActive(input.sessionId)) {
    // 短暂等待后重试一次（渲染进程 running 状态可能比主进程清理更早变为 false）
    await new Promise((r) => setTimeout(r, 500))
    if (orchestrator.isActive(input.sessionId)) {
      return c.json({ error: '会话正在运行中，请停止后再迁移' }, 409)
    }
  }
  return c.json(moveSessionToWorkspace(input.sessionId, input.targetWorkspaceId, scope))
})

/** 最大附件大小（100MB） */
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024

/** POST /api/agent:save-files-to-session → AgentSavedFile[] */
agent.post(`/${AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION}`, async (c) => {
  const input = await c.req.json<AgentSaveFilesInput>()
  const sessionDir = getAgentSessionWorkspacePath(input.workspaceSlug, input.sessionId, getUserScope(c))
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = join(sessionDir, file.filename)

    // 防止同名文件覆盖
    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    mkdirSync(dirname(targetPath), { recursive: true })

    if (file.data.length * 0.75 > MAX_ATTACHMENT_SIZE) {
      logger.warn('文件超过 100MB 限制，跳过', { filename: file.filename })
      continue
    }

    writeFileSync(targetPath, Buffer.from(file.data, 'base64'))
    results.push({ filename: targetPath.slice(sessionDir.length + 1), targetPath })
  }

  return c.json(results)
})

/**
 * POST /api/agent:save-files-to-workspace → AgentSavedFile[]（仅管理员）
 *
 * 计划外审计补挂：向全局工作区的 workspace-files 目录写入任意文件，
 * 与 write-workspace-auto-memory-file 等全局工作区写路由同档门控。
 * 会话级对应路由（save-files-to-session，写用户私有会话目录）保持开放。
 */
agent.post(`/${AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE}`, adminOnly, async (c) => {
  const input = await c.req.json<AgentSaveWorkspaceFilesInput>()
  const wsFilesDir = getWorkspaceFilesDir(input.workspaceSlug)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = join(wsFilesDir, file.filename)

    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = join(wsFilesDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = join(wsFilesDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    mkdirSync(dirname(targetPath), { recursive: true })

    if (file.data.length * 0.75 > MAX_ATTACHMENT_SIZE) {
      logger.warn('工作区文件超过 100MB 限制，跳过', { filename: file.filename })
      continue
    }

    writeFileSync(targetPath, Buffer.from(file.data, 'base64'))
    results.push({ filename: targetPath.slice(wsFilesDir.length + 1), targetPath })
  }

  return c.json(results)
})

/** POST /api/agent:get-task-output → GetTaskOutputResult（保留接口，暂未实现） */
agent.post(`/${AGENT_IPC_CHANNELS.GET_TASK_OUTPUT}`, async (c) => {
  await c.req.json<GetTaskOutputInput>()
  logger.warn('GET_TASK_OUTPUT 当前版本暂未实现，返回空输出')
  return c.json({ output: '', isComplete: false } satisfies GetTaskOutputResult)
})

/** POST /api/agent:stop-task → { ok: true }（保留接口，暂未实现） */
agent.post(`/${AGENT_IPC_CHANNELS.STOP_TASK}`, async (c) => {
  const input = await c.req.json<StopTaskInput>()
  logger.warn('STOP_TASK 任务停止功能待实现', { type: input.type })
  return c.json({ ok: true })
})

export { agent }
