/**
 * useAgentSkillsData — Agent 技能视图的数据层
 *
 * 封装当前工作区 Skills / MCP 的加载与增删改逻辑（IPC 调用），
 * 供「Agent 技能」全屏视图复用。所有写操作后会 bump
 * workspaceCapabilitiesVersionAtom，通知侧边栏等订阅方刷新。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import type { BuiltinMcpServerSummary, SkillsGroupConfig, SkillMeta, WorkspaceCapabilities, WorkspaceMcpConfig } from '@proma/shared'

export interface AgentSkillsData {
  /** 当前工作区（未选中时为 null） */
  workspaceSlug: string
  workspaceName: string
  hasWorkspace: boolean
  loading: boolean
  skills: SkillMeta[]
  defaultSkillSlugs: Set<string>
  skillsDir: string
  /** 用户技能分组配置（groups + assignments） */
  groupsConfig: SkillsGroupConfig
  mcpConfig: WorkspaceMcpConfig
  capabilities: WorkspaceCapabilities | null
  builtinMcpServers: BuiltinMcpServerSummary[]
  toggleSkill: (slug: string, enabled: boolean) => Promise<void>
  deleteSkill: (slug: string, name: string) => Promise<boolean>
  uploadSkill: (file: File) => Promise<number>
  createGroup: (name: string) => Promise<void>
  renameGroup: (groupId: string, name: string) => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  setSkillAssignment: (slug: string, groupId: string | null) => Promise<void>
  toggleMcp: (name: string, enabled: boolean) => Promise<void>
  toggleBuiltinMcp: (id: string, enabled: boolean) => Promise<void>
  deleteMcp: (name: string) => Promise<void>
}

export function useAgentSkillsData(): AgentSkillsData {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? ''

  const [loading, setLoading] = React.useState(true)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [defaultSkillSlugs, setDefaultSkillSlugs] = React.useState<Set<string>>(new Set())
  const [skillsDir, setSkillsDir] = React.useState('')
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const [builtinMcpServers, setBuiltinMcpServers] = React.useState<BuiltinMcpServerSummary[]>([])
  const [groupsConfig, setGroupsConfig] = React.useState<SkillsGroupConfig>({ groups: [], assignments: {} })

  const loadData = React.useCallback(async () => {
    if (!workspaceSlug) {
      setSkills([])
      setMcpConfig({ servers: {} })
      setCapabilities(null)
      setBuiltinMcpServers([])
      setGroupsConfig({ groups: [], assignments: {} })
      setLoading(false)
      return
    }
    try {
      const [config, skillList, dir, defaultSlugs, capabilities, groupsCfg] = await Promise.all([
        window.electronAPI.getWorkspaceMcpConfig(workspaceSlug),
        window.electronAPI.getWorkspaceSkills(workspaceSlug),
        window.electronAPI.getWorkspaceSkillsDir(workspaceSlug),
        window.electronAPI.getDefaultSkillSlugs(),
        window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
        window.electronAPI.getSkillGroups(workspaceSlug),
      ])
      setMcpConfig(config)
      setSkills(skillList)
      setSkillsDir(dir)
      setDefaultSkillSlugs(new Set(defaultSlugs))
      setCapabilities(capabilities)
      setBuiltinMcpServers(capabilities.builtinMcpServers)
      setGroupsConfig(groupsCfg)
    } catch (error) {
      console.error('[Agent 技能] 加载工作区配置失败:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug])

  // workspaceSlug 或外部能力版本变化时重新拉取
  React.useEffect(() => {
    setLoading(true)
    void loadData()
  }, [loadData, capabilitiesVersion])

  const toggleSkill = React.useCallback(async (slug: string, enabled: boolean) => {
    try {
      await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, slug, enabled)
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled } : s)))
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 技能] 切换 Skill 状态失败:', error)
      toast.error('切换 Skill 状态失败')
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const deleteSkill = React.useCallback(async (slug: string, name: string): Promise<boolean> => {
    try {
      await window.electronAPI.deleteWorkspaceSkill(workspaceSlug, slug)
      setSkills((prev) => prev.filter((s) => s.slug !== slug))
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 Skill：${name}`)
      return true
    } catch (error) {
      console.error('[Agent 技能] 删除 Skill 失败:', error)
      toast.error('删除 Skill 失败')
      return false
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const uploadSkill = React.useCallback(async (file: File): Promise<number> => {
    if (!workspaceSlug) return 0
    try {
      const { skills: installed } = await window.electronAPI.uploadSkillZip(workspaceSlug, file)
      // 重新拉取技能列表，保持与后端一致
      const skillList = await window.electronAPI.getWorkspaceSkills(workspaceSlug)
      setSkills(skillList)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已安装 ${installed.length} 个技能：${file.name}`)
      return installed.length
    } catch (error) {
      console.error('[Agent 技能] 上传 Skill 失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('上传 Skill 失败', { description: message })
      return 0
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const createGroup = React.useCallback(async (name: string): Promise<void> => {
    if (!workspaceSlug) return
    try {
      const group = await window.electronAPI.createSkillGroup(workspaceSlug, name)
      setGroupsConfig((prev) => ({ ...prev, groups: [...prev.groups, group] }))
      toast.success(`已新建分组：${group.name}`)
    } catch (error) {
      console.error('[Agent 技能] 新建分组失败:', error)
      toast.error(error instanceof Error ? error.message : '新建分组失败')
    }
  }, [workspaceSlug])

  const renameGroup = React.useCallback(async (groupId: string, name: string): Promise<void> => {
    if (!workspaceSlug) return
    try {
      await window.electronAPI.renameSkillGroup(workspaceSlug, groupId, name)
      setGroupsConfig((prev) => ({
        ...prev,
        groups: prev.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
      }))
    } catch (error) {
      console.error('[Agent 技能] 重命名分组失败:', error)
      toast.error(error instanceof Error ? error.message : '重命名分组失败')
    }
  }, [workspaceSlug])

  const deleteGroup = React.useCallback(async (groupId: string): Promise<void> => {
    if (!workspaceSlug) return
    try {
      await window.electronAPI.deleteSkillGroup(workspaceSlug, groupId)
      setGroupsConfig((prev) => ({
        groups: prev.groups.filter((g) => g.id !== groupId),
        assignments: Object.fromEntries(Object.entries(prev.assignments).filter(([, gid]) => gid !== groupId)),
      }))
      toast.success('已删除分组')
    } catch (error) {
      console.error('[Agent 技能] 删除分组失败:', error)
      toast.error(error instanceof Error ? error.message : '删除分组失败')
    }
  }, [workspaceSlug])

  const setSkillAssignment = React.useCallback(async (slug: string, groupId: string | null): Promise<void> => {
    if (!workspaceSlug) return
    try {
      await window.electronAPI.setSkillAssignment(workspaceSlug, slug, groupId)
      setGroupsConfig((prev) => {
        const assignments = { ...prev.assignments }
        if (groupId) assignments[slug] = groupId
        else delete assignments[slug]
        return { ...prev, assignments }
      })
    } catch (error) {
      console.error('[Agent 技能] 调整分组失败:', error)
      toast.error(error instanceof Error ? error.message : '调整分组失败')
    }
  }, [workspaceSlug])

  const toggleMcp = React.useCallback(async (name: string, enabled: boolean) => {
    try {
      const entry = mcpConfig.servers[name]
      if (!entry) return
      const newConfig: WorkspaceMcpConfig = {
        servers: { ...mcpConfig.servers, [name]: { ...entry, enabled } },
      }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 技能] 切换 MCP 服务器状态失败:', error)
      toast.error('切换 MCP 状态失败')
    }
  }, [workspaceSlug, mcpConfig, bumpCapabilitiesVersion])

  const toggleBuiltinMcp = React.useCallback(async (id: string, enabled: boolean) => {
    try {
      const capabilities = await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, id, enabled)
      setCapabilities(capabilities)
      setBuiltinMcpServers(capabilities.builtinMcpServers)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(enabled ? '已启用内置 MCP' : '已关闭内置 MCP')
    } catch (error) {
      console.error('[Agent 技能] 切换内置 MCP 状态失败:', error)
      toast.error('切换内置 MCP 状态失败')
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const deleteMcp = React.useCallback(async (name: string) => {
    const entry = mcpConfig.servers[name]
    if (entry?.isBuiltin) return
    try {
      const newServers = { ...mcpConfig.servers }
      delete newServers[name]
      const newConfig: WorkspaceMcpConfig = { servers: newServers }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 MCP 服务器：${name}`)
    } catch (error) {
      console.error('[Agent 技能] 删除 MCP 服务器失败:', error)
      toast.error('删除 MCP 服务器失败')
    }
  }, [workspaceSlug, mcpConfig, bumpCapabilitiesVersion])

  return {
    workspaceSlug,
    workspaceName: currentWorkspace?.name ?? '',
    hasWorkspace: !!currentWorkspace,
    loading,
    skills,
    defaultSkillSlugs,
    skillsDir,
    groupsConfig,
    mcpConfig,
    capabilities,
    builtinMcpServers,
    toggleSkill,
    deleteSkill,
    uploadSkill,
    createGroup,
    renameGroup,
    deleteGroup,
    setSkillAssignment,
    toggleMcp,
    toggleBuiltinMcp,
    deleteMcp,
  }
}
