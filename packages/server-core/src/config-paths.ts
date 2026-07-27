/**
 * 配置路径工具
 *
 * 管理 Proma 应用的本地配置文件路径。
 * 所有用户配置存储在 ~/.proma/ 目录下。
 */

import { join } from 'node:path'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { getEnvProbe } from './config'

/**
 * 用户作用域
 *
 * Web 多用户场景下标识数据归属的用户，
 * 用于将用户私有数据隔离到独立目录。
 */
export interface UserScope {
  userId: string
  /** 可选覆盖数据根目录（测试用） */
  dataRoot?: string
}

/** 默认用户作用域（单用户 / 兼容场景） */
export const DEFAULT_USER_SCOPE: UserScope = { userId: 'default' }

/**
 * 获取配置目录名称
 *
 * 开发模式下返回 '.proma-dev'，正式版本返回 '.proma'。
 *
 * 检测优先级：
 * 1. PROMA_DEV=1 环境变量（显式覆盖）
 * 2. Electron app.isPackaged（未打包 = 开发模式）
 * 3. 兜底 '.proma'
 */
let _configDirName: string | undefined

export function getConfigDirName(): string {
  if (_configDirName === undefined) {
    if (process.env.PROMA_DEV === '1') {
      _configDirName = '.proma-dev'
    } else {
      try {
        _configDirName = getEnvProbe().isPackaged ? '.proma' : '.proma-dev'
      } catch {
        _configDirName = '.proma'
      }
    }
    const mode = _configDirName === '.proma-dev' ? '开发模式' : '正式版本'
    console.log(`[配置] 配置目录: ~/${_configDirName}/（${mode}）`)
  }
  return _configDirName
}

/**
 * 获取配置目录路径
 *
 * 开发模式返回 ~/.proma-dev/，正式版本返回 ~/.proma/。
 * 如果目录不存在则自动创建。
 */
export function getConfigDir(): string {
  const configDir = join(homedir(), getConfigDirName())

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
    console.log(`[配置] 已创建配置目录: ${configDir}`)
  }

  return configDir
}

/**
 * Web 数据根目录覆盖值
 *
 * 由 Web 服务端 bootstrap 通过 setDataRoot() 设置；
 * Electron 端不设置，保持使用 getConfigDir()。
 */
let _dataRootOverride: string | undefined

/**
 * 设置 Web 数据根目录
 *
 * Web 服务端启动时调用，将数据根指向独立目录（如 ~/.proma-web/），
 * 与桌面端 ~/.proma/ 隔离。
 *
 * @param path 数据根目录绝对路径
 */
export function setDataRoot(path: string): void {
  _dataRootOverride = path
  console.log('[配置] Web 数据根目录已设置:', path)
}

/**
 * 获取数据根目录
 *
 * 优先级：
 * 1. setDataRoot() 设置的覆盖值
 * 2. PROMA_DATA_ROOT 环境变量
 * 3. getConfigDir()（兼容：默认仍为 ~/.proma/，Electron 不受影响）
 */
export function getDataRoot(): string {
  if (_dataRootOverride) return _dataRootOverride
  if (process.env.PROMA_DATA_ROOT) return process.env.PROMA_DATA_ROOT
  return getConfigDir()
}

/**
 * 获取指定用户的数据目录
 *
 * Web 多用户场景下，每个用户的私有数据隔离在此目录下。
 * 如果目录不存在则自动创建。
 *
 * @param scope 用户作用域
 * @returns {dataRoot}/users/{userId}/
 */
export function getUserDataDir(scope: UserScope): string {
  const root = scope.dataRoot ?? getDataRoot()
  const dir = join(root, 'users', scope.userId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取用户级会话工作区根目录
 *
 * Web 多用户场景下，每个用户的 Agent 会话工作目录隔离在此目录下。
 *
 * @param scope 用户作用域
 * @returns {dataRoot}/users/{userId}/agent-workspaces/
 */
export function getUserSessionWorkspacesDir(scope: UserScope): string {
  return join(getUserDataDir(scope), 'agent-workspaces')
}

/**
 * 获取 Agent 未绑定工作区时的兜底工作目录（按用户隔离）
 *
 * 未绑定工作区的会话以该目录作为 Agent 进程的默认 cwd，
 * 避免多用户共享服务器进程的 home 目录造成执行层串扰。
 * - 传入 scope（Web 端）：{dataRoot}/users/{userId}/agent-home/
 * - 未传 scope（桌面端）：保持传统 homedir() 语义，行为不变
 *
 * @param scope 用户作用域（可选）
 */
export function getAgentHomeDir(scope?: UserScope): string {
  if (!scope) return homedir()
  const dir = join(getUserDataDir(scope), 'agent-home')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取渠道配置文件路径
 *
 * @returns ~/.proma/channels.json
 */
export function getChannelsPath(): string {
  return join(getDataRoot(), 'channels.json')
}

/**
 * 获取对话索引文件路径
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/conversations.json；有 scope: {dataRoot}/users/{userId}/conversations.json
 */
export function getConversationsIndexPath(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  return join(base, 'conversations.json')
}

/**
 * 获取对话消息目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/conversations/；有 scope: {dataRoot}/users/{userId}/conversations/
 */
export function getConversationsDir(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  const dir = join(base, 'conversations')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建对话目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定对话的消息文件路径
 *
 * @param id 对话 ID
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/conversations/{id}.jsonl；有 scope: {dataRoot}/users/{userId}/conversations/{id}.jsonl
 */
export function getConversationMessagesPath(id: string, scope?: UserScope): string {
  return join(getConversationsDir(scope), `${id}.jsonl`)
}

/**
 * 获取附件存储根目录
 *
 * 如果目录不存在则自动创建。
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/attachments/；有 scope: {dataRoot}/users/{userId}/attachments/
 */
export function getAttachmentsDir(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  const dir = join(base, 'attachments')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建附件目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定对话的附件目录
 *
 * 如果目录不存在则自动创建。
 *
 * @param conversationId 对话 ID
 * @returns ~/.proma/attachments/{conversationId}/
 */
export function getConversationAttachmentsDir(conversationId: string, scope?: UserScope): string {
  const dir = join(getAttachmentsDir(scope), conversationId)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 解析附件相对路径为完整路径
 *
 * @param localPath 相对路径 {conversationId}/{uuid}.ext
 * @returns 完整路径 ~/.proma/attachments/{conversationId}/{uuid}.ext
 */
export function resolveAttachmentPath(localPath: string, scope?: UserScope): string {
  return join(getAttachmentsDir(scope), localPath)
}

/**
 * 获取应用设置文件路径
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/settings.json；有 scope: {dataRoot}/users/{userId}/settings.json
 */
export function getSettingsPath(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  return join(base, 'settings.json')
}

/**
 * 获取系统默认 App 探测缓存路径
 *
 * @returns ~/.proma/default-apps.json
 */
export function getDefaultAppsCachePath(): string {
  return join(getDataRoot(), 'default-apps.json')
}

/**
 * 获取用户档案文件路径
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/user-profile.json；有 scope: {dataRoot}/users/{userId}/user-profile.json
 */
export function getUserProfilePath(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  return join(base, 'user-profile.json')
}

/**
 * 获取代理配置文件路径
 *
 * @returns ~/.proma/proxy-settings.json
 */
export function getProxySettingsPath(): string {
  return join(getDataRoot(), 'proxy-settings.json')
}

/**
 * 获取系统提示词配置文件路径
 *
 * @returns ~/.proma/system-prompts.json
 */
export function getSystemPromptsPath(): string {
  return join(getDataRoot(), 'system-prompts.json')
}

/**
 * 获取 Chat 工具配置文件路径
 *
 * @returns ~/.proma/chat-tools.json
 */
export function getChatToolsConfigPath(): string {
  return join(getDataRoot(), 'chat-tools.json')
}

/**
 * 获取 Agent 会话索引文件路径
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/agent-sessions.json；有 scope: {dataRoot}/users/{userId}/agent-sessions.json
 */
export function getAgentSessionsIndexPath(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  return join(base, 'agent-sessions.json')
}

/**
 * 获取 Agent 会话消息目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/agent-sessions/；有 scope: {dataRoot}/users/{userId}/agent-sessions/
 */
export function getAgentSessionsDir(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  const dir = join(base, 'agent-sessions')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 会话目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定 Agent 会话的消息文件路径
 *
 * @param id 会话 ID
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/agent-sessions/{id}.jsonl；有 scope: {dataRoot}/users/{userId}/agent-sessions/{id}.jsonl
 */
export function getAgentSessionMessagesPath(id: string, scope?: UserScope): string {
  return join(getAgentSessionsDir(scope), `${id}.jsonl`)
}

/**
 * 获取 Agent 工作区索引文件路径
 *
 * @returns ~/.proma/agent-workspaces.json
 */
export function getAgentWorkspacesIndexPath(): string {
  return join(getDataRoot(), 'agent-workspaces.json')
}

/**
 * 获取 Agent 工作区根目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.proma/agent-workspaces/
 */
export function getAgentWorkspacesDir(): string {
  const dir = join(getDataRoot(), 'agent-workspaces')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 工作区目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定 Agent 工作区的目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.proma/agent-workspaces/{slug}/
 */
export function getAgentWorkspacePath(slug: string): string {
  const dir = join(getAgentWorkspacesDir(), slug)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 工作区: ${dir}`)
  }

  return dir
}

/**
 * 获取指定工作区的 MCP 配置文件路径
 *
 * @param slug 工作区 slug
 * @returns ~/.proma/agent-workspaces/{slug}/mcp.json
 */
export function getWorkspaceMcpPath(slug: string): string {
  return join(getAgentWorkspacePath(slug), 'mcp.json')
}

/**
 * 获取指定工作区的 Skills 目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.proma/agent-workspaces/{slug}/skills/
 */
export function getWorkspaceSkillsDir(slug: string): string {
  const dir = join(getAgentWorkspacePath(slug), 'skills')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 获取工作区文件目录路径
 *
 * 工作区内所有会话可访问的文件存放于此。
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.proma/agent-workspaces/{slug}/workspace-files/
 */
export function getWorkspaceFilesDir(slug: string): string {
  const dir = join(getAgentWorkspacePath(slug), 'workspace-files')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 解析工作区文件目录路径（只读，不创建目录）
 *
 * 与 getWorkspaceFilesDir 的区别：不会触发 mkdir 副作用，
 * 适用于 /now 等只读查询场景。
 *
 * @param slug 工作区 slug
 * @returns ~/.proma/agent-workspaces/{slug}/workspace-files/
 */
export function resolveWorkspaceFilesDir(slug: string): string {
  return join(getDataRoot(), 'agent-workspaces', slug, 'workspace-files')
}

/**
 * 解析 Agent 会话工作目录路径（只读，不创建目录）
 *
 * 与 getAgentSessionWorkspacePath 的区别：不会触发 mkdir 副作用，
 * 适用于 /now 等只读查询场景。
 *
 * @param slug 工作区 slug
 * @param sessionId 会话 ID
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/agent-workspaces/{slug}/{sessionId}/；有 scope: {dataRoot}/users/{userId}/agent-workspaces/{slug}/{sessionId}/
 */
export function resolveAgentSessionWorkspacePath(slug: string, sessionId: string, scope?: UserScope): string {
  if (scope) {
    return join(getUserSessionWorkspacesDir(scope), slug, sessionId)
  }
  return join(getDataRoot(), 'agent-workspaces', slug, sessionId)
}

/**
 * 获取工作区不活跃 Skills 目录路径
 *
 * 禁用的 Skill 会被移动到此目录，Agent SDK 不会扫描该目录。
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.proma/agent-workspaces/{slug}/skills-inactive/
 */
export function getInactiveSkillsDir(slug: string): string {
  const dir = join(getAgentWorkspacePath(slug), 'skills-inactive')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 获取默认 Skills 模板目录路径
 *
 * 新建工作区时自动复制此目录的内容到工作区 skills/ 下。
 *
 * @returns ~/.proma/default-skills/
 */
export function getDefaultSkillsDir(): string {
  const dir = join(getDataRoot(), 'default-skills')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 从 SKILL.md 的 YAML frontmatter 中解析 version 字段
 *
 * 无 version 字段时返回 '0.0.0'（确保旧 Skill 会被更新）。
 *
 * 纯文件读取，不依赖 Electron；workspace-manager 的 skill 升级流程复用。
 */
export function parseSkillVersion(skillDir: string): string {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) return '0.0.0'

  try {
    let content = readFileSync(skillMdPath, 'utf-8')
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fmMatch?.[1]) return '0.0.0'

    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (key === 'version' && value) return value
    }
  } catch {
    // 解析失败视为最低版本
  }

  return '0.0.0'
}

/**
 * 获取打包进 App 的 proma CLI 二进制路径。
 *
 * 打包模式下从 EnvProbe.resourcesPath/bin 取（electron-builder extraResources 注入）。
 * 开发模式 / Server 端没有编译二进制——返回 undefined，由调用方回退到源码运行。
 */
export function getBundledCliPath(): string | undefined {
  let probe: ReturnType<typeof getEnvProbe>
  try {
    probe = getEnvProbe()
  } catch {
    return undefined
  }
  if (!probe.isPackaged || !probe.resourcesPath) return undefined
  const binName = process.platform === 'win32' ? 'proma.exe' : 'proma'
  const cliPath = join(probe.resourcesPath, 'bin', binName)
  return existsSync(cliPath) ? cliPath : undefined
}

// 注：seedDefaultSkills（及 compareSemver / defaultSkillCopyFilter 等
// 其专属辅助）依赖 process.resourcesPath / app.isPackaged，属 Electron 打包职责，不进 server-core——
// 由 Electron 端 lib/config-paths.ts 在 re-export 纯路径函数之外本地保留。

/**
 * 获取微信配置文件路径
 *
 * @returns ~/.proma/wechat.json
 */
export function getWeChatConfigPath(): string {
  return join(getConfigDir(), 'wechat.json')
}

/**
 * 获取微信长轮询同步游标路径
 *
 * @returns ~/.proma/wechat-sync.json
 */
export function getWeChatSyncPath(): string {
  return join(getConfigDir(), 'wechat-sync.json')
}

/**
 * 获取微信聊天绑定持久化路径
 *
 * @returns ~/.proma/wechat-bindings.json
 */
export function getWeChatBindingsPath(): string {
  return join(getConfigDir(), 'wechat-bindings.json')
}

/**
 * 获取钉钉配置文件路径
 *
 * @returns ~/.proma/dingtalk.json
 */
export function getDingTalkConfigPath(): string {
  return join(getConfigDir(), 'dingtalk.json')
}

/**
 * 获取某个钉钉 Bot 的聊天绑定持久化路径
 *
 * @returns ~/.proma/dingtalk-bindings-{botId}.json
 */
export function getDingTalkBotBindingsPath(botId: string): string {
  return join(getConfigDir(), `dingtalk-bindings-${botId}.json`)
}

/**
 * 获取飞书配置文件路径
 *
 * @returns ~/.proma/feishu.json
 */
export function getFeishuConfigPath(): string {
  return join(getConfigDir(), 'feishu.json')
}

/**
 * 获取飞书聊天绑定持久化路径
 *
 * @returns ~/.proma/feishu-bindings.json
 */
export function getFeishuBindingsPath(): string {
  return join(getConfigDir(), 'feishu-bindings.json')
}

/**
 * 获取某个飞书 Bot 的聊天绑定持久化路径
 *
 * @returns ~/.proma/feishu-bindings-{botId}.json
 */
export function getFeishuBotBindingsPath(botId: string): string {
  return join(getConfigDir(), `feishu-bindings-${botId}.json`)
}

/**
 * 获取某个飞书 Bot 的运行时元数据持久化路径
 *
 * 用于保存最近交互用户 open_id 等需要跨进程重启恢复的状态。
 *
 * @returns ~/.proma/feishu-metadata-{botId}.json
 */
export function getFeishuBotMetadataPath(botId: string): string {
  return join(getConfigDir(), `feishu-metadata-${botId}.json`)
}

/**
 * 获取指定 Agent 会话的工作路径
 *
 * 在工作区目录下创建以 sessionId 命名的子文件夹，
 * 作为该会话的独立 Agent cwd。如果目录不存在则自动创建。
 *
 * @param workspaceSlug 工作区 slug
 * @param sessionId 会话 ID
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/agent-workspaces/{slug}/{sessionId}/；有 scope: {dataRoot}/users/{userId}/agent-workspaces/{slug}/{sessionId}/
 */
export function getAgentSessionWorkspacePath(workspaceSlug: string, sessionId: string, scope?: UserScope): string {
  const base = scope
    ? join(getUserSessionWorkspacesDir(scope), workspaceSlug)
    : getAgentWorkspacePath(workspaceSlug)
  const dir = join(base, sessionId)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 会话工作目录: ${dir}`)
  }

  return dir
}

/**
 * 获取 SDK 隔离配置目录路径
 *
 * 用于设置 CLAUDE_CONFIG_DIR 环境变量，让 SDK 读取独立的配置文件，
 * 而不是用户的 ~/.claude.json，实现 Proma 与 Claude Code CLI 的配置隔离。
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.proma/sdk-config/
 */
export function getSdkConfigDir(): string {
  const dir = join(getDataRoot(), 'sdk-config')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 SDK 配置目录: ${dir}`)
  }

  return dir
}

/**
 * 获取 Scratch Pad 文件路径
 *
 * @param scope 可选用户作用域；传入时定位到该用户私有目录
 * @returns 无 scope: ~/.proma/scratch-pad.md；有 scope: {dataRoot}/users/{userId}/scratch-pad.md
 */
export function getScratchPadPath(scope?: UserScope): string {
  const base = scope ? getUserDataDir(scope) : getConfigDir()
  return join(base, 'scratch-pad.md')
}

/**
 * 获取定时任务（Automation）配置文件路径
 *
 * @returns ~/.proma/automations.json
 */
export function getAutomationsPath(): string {
  return join(getDataRoot(), 'automations.json')
}
