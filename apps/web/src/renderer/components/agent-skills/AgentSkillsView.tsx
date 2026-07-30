/**
 * AgentSkillsView — 「Agent 技能」全屏视图
 *
 * 由侧边栏「Agent 技能」入口触发，全屏占据中间内容区（隐藏 TabBar 与右侧文件面板）。
 *
 * 结构：
 * - 顶部：标题 + 工作区切换下拉
 * - 工具条：Skills / MCP 切换 + 搜索 + 社区市场（占位）+ 新增入口
 * - 内容：能力卡片网格（商店风），点击卡片打开右侧详情抽屉
 */

import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { Blocks, ChevronDown, ChevronRight, Search, Plus, Upload, FolderOpen, Check, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { agentSkillsTabAtom } from '@/atoms/active-view'
import { settingsOpenAtom, settingsTabAtom, toolSettingsFocusAtom, type ToolSettingsFocus } from '@/atoms/settings-tab'
import { canManageAtom } from '@/atoms/auth'
import { useProjectActions } from '@/hooks/useProjectActions'
import type { BuiltinMcpServerSummary, McpServerEntry, SkillMeta, SkillsGroupConfig } from '@proma/shared'
import { useAgentSkillsData } from './useAgentSkillsData'
import { SkillCard } from './SkillCard'
import { McpCard } from './McpCard'
import { SkillDetailSheet } from './SkillDetailSheet'
import { McpDetailSheet } from './McpDetailSheet'
import { BuiltinMcpDetailSheet } from './BuiltinMcpDetailSheet'
import { WorkspaceMemoryTab } from './WorkspaceMemoryTab'
import { groupUserSkills, type UserSkillGroup } from './skillGrouping'

export function AgentSkillsView(): React.ReactElement {
  const data = useAgentSkillsData()
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setToolSettingsFocus = useSetAtom(toolSettingsFocusAtom)
  const { workspaces, currentWorkspaceId, selectProject } = useProjectActions()

  const [tab, setTab] = useAtom(agentSkillsTabAtom)
  const [search, setSearch] = React.useState('')
  const [selectedSkillSlug, setSelectedSkillSlug] = React.useState<string | null>(null)
  const [mcpSheetOpen, setMcpSheetOpen] = React.useState(false)
  const [editingMcp, setEditingMcp] = React.useState<{ name: string; entry: McpServerEntry } | null>(null)
  const [selectedBuiltinMcp, setSelectedBuiltinMcp] = React.useState<BuiltinMcpServerSummary | null>(null)
  const [wsPopoverOpen, setWsPopoverOpen] = React.useState(false)
  const [pendingDeleteSkill, setPendingDeleteSkill] = React.useState<SkillMeta | null>(null)
  const [pendingDeleteMcpName, setPendingDeleteMcpName] = React.useState<string | null>(null)
  const [isDeletingSkill, setIsDeletingSkill] = React.useState(false)
  const [isDeletingMcp, setIsDeletingMcp] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [newGroupName, setNewGroupName] = React.useState('')
  const [renamingGroup, setRenamingGroup] = React.useState<{ id: string; name: string } | null>(null)
  const [pendingDeleteGroup, setPendingDeleteGroup] = React.useState<{ id: string; name: string } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const q = search.trim().toLowerCase()

  const filteredSkills = React.useMemo(() => {
    return data.skills.filter((s) => {
      if (!q) return true
      return s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.group ?? '').toLowerCase().includes(q)
    })
  }, [data.skills, q])

  const customSkills = filteredSkills.filter((s) => !data.defaultSkillSlugs.has(s.slug))
  const builtinSkills = filteredSkills.filter((s) => data.defaultSkillSlugs.has(s.slug))

  const userMcpEntries = React.useMemo(() => {
    return Object.entries(data.mcpConfig.servers ?? {})
      .filter(([name]) => name !== 'memos-cloud')
      .filter(([name]) => !q || name.toLowerCase().includes(q))
  }, [data.mcpConfig, q])

  const builtinMcpServers = React.useMemo(() => {
    if (!q) return data.builtinMcpServers
    return data.builtinMcpServers.filter((server) =>
      server.name.toLowerCase().includes(q) ||
      server.displayName.toLowerCase().includes(q) ||
      server.description.toLowerCase().includes(q) ||
      server.tools.some((tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q)),
    )
  }, [data.builtinMcpServers, q])

  // 不含搜索过滤的 MCP 总数（Tab 计数与空态判断用）
  const mcpCount = React.useMemo(
    () => Object.keys(data.mcpConfig.servers ?? {}).filter((n) => n !== 'memos-cloud').length + data.builtinMcpServers.length,
    [data.mcpConfig, data.builtinMcpServers],
  )
  const memoryCount = (data.capabilities?.memory.claudeMd.exists ? 1 : 0) + (data.capabilities?.memory.autoMemory.fileCount ?? 0)

  // MCP 配置为管理员专属（全局共享资源），普通用户隐藏 MCP tab
  const canManage = useAtomValue(canManageAtom)
  const tabs = [
    { value: 'skills' as const, label: 'Skills', count: data.skills.filter((s) => s.enabled).length },
    ...(canManage ? [{ value: 'mcp' as const, label: 'MCP', count: mcpCount }] : []),
    { value: 'memory' as const, label: '记忆', count: memoryCount },
  ]
  const activeTabIndex = Math.max(0, tabs.findIndex((t) => t.value === tab))
  React.useEffect(() => {
    // 角色非管理员但持久化 tab 为 mcp 时，回退到 skills
    if (!canManage && tab === 'mcp') setTab('skills')
  }, [canManage, tab, setTab])

  const selectedSkill = data.skills.find((s) => s.slug === selectedSkillSlug) ?? null
  const selectedIsBuiltin = selectedSkill ? data.defaultSkillSlugs.has(selectedSkill.slug) : false

  const openSkillFolder = (slug: string): void => {
    if (data.skillsDir) window.electronAPI.openFile(`${data.skillsDir}/${slug}`)
  }

  const configureBuiltinMcp = React.useCallback((serverId: string): void => {
    const focusMap: Partial<Record<string, ToolSettingsFocus>> = {
      mem: 'memory',
    }
    const focus = focusMap[serverId]
    if (!focus) return
    setToolSettingsFocus(focus)
    setSettingsTab('tools')
    setSettingsOpen(true)
    setSelectedBuiltinMcp(null)
  }, [setSettingsOpen, setSettingsTab, setToolSettingsFocus])

  const handleUploadClick = (): void => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!file) return
    setIsUploading(true)
    try {
      await data.uploadSkill(file)
    } finally {
      setIsUploading(false)
    }
  }

  const handleCreateGroup = async (): Promise<void> => {
    const name = newGroupName.trim()
    if (!name) return
    await data.createGroup(name)
    setNewGroupName('')
  }

  const handleCommitRenameGroup = async (): Promise<void> => {
    if (!renamingGroup) return
    const name = renamingGroup.name.trim()
    if (!name) { setRenamingGroup(null); return }
    await data.renameGroup(renamingGroup.id, name)
    setRenamingGroup(null)
  }

  const handleDeleteGroup = async (): Promise<void> => {
    if (!pendingDeleteGroup) return
    await data.deleteGroup(pendingDeleteGroup.id)
    setPendingDeleteGroup(null)
  }

  if (!data.hasWorkspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
          <Blocks className="size-8 text-foreground/30" />
        </div>
        <div className="text-[15px] font-medium text-foreground/80">未选择工作区</div>
        <div className="max-w-sm text-[13px] text-foreground/50">
          请先在 Agent 模式下选择或创建一个工作区，再来管理它的 Skills 与 MCP。
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标题栏 + 工作区切换 */}
      {/* 不加 titlebar-drag-region：与 DropdownMenu 嵌套时 drag/no-drag 会让 Radix 拿不到
          pointerdown，下拉打不开。窗口拖拽由 AppShell 顶部 0–50px 的全局 drag 层兜底。
          pt-14 让按钮整体位于全局 drag 层（0–50px, z-50）下方，避免被吃掉点击。 */}
      <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-8 pt-14 pb-4">
        <div className="flex items-center gap-2.5">
          <Blocks className="size-6 text-foreground/70" />
          <h1 className="text-2xl font-semibold text-foreground">Agent 技能</h1>
        </div>

        <Popover open={wsPopoverOpen} onOpenChange={setWsPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="titlebar-no-drag flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.04]"
            >
              <FolderOpen size={14} className="text-foreground/45" />
              <span className="max-w-[180px] truncate">{data.workspaceName}</span>
              <ChevronDown size={14} className="text-foreground/45" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[320px] w-56 overflow-y-auto scrollbar-thin p-1">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  if (w.id !== currentWorkspaceId) {
                    selectProject(w.id, { resetView: false })
                    toast.success(`已切换到工作区「${w.name}」`)
                  }
                  setWsPopoverOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                  w.id === currentWorkspaceId
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/50',
                )}
              >
                <span className="truncate">{w.name}</span>
                {w.id === currentWorkspaceId && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* 工具条 */}
      <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center gap-3 px-8 pb-4">
        {/* Skills / MCP / 记忆切换 */}
        <div className="relative flex h-8 items-stretch rounded-xl bg-muted p-0.5">
          <div
            className="absolute bottom-0.5 top-0.5 rounded-lg bg-background shadow-sm transition-transform duration-300 ease-in-out"
            style={{
              width: `calc(${100 / tabs.length}% - 3px)`,
              transform: `translateX(${activeTabIndex * 100}%)`,
            }}
          />
          {tabs.map(({ value, label, count }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'relative z-[1] flex min-w-[96px] flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors duration-200',
                tab === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 transition-colors focus-within:border-primary/40">
          <Search size={14} className="shrink-0 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'skills' ? '搜索 Skills...' : tab === 'mcp' ? '搜索 MCP 服务器...' : '搜索记忆文件...'}
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none"
          />
        </div>

        {/* Skills：上传 zip 技能包 */}
        {tab === 'skills' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={isUploading}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              <span>{isUploading ? '上传中...' : '上传技能'}</span>
            </button>
          </>
        )}

        {/* 新增 MCP */}
        {tab === 'mcp' && (
          <button
            type="button"
            onClick={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>添加服务器</span>
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-6xl px-8 pb-10">
          {data.loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
          ) : tab === 'skills' ? (
            <SkillsTab
              customSkills={customSkills}
              builtinSkills={builtinSkills}
              groupsConfig={data.groupsConfig}
              total={data.skills.length}
              isBuiltin={(slug) => data.defaultSkillSlugs.has(slug)}
              onOpen={setSelectedSkillSlug}
              onToggle={data.toggleSkill}
              newGroupName={newGroupName}
              setNewGroupName={setNewGroupName}
              onCreateGroup={handleCreateGroup}
              renamingGroup={renamingGroup}
              setRenamingGroup={setRenamingGroup}
              onCommitRenameGroup={handleCommitRenameGroup}
              onRequestDeleteGroup={(id, name) => setPendingDeleteGroup({ id, name })}
            />
          ) : tab === 'mcp' ? (
            <McpTab
              userEntries={userMcpEntries}
              builtinServers={builtinMcpServers}
              total={mcpCount}
              onOpen={(name, entry) => { setEditingMcp({ name, entry }); setMcpSheetOpen(true) }}
              onOpenBuiltin={setSelectedBuiltinMcp}
              onToggle={data.toggleMcp}
              onToggleBuiltin={data.toggleBuiltinMcp}
              onRequestDelete={setPendingDeleteMcpName}
              onAdd={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
            />
          ) : (
            <WorkspaceMemoryTab workspaceSlug={data.workspaceSlug} search={search} />
          )}
        </div>
      </div>

      {/* 详情抽屉 */}
      <SkillDetailSheet
        skill={selectedSkill}
        workspaceSlug={data.workspaceSlug}
        isBuiltin={selectedIsBuiltin}
        groupsConfig={data.groupsConfig}
        onOpenChange={(open) => { if (!open) setSelectedSkillSlug(null) }}
        onToggle={(enabled) => selectedSkill && data.toggleSkill(selectedSkill.slug, enabled)}
        onSetAssignment={(groupId) => selectedSkill && data.setSkillAssignment(selectedSkill.slug, groupId)}
        onRequestDelete={() => selectedSkill && setPendingDeleteSkill(selectedSkill)}
        onOpenFolder={() => selectedSkill && openSkillFolder(selectedSkill.slug)}
        onChanged={() => bumpCapabilities((v) => v + 1)}
      />

      {/* Skill 删除确认 */}
      <ConfirmDialog
        open={pendingDeleteSkill !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteSkill(null) }}
        title={`确认删除 Skill「${pendingDeleteSkill?.name}」？`}
        description="删除后将无法恢复，确定要卸载这个 Skill 吗？"
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingSkill}
        onConfirm={async () => {
          if (!pendingDeleteSkill || isDeletingSkill) return
          setIsDeletingSkill(true)
          const ok = await data.deleteSkill(pendingDeleteSkill.slug, pendingDeleteSkill.name)
          setIsDeletingSkill(false)
          setPendingDeleteSkill(null)
          if (ok) setSelectedSkillSlug(null)
        }}
      />

      {/* MCP 删除确认 */}
      <ConfirmDialog
        open={pendingDeleteMcpName !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteMcpName(null) }}
        title={`确认删除 MCP 服务器「${pendingDeleteMcpName}」？`}
        description="删除后将无法恢复，确定要删除这个 MCP 服务器吗？"
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingMcp}
        onConfirm={async () => {
          if (!pendingDeleteMcpName || isDeletingMcp) return
          setIsDeletingMcp(true)
          await data.deleteMcp(pendingDeleteMcpName)
          setIsDeletingMcp(false)
          setPendingDeleteMcpName(null)
        }}
      />

      <McpDetailSheet
        open={mcpSheetOpen}
        server={editingMcp}
        workspaceSlug={data.workspaceSlug}
        onOpenChange={(open) => { setMcpSheetOpen(open); if (!open) bumpCapabilities((v) => v + 1) }}
        onSaved={() => setMcpSheetOpen(false)}
        onChanged={() => bumpCapabilities((v) => v + 1)}
      />

      <BuiltinMcpDetailSheet
        open={!!selectedBuiltinMcp}
        server={selectedBuiltinMcp}
        onOpenChange={(open) => { if (!open) setSelectedBuiltinMcp(null) }}
        onConfigure={configureBuiltinMcp}
      />

      {/* 分组删除确认 */}
      <ConfirmDialog
        open={pendingDeleteGroup !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteGroup(null) }}
        title={`确认删除分组「${pendingDeleteGroup?.name}」？`}
        description="组内技能将自动归入「未分组」，不会删除技能本身。"
        confirmLabel="删除"
        onConfirm={handleDeleteGroup}
      />
    </div>
  )
}

// ===== Skills Tab =====

interface SkillsTabProps {
  customSkills: SkillMeta[]
  builtinSkills: SkillMeta[]
  groupsConfig: SkillsGroupConfig
  total: number
  isBuiltin: (slug: string) => boolean
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  newGroupName: string
  setNewGroupName: (v: string) => void
  onCreateGroup: () => void
  renamingGroup: { id: string; name: string } | null
  setRenamingGroup: (v: { id: string; name: string } | null) => void
  onCommitRenameGroup: () => void
  onRequestDeleteGroup: (id: string, name: string) => void
}

function SkillsTab(props: SkillsTabProps): React.ReactElement {
  if (props.total === 0) {
    return <EmptyState icon={<Blocks className="size-8 text-foreground/30" />} title="暂无 Skill" hint="点击右上角「上传技能」，上传 zip 技能包来安装用户技能。" />
  }
  if (props.customSkills.length === 0 && props.builtinSkills.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 Skill" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {props.customSkills.length > 0 && (
        <UserSkillsSection
          skills={props.customSkills}
          groupsConfig={props.groupsConfig}
          isBuiltin={props.isBuiltin}
          onOpen={props.onOpen}
          onToggle={props.onToggle}
          newGroupName={props.newGroupName}
          setNewGroupName={props.setNewGroupName}
          onCreateGroup={props.onCreateGroup}
          renamingGroup={props.renamingGroup}
          setRenamingGroup={props.setRenamingGroup}
          onCommitRenameGroup={props.onCommitRenameGroup}
          onRequestDeleteGroup={props.onRequestDeleteGroup}
        />
      )}
      {props.builtinSkills.length > 0 && (
        <BuiltinSkillsSection
          skills={props.builtinSkills}
          isBuiltin={props.isBuiltin}
          onOpen={props.onOpen}
          onToggle={props.onToggle}
        />
      )}
    </div>
  )
}

/** 内置技能：平铺卡片网格，仅启用/禁用，不分组 */
function BuiltinSkillsSection({
  skills,
  isBuiltin,
  onOpen,
  onToggle,
}: {
  skills: SkillMeta[]
  isBuiltin: (slug: string) => boolean
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">PROMA 内置</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{skills.length}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((skill) => (
          <SkillCard
            key={skill.slug}
            skill={skill}
            isBuiltin={isBuiltin(skill.slug)}
            onOpen={() => onOpen(skill.slug)}
            onToggle={(enabled) => onToggle(skill.slug, enabled)}
          />
        ))}
      </div>
    </div>
  )
}

/** 用户技能：按 groupsConfig 分组折叠展示，支持新建/重命名/删除分组 */
function UserSkillsSection({
  skills,
  groupsConfig,
  isBuiltin,
  onOpen,
  onToggle,
  newGroupName,
  setNewGroupName,
  onCreateGroup,
  renamingGroup,
  setRenamingGroup,
  onCommitRenameGroup,
  onRequestDeleteGroup,
}: Omit<SkillsTabProps, 'customSkills' | 'builtinSkills' | 'total'> & { skills: SkillMeta[] }): React.ReactElement {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
  const groups = React.useMemo(() => groupUserSkills(skills, groupsConfig), [skills, groupsConfig])

  const toggleGroup = (key: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">用户技能</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{skills.length}</span>
        {/* 新建分组 */}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onCreateGroup() }}
            placeholder="新分组名称"
            className="h-8 w-44 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
          />
          <button
            type="button"
            onClick={() => void onCreateGroup()}
            disabled={!newGroupName.trim()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            <Plus size={14} />
            <span>新建分组</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const key = g.group?.id ?? '__ungrouped__'
          const collapsed = collapsedGroups.has(key)
          const isUngrouped = g.group === null
          const isRenaming = !!g.group && renamingGroup?.id === g.group.id
          return (
            <div key={key} className="group/row flex flex-col gap-3">
              <div className="flex h-8 items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  className="flex items-center gap-2 rounded-lg text-left text-[13px] font-medium text-foreground/65 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                >
                  <ChevronRight size={14} className={cn('text-foreground/35 transition-transform', !collapsed && 'rotate-90')} />
                  {isRenaming && g.group ? (
                    <input
                      autoFocus
                      value={renamingGroup!.name}
                      onChange={(e) => setRenamingGroup({ id: g.group!.id, name: e.target.value })}
                      onBlur={() => void onCommitRenameGroup()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void onCommitRenameGroup()
                        else if (e.key === 'Escape') setRenamingGroup(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border border-border bg-background px-1 text-[13px]"
                    />
                  ) : (
                    <span>{isUngrouped ? '未分组' : g.group!.name}</span>
                  )}
                  <span className="text-[12px] tabular-nums text-foreground/35">{g.skills.length}</span>
                </button>
                {!isUngrouped && !isRenaming && g.group && (
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
                    <button
                      type="button"
                      onClick={() => setRenamingGroup({ id: g.group!.id, name: g.group!.name })}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="重命名分组"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteGroup(g.group!.id, g.group!.name)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      title="删除分组"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              {!collapsed && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.skills.map((skill) => (
                    <SkillCard
                      key={skill.slug}
                      skill={skill}
                      isBuiltin={isBuiltin(skill.slug)}
                      onOpen={() => onOpen(skill.slug)}
                      onToggle={(enabled) => onToggle(skill.slug, enabled)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===== MCP Tab =====

interface McpTabProps {
  userEntries: Array<[string, McpServerEntry]>
  builtinServers: BuiltinMcpServerSummary[]
  total: number
  onOpen: (name: string, entry: McpServerEntry) => void
  onOpenBuiltin: (server: BuiltinMcpServerSummary) => void
  onToggle: (name: string, enabled: boolean) => void
  onToggleBuiltin: (id: string, enabled: boolean) => void
  onRequestDelete: (name: string) => void
  onAdd: () => void
}

function McpTab({ userEntries, builtinServers, total, onOpen, onOpenBuiltin, onToggle, onToggleBuiltin, onRequestDelete, onAdd }: McpTabProps): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState
        icon={<Plus className="size-8 text-foreground/30" />}
        title="还没有 MCP 服务器"
        hint="点击右上角「添加服务器」开始，或在 Agent 模式下让 Proma 帮你查找并配置。"
        action={
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>添加服务器</span>
          </button>
        }
      />
    )
  }
  if (userEntries.length === 0 && builtinServers.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 MCP 服务器" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {userEntries.length > 0 && (
        <McpSection title="我的 MCP" count={userEntries.length}>
          {userEntries.map(([name, entry]) => (
            <McpCard
              key={name}
              name={name}
              entry={entry}
              onOpen={() => onOpen(name, entry)}
              onToggle={(enabled) => onToggle(name, enabled)}
              onRequestDelete={() => onRequestDelete(name)}
            />
          ))}
        </McpSection>
      )}

      {builtinServers.length > 0 && (
        <McpSection title="Proma 内置" count={builtinServers.length}>
          {builtinServers.map((server) => (
            <McpCard
              key={server.id}
              name={server.displayName}
              entry={{
                type: 'stdio',
                command: 'Proma 运行时注入',
                enabled: server.enabled,
                isBuiltin: true,
              }}
              description={server.description}
              targetLabel={server.availabilityReason ?? 'Proma 运行时注入'}
              statusLabel={getBuiltinMcpStatus(server).label}
              statusTone={getBuiltinMcpStatus(server).tone}
              readOnly
              onOpen={() => onOpenBuiltin(server)}
              onToggle={(enabled) => onToggleBuiltin(server.id, enabled)}
            />
          ))}
        </McpSection>
      )}
    </div>
  )
}

function getBuiltinMcpStatus(server: BuiltinMcpServerSummary): { label: string; tone: 'success' | 'warning' | 'muted' } {
  if (!server.enabled) return { label: '已关闭', tone: 'muted' }
  if (server.available) return { label: '可用', tone: 'success' }
  return { label: '需配置', tone: 'warning' }
}

function McpSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">{title}</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{count}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </div>
  )
}

// ===== Empty State =====

function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">{icon}</div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">{title}</div>
        <div className="text-[13px] leading-relaxed text-foreground/50">{hint}</div>
      </div>
      {action}
    </div>
  )
}
