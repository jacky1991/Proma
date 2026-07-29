/**
 * Skills / Memory 用户级隔离数据迁移
 *
 * 方案 A（内置共享 + 用户自建隔离）上线前，把多用户改造前散落在工作区全局目录的
 *   agent-workspaces/{slug}/skills/            （内置副本 + 用户自建）
 *   agent-workspaces/{slug}/skills-inactive/   （禁用过的技能）
 *   agent-workspaces/{slug}/.claude/memory/    （个人 auto memory）
 * 迁移到首个管理员/default 用户的私有目录，并把"曾在 skills-inactive 的技能"写入该用户的
 * 启停黑名单（skills-state.json）。
 *
 * - 内置技能副本（slug ∈ default-skills）：删除（运行时改读全局 getDefaultSkillsDir）
 * - 用户自建技能：移动到 users/{ownerId}/agent-workspaces/{slug}/skills/
 * - CLAUDE.md：原地不动（工作区共享，仅管理员可编辑）
 *
 * 幂等：marker 文件存在则跳过；迁移以移动为主，失败可删除 marker 重跑。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  getDataRoot,
  getAgentWorkspacePath,
  getWorkspaceSkillsDir,
  getInactiveSkillsDir,
  getUserCustomSkillsDir,
  getUserAutoMemoryDir,
  getWorkspaceSkillsStatePath,
  type UserScope,
} from '../config-paths'
import { listAgentWorkspaces, getDefaultSkillSlugs } from '../agent-workspace-manager'
import { listUsers } from '../user-manager'
import { writeJsonFileAtomic } from '../safe-file'

const MARKER_FILE = '.skills-memory-migrated-v1'

export interface SkillsMemoryMigrationResult {
  migrated: boolean
  reason?: string
  workspacesProcessed: number
  ownerUserId?: string
}

/**
 * 执行 Skills / Memory 用户级隔离迁移。
 *
 * 在 server 启动、seedDefaultSkills() 之后调用。
 */
export function migrateSkillsMemoryToUserScope(): SkillsMemoryMigrationResult {
  const dataRoot = getDataRoot()
  const marker = join(dataRoot, MARKER_FILE)
  if (existsSync(marker)) {
    return { migrated: false, reason: 'already migrated', workspacesProcessed: 0 }
  }

  // 解析归属用户：优先 default，否则第一个 admin
  const users = listUsers()
  const owner = users.find((u) => u.id === 'default') ?? users.find((u) => u.role === 'admin')
  if (!owner) {
    console.warn('[迁移] 未找到 default/admin 用户，跳过 skills/memory 迁移（保留 legacy 目录作 fallback）')
    return { migrated: false, reason: 'no owner user', workspacesProcessed: 0 }
  }
  const scope: UserScope = { userId: owner.id, dataRoot }

  const builtinSlugs = new Set(getDefaultSkillSlugs())
  const workspaces = listAgentWorkspaces()
  let processed = 0

  for (const ws of workspaces) {
    const slug = ws.slug
    const sharedSkillsDir = getWorkspaceSkillsDir(slug)
    const sharedInactiveDir = getInactiveSkillsDir(slug)
    const userSkillsDir = getUserCustomSkillsDir(slug, scope)
    const sharedMemoryDir = join(getAgentWorkspacePath(slug), '.claude', 'memory')
    const userMemoryDir = getUserAutoMemoryDir(slug, scope)

    const disabledSlugs = new Set<string>()

    // 1. shared skills/（内置副本删除；自建移到用户目录）
    moveOrRemoveSkills(sharedSkillsDir, userSkillsDir, builtinSlugs, disabledSlugs, /* wasInactive */ false)

    // 2. shared skills-inactive/（禁用过的技能：自建移到用户目录并入黑名单；内置副本删除并入黑名单）
    moveOrRemoveSkills(sharedInactiveDir, userSkillsDir, builtinSlugs, disabledSlugs, /* wasInactive */ true)

    // 3. 写入 owner 的启停黑名单
    if (disabledSlugs.size > 0) {
      const statePath = getWorkspaceSkillsStatePath(slug, scope)
      mkdirSync(dirname(statePath), { recursive: true })
      writeJsonFileAtomic(statePath, { disabledSlugs: [...disabledSlugs], version: 1 })
    }

    // 4. auto memory 复制到用户目录（保留 shared 原件作 fallback，迁移后不再被读取）
    if (existsSync(sharedMemoryDir)) {
      mkdirSync(userMemoryDir, { recursive: true })
      copyDirContents(sharedMemoryDir, userMemoryDir)
    }

    processed += 1
  }

  writeFileSync(marker, new Date().toISOString())
  console.log(
    `[迁移] skills/memory 已迁移到用户目录: ${processed} 个工作区，owner=${owner.id}`,
  )
  return { migrated: true, workspacesProcessed: processed, ownerUserId: owner.id }
}

/** 遍历源目录下的技能：内置副本删除，自建移动到目标目录；wasInactive 时统一入黑名单 */
function moveOrRemoveSkills(
  srcDir: string,
  destDir: string,
  builtinSlugs: Set<string>,
  disabledSlugs: Set<string>,
  wasInactive: boolean,
): void {
  if (!existsSync(srcDir)) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(srcDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillSlug = entry.name
    const src = join(srcDir, skillSlug)

    if (builtinSlugs.has(skillSlug)) {
      // 内置副本：运行时改读全局 default-skills，删除工作区副本
      if (wasInactive) disabledSlugs.add(skillSlug)
      rmSync(src, { recursive: true, force: true })
      continue
    }

    // 自建技能：移动到用户目录
    const dst = join(destDir, skillSlug)
    if (existsSync(dst)) {
      // 已存在（可能上次迁移中断），跳过并清理源
      rmSync(src, { recursive: true, force: true })
    } else {
      mkdirSync(destDir, { recursive: true })
      try {
        renameSync(src, dst)
      } catch {
        // 跨文件系统等场景回退到复制+删除
        cpSync(src, dst, { recursive: true })
        rmSync(src, { recursive: true, force: true })
      }
    }
    if (wasInactive) disabledSlugs.add(skillSlug)
  }
}

/** 把 srcDir 下的内容复制到 destDir（已存在的目标跳过，不覆盖） */
function copyDirContents(srcDir: string, destDir: string): void {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(srcDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const src = join(srcDir, entry.name)
    const dst = join(destDir, entry.name)
    if (existsSync(dst)) continue
    try {
      cpSync(src, dst, { recursive: true })
    } catch (err) {
      console.warn(`[迁移] 复制 memory 文件失败: ${src}`, err)
    }
  }
}
