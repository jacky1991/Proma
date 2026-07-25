/**
 * Agent 域 HTTP 路由
 *
 * 将 Electron IPC handler 映射为 Hono 路由。
 * M2 阶段：P0 路由（会话 CRUD / 消息发送 / 工作区）。
 */

import { Hono } from 'hono'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { AgentSendInput, AgentGenerateTitleInput, AgentMessage, PermissionResponse, AskUserResponse, ExitPlanModeResponse, PendingRequestsSnapshot, PromaPermissionMode, WorkspaceMcpConfig, McpServerEntry, FileEntry } from '@proma/shared'
import { isPromaPermissionMode } from '@proma/shared'
import { existsSync, readdirSync, statSync, rmSync, renameSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import {
  listAgentSessions,
  createAgentSession,
  deleteAgentSession,
  getAgentSessionSDKMessages,
  updateAgentSessionMeta,
  getAgentSessionMeta,
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
  getOtherWorkspaceSkills,
  getDefaultSkillSlugs,
  importSkillFromWorkspace,
  updateSkillFromSource,
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
} from '@proma/server-core/agent-workspace-manager'
import { setBuiltinMcpUserEnabled } from '@proma/server-core/builtin-mcp/settings'
import { getWorkspaceSkillsDir, getAgentWorkspacesDir, getAgentSessionWorkspacePath } from '@proma/server-core/config-paths'
import { validateMcpServer } from '@proma/server-core/mcp-validator'
import { permissionService } from '@proma/server-core/agent-permission-service'
import { askUserService } from '@proma/server-core/agent-ask-user-service'
import { exitPlanService } from '@proma/server-core/agent-exit-plan-service'
import { orchestrator, streamSink } from '../engine'

const agent = new Hono()

// ===== 会话 CRUD =====

/** POST /api/agent:list-sessions → AgentSessionMeta[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_SESSIONS}`, (c) => {
  return c.json(listAgentSessions())
})

/** POST /api/agent:create-session → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.CREATE_SESSION}`, async (c) => {
  const input = await c.req.json()
  const session = createAgentSession(input)
  return c.json(session)
})

/** POST /api/agent:delete-session → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_SESSION}`, async (c) => {
  const { id } = await c.req.json()
  deleteAgentSession(id)
  return c.json({ ok: true })
})

/** POST /api/agent:get-sdk-messages → SDKMessage[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SDK_MESSAGES}`, async (c) => {
  const { id } = await c.req.json()
  return c.json(getAgentSessionSDKMessages(id))
})

/** POST /api/agent:update-title → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_TITLE}`, async (c) => {
  const { sessionId, title } = await c.req.json()
  updateAgentSessionMeta(sessionId, { title })
  return c.json({ ok: true })
})

/** POST /api/agent:update-session-model → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SESSION_MODEL}`, async (c) => {
  const { sessionId, model } = await c.req.json()
  updateAgentSessionMeta(sessionId, { modelId: model })
  return c.json({ ok: true })
})

/** POST /api/agent:toggle-pin → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.TOGGLE_PIN}`, async (c) => {
  const { id } = await c.req.json()
  const meta = getAgentSessionMeta(id)
  if (!meta) return c.json({ error: 'Session not found' }, 404)
  const updated = updateAgentSessionMeta(id, { pinned: !meta.pinned })
  return c.json(updated)
})

/** POST /api/agent:toggle-archive → AgentSessionMeta */
agent.post(`/${AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE}`, async (c) => {
  const { id } = await c.req.json()
  const meta = getAgentSessionMeta(id)
  if (!meta) return c.json({ error: 'Session not found' }, 404)
  const updated = updateAgentSessionMeta(id, { archived: !meta.archived })
  return c.json(updated)
})

/** POST /api/agent:update-session-permission-mode → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE}`, async (c) => {
  const { sessionId, mode } = await c.req.json()
  updateAgentSessionMeta(sessionId, { permissionMode: mode })
  return c.json({ ok: true })
})

// ===== 消息发送 & 控制 =====

/** POST /api/agent:send-message → { ok: true }（流式事件经 WS 推送） */
agent.post(`/${AGENT_IPC_CHANNELS.SEND_MESSAGE}`, async (c) => {
  const input = await c.req.json<AgentSendInput>()
  const sessionId = input.sessionId

  // 构建 SessionCallbacks：将事件转发到 StreamSink（WS 推送）
  const callbacks = {
    onError: (error: string) => {
      streamSink.emit(sessionId, { type: 'stream-error', error })
    },
    onComplete: (messages?: AgentMessage[], opts?: { stoppedByUser?: boolean }) => {
      streamSink.emit(sessionId, { type: 'stream-complete', messages, ...opts })
    },
    onTitleUpdated: (title: string) => {
      streamSink.emit(sessionId, { type: 'title-updated', title })
    },
    onRunStarted: (opts: { startedAt: number }) => {
      streamSink.emit(sessionId, { type: 'run-started', ...opts })
    },
  }

  // 异步执行，不等待完成（流式事件经 WS 推送）
  orchestrator.sendMessage(input, callbacks).catch((err: unknown) => {
    console.error('[Agent 路由] sendMessage 失败:', err)
  })
  return c.json({ ok: true })
})

/** POST /api/agent:stop → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.STOP_AGENT}`, async (c) => {
  const { sessionId } = await c.req.json()
  orchestrator.stop(sessionId)
  return c.json({ ok: true })
})

/** POST /api/agent:generate-title → { title: string } */
agent.post(`/${AGENT_IPC_CHANNELS.GENERATE_TITLE}`, async (c) => {
  const input = await c.req.json<AgentGenerateTitleInput>()
  const title = await orchestrator.generateTitle(input)
  return c.json({ title })
})

// ===== 工作区管理 =====

/** POST /api/agent:list-workspaces → AgentWorkspace[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_WORKSPACES}`, (c) => {
  return c.json(listAgentWorkspaces())
})

/** POST /api/agent:create-workspace → AgentWorkspace */
agent.post(`/${AGENT_IPC_CHANNELS.CREATE_WORKSPACE}`, async (c) => {
  const input = await c.req.json()
  const workspace = createAgentWorkspace(input)
  return c.json(workspace)
})

/** POST /api/agent:update-workspace → AgentWorkspace */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_WORKSPACE}`, async (c) => {
  const { id, ...updates } = await c.req.json()
  const workspace = updateAgentWorkspace(id, updates)
  return c.json(workspace)
})

/** POST /api/agent:delete-workspace → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_WORKSPACE}`, async (c) => {
  const { id } = await c.req.json()
  deleteAgentWorkspace(id)
  return c.json({ ok: true })
})

/** POST /api/agent:reorder-workspaces → AgentWorkspace[] */
agent.post(`/${AGENT_IPC_CHANNELS.REORDER_WORKSPACES}`, async (c) => {
  const { orderedIds } = await c.req.json()
  return c.json(reorderAgentWorkspaces(orderedIds))
})

/** POST /api/agent:get-capabilities → WorkspaceCapabilities */
agent.post(`/${AGENT_IPC_CHANNELS.GET_CAPABILITIES}`, async (c) => {
  const { workspaceId } = await c.req.json()
  // getWorkspaceCapabilities 需要 slug，先通过 id 查找 workspace
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)
  const capabilities = getWorkspaceCapabilities(workspace.slug)
  return c.json(capabilities)
})

// ===== 权限 / AskUser / ExitPlanMode 双向交互 =====

/** POST /api/agent:permission:respond → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.PERMISSION_RESPOND}`, async (c) => {
  const response = await c.req.json<PermissionResponse>()
  const { requestId, behavior, alwaysAllow } = response
  const sessionId = permissionService.respondToPermission(requestId, behavior, alwaysAllow)

  // 发送 permission_resolved 事件到 WS
  if (sessionId) {
    streamSink.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'permission_resolved', requestId, behavior },
    })
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
    })
  }
  return c.json({ ok: true })
})

/** POST /api/agent:exit-plan-mode:respond → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND}`, async (c) => {
  const response = await c.req.json<ExitPlanModeResponse>()
  const result = exitPlanService.respondToExitPlanMode(response)

  if (result) {
    const { sessionId, targetMode } = result

    // 通知渲染进程请求已处理
    streamSink.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'exit_plan_mode_resolved', requestId: response.requestId },
    })

    // 如果用户选择了新的权限模式，持久化并通知 UI
    if (targetMode) {
      const meta = getAgentSessionMeta(sessionId)
      if (meta) {
        try {
          updateAgentSessionMeta(sessionId, { permissionMode: targetMode })
        } catch (err) {
          console.warn(`[Agent 路由] ExitPlanMode 持久化权限模式失败: sessionId=${sessionId}`, err)
        }
      }
      streamSink.emit(sessionId, {
        kind: 'proma_event',
        event: { type: 'permission_mode_changed', mode: targetMode },
      })
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

/** POST /api/agent:get-mcp-config → WorkspaceMcpConfig */
agent.post(`/${AGENT_IPC_CHANNELS.GET_MCP_CONFIG}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getWorkspaceMcpConfig(workspaceSlug))
})

/** POST /api/agent:save-mcp-config → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG}`, async (c) => {
  const { workspaceSlug, config } = await c.req.json()
  saveWorkspaceMcpConfig(workspaceSlug, config as WorkspaceMcpConfig)
  return c.json({ ok: true })
})

/** POST /api/agent:test-mcp-server → { success, message } */
agent.post(`/${AGENT_IPC_CHANNELS.TEST_MCP_SERVER}`, async (c) => {
  const { name, entry } = await c.req.json()
  const result = await validateMcpServer(name, entry as McpServerEntry)
  return c.json({
    success: result.valid,
    message: result.valid ? '连接成功' : (result.reason || '连接失败'),
  })
})

/** POST /api/agent:set-builtin-mcp-enabled → WorkspaceCapabilities */
agent.post(`/${AGENT_IPC_CHANNELS.SET_BUILTIN_MCP_ENABLED}`, async (c) => {
  const { workspaceSlug, id, enabled } = await c.req.json()
  setBuiltinMcpUserEnabled(id, enabled)
  return c.json(getWorkspaceCapabilities(workspaceSlug))
})

// ===== Skills 管理 =====

/** POST /api/agent:get-skills → SkillMeta[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SKILLS}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getAllWorkspaceSkills(workspaceSlug))
})

/** POST /api/agent:get-skills-dir → string */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SKILLS_DIR}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getWorkspaceSkillsDir(workspaceSlug))
})

/** POST /api/agent:delete-skill → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_SKILL}`, async (c) => {
  const { workspaceSlug, skillSlug } = await c.req.json()
  deleteWorkspaceSkill(workspaceSlug, skillSlug)
  return c.json({ ok: true })
})

/** POST /api/agent:toggle-skill → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.TOGGLE_SKILL}`, async (c) => {
  const { workspaceSlug, skillSlug, enabled } = await c.req.json()
  toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled)
  return c.json({ ok: true })
})

/** POST /api/agent:get-other-workspace-skills → OtherWorkspaceSkillsGroup[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS}`, async (c) => {
  const { currentSlug } = await c.req.json()
  return c.json(getOtherWorkspaceSkills(currentSlug))
})

/** POST /api/agent:get-default-skill-slugs → string[] */
agent.post(`/${AGENT_IPC_CHANNELS.GET_DEFAULT_SKILL_SLUGS}`, (c) => {
  return c.json(getDefaultSkillSlugs())
})

/** POST /api/agent:import-skill-from-workspace → SkillMeta */
agent.post(`/${AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE}`, async (c) => {
  const { targetSlug, sourceSlug, skillSlug } = await c.req.json()
  return c.json(importSkillFromWorkspace(targetSlug, sourceSlug, skillSlug))
})

/** POST /api/agent:update-skill-from-source → SkillMeta */
agent.post(`/${AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE}`, async (c) => {
  const { targetSlug, skillSlug } = await c.req.json()
  return c.json(updateSkillFromSource(targetSlug, skillSlug))
})

/** POST /api/agent:read-skill-content → string */
agent.post(`/${AGENT_IPC_CHANNELS.READ_SKILL_CONTENT}`, async (c) => {
  const { workspaceSlug, skillSlug } = await c.req.json()
  return c.json(readWorkspaceSkillContent(workspaceSlug, skillSlug))
})

/** POST /api/agent:write-skill-content → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_SKILL_CONTENT}`, async (c) => {
  const { workspaceSlug, skillSlug, content } = await c.req.json()
  writeWorkspaceSkillContent(workspaceSlug, skillSlug, content)
  return c.json({ ok: true })
})

// ===== Skill 子文件管理 =====

/** POST /api/agent:list-skill-files → SkillFileNode[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_SKILL_FILES}`, async (c) => {
  const { workspaceSlug, skillSlug } = await c.req.json()
  return c.json(listSkillFiles(workspaceSlug, skillSlug))
})

/** POST /api/agent:read-skill-file → SkillFileContent */
agent.post(`/${AGENT_IPC_CHANNELS.READ_SKILL_FILE}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath } = await c.req.json()
  return c.json(readSkillFile(workspaceSlug, skillSlug, relativePath))
})

/** POST /api/agent:write-skill-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_SKILL_FILE}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath, content } = await c.req.json()
  writeSkillFile(workspaceSlug, skillSlug, relativePath, content)
  return c.json({ ok: true })
})

/** POST /api/agent:create-skill-entry → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath, type } = await c.req.json()
  createSkillEntry(workspaceSlug, skillSlug, relativePath, type)
  return c.json({ ok: true })
})

/** POST /api/agent:delete-skill-entry → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY}`, async (c) => {
  const { workspaceSlug, skillSlug, relativePath } = await c.req.json()
  deleteSkillEntry(workspaceSlug, skillSlug, relativePath)
  return c.json({ ok: true })
})

/** POST /api/agent:rename-skill-entry → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY}`, async (c) => {
  const { workspaceSlug, skillSlug, fromRelative, toRelative } = await c.req.json()
  renameSkillEntry(workspaceSlug, skillSlug, fromRelative, toRelative)
  return c.json({ ok: true })
})

// ===== 工作区记忆文件 =====

/** POST /api/agent:get-workspace-memory-summary → WorkspaceMemorySummary */
agent.post(`/${AGENT_IPC_CHANNELS.GET_WORKSPACE_MEMORY_SUMMARY}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(getWorkspaceMemorySummary(workspaceSlug))
})

/** POST /api/agent:read-workspace-claude-md → SkillFileContent */
agent.post(`/${AGENT_IPC_CHANNELS.READ_WORKSPACE_CLAUDE_MD}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(readWorkspaceClaudeMd(workspaceSlug))
})

/** POST /api/agent:write-workspace-claude-md → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_WORKSPACE_CLAUDE_MD}`, async (c) => {
  const { workspaceSlug, content } = await c.req.json()
  writeWorkspaceClaudeMd(workspaceSlug, content)
  return c.json({ ok: true })
})

/** POST /api/agent:list-workspace-auto-memory-files → SkillFileNode[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_WORKSPACE_AUTO_MEMORY_FILES}`, async (c) => {
  const { workspaceSlug } = await c.req.json()
  return c.json(listWorkspaceAutoMemoryFiles(workspaceSlug))
})

/** POST /api/agent:read-workspace-auto-memory-file → SkillFileContent */
agent.post(`/${AGENT_IPC_CHANNELS.READ_WORKSPACE_AUTO_MEMORY_FILE}`, async (c) => {
  const { workspaceSlug, relativePath } = await c.req.json()
  return c.json(readWorkspaceAutoMemoryFile(workspaceSlug, relativePath))
})

/** POST /api/agent:write-workspace-auto-memory-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AUTO_MEMORY_FILE}`, async (c) => {
  const { workspaceSlug, relativePath, content } = await c.req.json()
  writeWorkspaceAutoMemoryFile(workspaceSlug, relativePath, content)
  return c.json({ ok: true })
})

// ===== 文件系统操作 =====

const HIDDEN_FS_ENTRIES = new Set(['.DS_Store', 'Thumbs.db'])

/** 安全校验：路径必须在 agent-workspaces 目录下 */
function assertWorkspacePath(safePath: string): void {
  const workspacesRoot = resolve(getAgentWorkspacesDir())
  if (!safePath.startsWith(workspacesRoot)) {
    throw new Error('访问路径超出 Agent 工作区范围')
  }
}

/** POST /api/agent:get-session-path → string | null */
agent.post(`/${AGENT_IPC_CHANNELS.GET_SESSION_PATH}`, async (c) => {
  const { workspaceId, sessionId } = await c.req.json()
  const ws = getAgentWorkspace(workspaceId)
  if (!ws) return c.json(null)
  return c.json(getAgentSessionWorkspacePath(ws.slug, sessionId))
})

/** POST /api/agent:list-directory → FileEntry[] */
agent.post(`/${AGENT_IPC_CHANNELS.LIST_DIRECTORY}`, async (c) => {
  const { dirPath } = await c.req.json()
  const safePath = resolve(dirPath)
  assertWorkspacePath(safePath)

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
  assertWorkspacePath(safePath)
  rmSync(safePath, { recursive: true, force: true })
  return c.json({ ok: true })
})

/** POST /api/agent:rename-file → { ok: true } */
agent.post(`/${AGENT_IPC_CHANNELS.RENAME_FILE}`, async (c) => {
  const { filePath, newName } = await c.req.json()
  const safePath = resolve(filePath)
  assertWorkspacePath(safePath)
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
  assertWorkspacePath(safePath)
  assertWorkspacePath(safeTarget)
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
  const { rootPath, query, limit = 20 } = await c.req.json<{ rootPath: string; query: string; limit?: number }>()
  const safeRoot = resolve(rootPath)
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache'])
  const ignoreFiles = new Set(['.DS_Store', '.Spotlight-V100', '.Trashes', 'Thumbs.db', 'desktop.ini'])

  type Entry = { name: string; path: string; type: 'file' | 'dir' }
  const allEntries: Entry[] = []

  function scan(dir: string, depth: number): void {
    if (depth > 10 || allEntries.length > 3000) return
    try {
      const items = readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        if (ignoreFiles.has(item.name)) continue
        if (item.isDirectory() && ignoreDirs.has(item.name)) continue
        const fullPath = resolve(dir, item.name)
        allEntries.push({
          name: item.name,
          path: relative(safeRoot, fullPath),
          type: item.isDirectory() ? 'dir' : 'file',
        })
        if (item.isDirectory()) scan(fullPath, depth + 1)
      }
    } catch { /* 忽略无权限目录 */ }
  }

  scan(safeRoot, 0)

  const q = query.toLowerCase()
  const matched = q
    ? allEntries.filter((e) => e.name.toLowerCase().includes(q))
    : allEntries

  return c.json({
    files: matched.slice(0, limit),
    totalCount: matched.length,
    truncated: matched.length > limit,
  })
})

export { agent }
