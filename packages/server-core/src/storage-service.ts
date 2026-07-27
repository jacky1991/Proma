/**
 * 存储管理服务
 *
 * 提供磁盘用量统计、孤儿数据检测和清理功能。
 * 零 Electron 依赖，Electron 端与 Web 服务端共用。
 *
 * 由设置面板"磁盘管理"Tab 和启动时自动清理逻辑调用。
 */

import { existsSync, statSync, unlinkSync } from 'node:fs'
import { rmSyncWithRetry } from './fs-retry'
import { promises as fsPromises } from 'node:fs'
import { join, basename, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getDataRoot,
  getAgentSessionsDir,
  getSdkConfigDir,
  getAgentWorkspacesDir,
  getAttachmentsDir,
  getConversationsDir,
  getUserSessionWorkspacesDir,
  type UserScope,
} from './config-paths'
import { listAgentSessions } from './agent-session-manager'
import { listAgentWorkspaces } from './agent-workspace-manager'

// ─── 类型定义 ───

export type StorageCategoryKey =
  | 'agent-sessions'
  | 'sdk-config'
  | 'workspaces'
  | 'conversations'
  | 'attachments'
  | 'temp-files'

export interface StorageCategory {
  label: string
  key: StorageCategoryKey
  bytes: number
  count: number
  hasOrphans: boolean
  orphanBytes: number
  orphanCount: number
  orphanItems: StorageOrphanItem[]
  orphanItemsTruncated: boolean
}

export interface StorageOrphanItem {
  kind: 'file' | 'directory'
  path: string
  bytes: number
  count: number
}

export interface StorageStats {
  categories: StorageCategory[]
  totalBytes: number
  calculatedAt: number
}

export interface CleanupOptions {
  categories: StorageCategoryKey[]
  orphansOnly: boolean
  archivedBeforeDays: number
}

export interface CleanupResult {
  freedBytes: number
  deletedCount: number
  errors: string[]
}

// ─── 工具函数 ───

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.nuxt', '.git', 'dist', 'build',
  '.cache', '__pycache__', '.venv', 'venv', '.tox', 'target', '.gradle',
  '.turbo', '.parcel-cache', '.svelte-kit', '.output',
])

const MAX_FILE_SCAN = 100_000
const MAX_ORPHAN_ITEM_PREVIEW = 80

const WORKSPACE_METADATA_DIRS = new Set([
  'workspace-files',
  'skills',
  'skills-inactive',
  '.claude',
  '.claude-plugin',
])

const PRESERVED_ORPHAN_SESSION_DIRS = new Set([
  '.context',
])

function isWorkspaceMetadataDir(entryName: string): boolean {
  return WORKSPACE_METADATA_DIRS.has(entryName)
}

function displayStoragePath(filePath: string): string {
  const root = getDataRoot()
  const rel = relative(root, filePath)
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    return `~/${basename(root)}/${rel.split(/[\\/]/).join('/')}`
  }
  return filePath
}

function addOrphanItem(items: StorageOrphanItem[], item: StorageOrphanItem): boolean {
  if (items.length >= MAX_ORPHAN_ITEM_PREVIEW) return true
  items.push(item)
  return false
}

async function getDirSize(
  dirPath: string,
  options: { skipTopLevelDirs?: Set<string> } = {}
): Promise<{ bytes: number; count: number }> {
  let bytes = 0
  let count = 0
  if (!existsSync(dirPath)) return { bytes, count }

  const limit = { remaining: MAX_FILE_SCAN }

  async function walk(dir: string, depth: number): Promise<void> {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (limit.remaining <= 0) return
        const fullPath = join(dir, entry.name)
        try {
          if (entry.isDirectory()) {
            if (depth === 0 && options.skipTopLevelDirs?.has(entry.name)) continue
            if (SKIP_DIRS.has(entry.name)) continue
            await walk(fullPath, depth + 1)
          } else if (entry.isFile()) {
            const stat = await fsPromises.stat(fullPath)
            bytes += stat.size
            count++
            limit.remaining--
          }
        } catch { /* 跳过不可访问的文件 */ }
      }
    } catch { /* 跳过不可访问的目录 */ }
  }

  await walk(dirPath, 0)
  return { bytes, count }
}

function safeUnlink(filePath: string): number {
  try {
    const size = statSync(filePath).size
    unlinkSync(filePath)
    return size
  } catch {
    return 0
  }
}

async function safeRmDir(dirPath: string): Promise<number> {
  try {
    const { bytes } = await getDirSize(dirPath)
    rmSyncWithRetry(dirPath, { recursive: true, force: true })
    return bytes
  } catch {
    return 0
  }
}

async function cleanupOrphanSessionWorkspaceDir(sessionDir: string): Promise<number> {
  let freedBytes = 0
  let deletedAny = false

  try {
    const entries = await fsPromises.readdir(sessionDir)
    for (const entry of entries) {
      if (PRESERVED_ORPHAN_SESSION_DIRS.has(entry)) continue
      const entryPath = join(sessionDir, entry)
      try {
        const stat = await fsPromises.lstat(entryPath)
        if (stat.isDirectory()) {
          freedBytes += await safeRmDir(entryPath)
          deletedAny = true
        } else if (stat.isFile()) {
          const freed = safeUnlink(entryPath)
          freedBytes += freed
          deletedAny = true
        }
      } catch { /* 跳过 */ }
    }

    const remaining = await fsPromises.readdir(sessionDir)
    if (remaining.length === 0) {
      rmSyncWithRetry(sessionDir, { recursive: true, force: true })
    }
  } catch {
    return 0
  }

  return deletedAny ? freedBytes : 0
}

// ─── 统计 ───

function getActiveSessionIds(scope?: UserScope): Set<string> {
  return new Set(listAgentSessions(scope).map((s) => s.id))
}

function getActiveSdkSessionIds(scope?: UserScope): Set<string> {
  const ids = new Set<string>()
  for (const s of listAgentSessions(scope)) {
    if (s.sdkSessionId) ids.add(s.sdkSessionId)
    if (s.forkSourceSdkSessionId) ids.add(s.forkSourceSdkSessionId)
  }
  return ids
}

function getActiveWorkspaceSlugs(): Set<string> {
  return new Set(listAgentWorkspaces().map((w) => w.slug))
}

async function calcAgentSessionsCategory(scope?: UserScope): Promise<StorageCategory> {
  const dir = getAgentSessionsDir(scope)
  const activeIds = getActiveSessionIds(scope)
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0
  const orphanItems: StorageOrphanItem[] = []
  let orphanItemsTruncated = false

  if (existsSync(dir)) {
    try {
      const files = await fsPromises.readdir(dir)
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const fullPath = join(dir, file)
        try {
          const stat = await fsPromises.stat(fullPath)
          const id = basename(file, '.jsonl')
          bytes += stat.size
          count++
          if (!activeIds.has(id)) {
            orphanBytes += stat.size
            orphanCount++
            orphanItemsTruncated = addOrphanItem(orphanItems, {
              kind: 'file',
              path: displayStoragePath(fullPath),
              bytes: stat.size,
              count: 1,
            }) || orphanItemsTruncated
          }
        } catch { /* 跳过 */ }
      }
    } catch { /* 跳过 */ }
  }

  return {
    label: 'Agent 会话记录',
    key: 'agent-sessions',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
    orphanItems, orphanItemsTruncated,
  }
}

async function calcSdkConfigCategory(scope?: UserScope): Promise<StorageCategory> {
  const sdkDir = getSdkConfigDir(scope)
  const activeSdkIds = getActiveSdkSessionIds(scope)
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0
  const orphanItems: StorageOrphanItem[] = []
  let orphanItemsTruncated = false

  const projectsDir = join(sdkDir, 'projects')
  if (existsSync(projectsDir)) {
    try {
      const hashDirs = await fsPromises.readdir(projectsDir)
      for (const hashDir of hashDirs) {
        const projPath = join(projectsDir, hashDir)
        try {
          if (!(await fsPromises.lstat(projPath)).isDirectory()) continue
          const files = await fsPromises.readdir(projPath)
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue
            const fullPath = join(projPath, file)
            try {
              const stat = await fsPromises.stat(fullPath)
              const sdkId = basename(file, '.jsonl')
              bytes += stat.size
              count++
              if (!activeSdkIds.has(sdkId)) {
                orphanBytes += stat.size
                orphanCount++
                orphanItemsTruncated = addOrphanItem(orphanItems, {
                  kind: 'file',
                  path: displayStoragePath(fullPath),
                  bytes: stat.size,
                  count: 1,
                }) || orphanItemsTruncated
              }
            } catch { /* 跳过 */ }
          }
        } catch { /* 跳过 */ }
      }
    } catch { /* 跳过 */ }
  }

  const fileHistoryDir = join(sdkDir, 'file-history')
  if (existsSync(fileHistoryDir)) {
    try {
      const sdkIds = await fsPromises.readdir(fileHistoryDir)
      for (const sdkId of sdkIds) {
        const histPath = join(fileHistoryDir, sdkId)
        try {
          if (!(await fsPromises.lstat(histPath)).isDirectory()) continue
          const sub = await getDirSize(histPath)
          bytes += sub.bytes
          count += sub.count
          if (!activeSdkIds.has(sdkId)) {
            orphanBytes += sub.bytes
            orphanCount += sub.count
            orphanItemsTruncated = addOrphanItem(orphanItems, {
              kind: 'directory',
              path: displayStoragePath(histPath),
              bytes: sub.bytes,
              count: sub.count,
            }) || orphanItemsTruncated
          }
        } catch { /* 跳过 */ }
      }
    } catch { /* 跳过 */ }
  }

  // sdk-config 其他子目录
  if (existsSync(sdkDir)) {
    try {
      const entries = await fsPromises.readdir(sdkDir)
      for (const entry of entries) {
        if (entry === 'projects' || entry === 'file-history') continue
        const fullPath = join(sdkDir, entry)
        try {
          const stat = await fsPromises.lstat(fullPath)
          if (stat.isDirectory()) {
            const sub = await getDirSize(fullPath)
            bytes += sub.bytes
            count += sub.count
          } else {
            bytes += stat.size
            count++
          }
        } catch { /* 跳过 */ }
      }
    } catch { /* 跳过 */ }
  }

  return {
    label: 'SDK 会话数据',
    key: 'sdk-config',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
    orphanItems, orphanItemsTruncated,
  }
}

async function calcWorkspacesCategory(scope?: UserScope): Promise<StorageCategory> {
  const wsDir = getAgentWorkspacesDir()
  const activeIds = getActiveSessionIds(scope)
  const activeSlugs = getActiveWorkspaceSlugs()
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0
  const orphanItems: StorageOrphanItem[] = []
  let orphanItemsTruncated = false

  if (existsSync(wsDir)) {
    try {
      const slugs = await fsPromises.readdir(wsDir)
      for (const slug of slugs) {
        const slugDir = join(wsDir, slug)
        try {
          if (!(await fsPromises.lstat(slugDir)).isDirectory()) continue
          const entries = await fsPromises.readdir(slugDir)
          for (const entry of entries) {
            const entryPath = join(slugDir, entry)
            try {
              const stat = await fsPromises.lstat(entryPath)
              if (!stat.isDirectory()) {
                if (stat.isFile()) {
                  bytes += stat.size
                  count++
                }
                continue
              }
              if (isWorkspaceMetadataDir(entry)) {
                const sub = await getDirSize(entryPath)
                bytes += sub.bytes
                count += sub.count
                continue
              }
              const sub = await getDirSize(entryPath)
              bytes += sub.bytes
              count += sub.count
              if (!activeIds.has(entry) && !activeSlugs.has(entry)) {
                const cleanable = await getDirSize(entryPath, { skipTopLevelDirs: PRESERVED_ORPHAN_SESSION_DIRS })
                if (cleanable.count > 0) {
                  orphanBytes += cleanable.bytes
                  orphanCount++
                  orphanItemsTruncated = addOrphanItem(orphanItems, {
                    kind: 'directory',
                    path: displayStoragePath(entryPath),
                    bytes: cleanable.bytes,
                    count: cleanable.count,
                  }) || orphanItemsTruncated
                }
              }
            } catch { /* 跳过 */ }
          }
        } catch { /* 跳过 */ }
      }
    } catch { /* 跳过 */ }
  }

  // 扫描用户级会话工作目录（迁移后新数据位于 {dataRoot}/users/{userId}/agent-workspaces/{slug}/{sessionId}/）
  if (scope) {
    const userWsDir = getUserSessionWorkspacesDir(scope)
    if (existsSync(userWsDir)) {
      try {
        const slugs = await fsPromises.readdir(userWsDir)
        for (const slug of slugs) {
          const slugDir = join(userWsDir, slug)
          try {
            if (!(await fsPromises.lstat(slugDir)).isDirectory()) continue
            const entries = await fsPromises.readdir(slugDir)
            for (const entry of entries) {
              const entryPath = join(slugDir, entry)
              try {
                if (!(await fsPromises.lstat(entryPath)).isDirectory()) continue
                const sub = await getDirSize(entryPath)
                bytes += sub.bytes
                count += sub.count
                if (!activeIds.has(entry)) {
                  const cleanable = await getDirSize(entryPath, { skipTopLevelDirs: PRESERVED_ORPHAN_SESSION_DIRS })
                  if (cleanable.count > 0) {
                    orphanBytes += cleanable.bytes
                    orphanCount++
                    orphanItemsTruncated = addOrphanItem(orphanItems, {
                      kind: 'directory',
                      path: displayStoragePath(entryPath),
                      bytes: cleanable.bytes,
                      count: cleanable.count,
                    }) || orphanItemsTruncated
                  }
                }
              } catch { /* 跳过 */ }
            }
          } catch { /* 跳过 */ }
        }
      } catch { /* 跳过 */ }
    }
  }

  return {
    label: '工作区文件',
    key: 'workspaces',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
    orphanItems, orphanItemsTruncated,
  }
}

async function calcConversationsCategory(scope?: UserScope): Promise<StorageCategory> {
  const dir = getConversationsDir(scope)
  const { bytes, count } = await getDirSize(dir)
  return {
    label: '对话记录',
    key: 'conversations',
    bytes, count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
    orphanItems: [], orphanItemsTruncated: false,
  }
}

async function calcAttachmentsCategory(scope?: UserScope): Promise<StorageCategory> {
  const dir = getAttachmentsDir(scope)
  const { bytes, count } = await getDirSize(dir)
  return {
    label: '附件文件',
    key: 'attachments',
    bytes, count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
    orphanItems: [], orphanItemsTruncated: false,
  }
}

async function calcTempFilesCategory(): Promise<StorageCategory> {
  const previewDir = join(tmpdir(), 'proma-preview')
  const installerDir = join(tmpdir(), 'proma-installers')
  const [preview, installer] = await Promise.all([
    getDirSize(previewDir),
    getDirSize(installerDir),
  ])
  return {
    label: '临时预览/安装文件',
    key: 'temp-files',
    bytes: preview.bytes + installer.bytes,
    count: preview.count + installer.count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
    orphanItems: [], orphanItemsTruncated: false,
  }
}

export async function calculateStorageStats(scope?: UserScope): Promise<StorageStats> {
  const categories = await Promise.all([
    calcAgentSessionsCategory(scope),
    calcSdkConfigCategory(scope),
    calcWorkspacesCategory(scope),
    calcConversationsCategory(scope),
    calcAttachmentsCategory(scope),
    calcTempFilesCategory(),
  ])
  return {
    categories,
    totalBytes: categories.reduce((sum, c) => sum + c.bytes, 0),
    calculatedAt: Date.now(),
  }
}

// ─── 清理 ───

export async function cleanupTempFiles(): Promise<CleanupResult> {
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const previewDir = join(tmpdir(), 'proma-preview')
  if (existsSync(previewDir)) {
    try {
      const files = await fsPromises.readdir(previewDir)
      for (const file of files) {
        const freed = safeUnlink(join(previewDir, file))
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理预览文件失败: ${e}`)
    }
  }

  const installerDir = join(tmpdir(), 'proma-installers')
  if (existsSync(installerDir)) {
    try {
      const files = await fsPromises.readdir(installerDir)
      for (const file of files) {
        const freed = safeUnlink(join(installerDir, file))
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理安装文件失败: ${e}`)
    }
  }

  if (freedBytes > 0) {
    console.log(`[存储清理] 临时文件: 释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB, 删除 ${deletedCount} 个文件`)
  }
  return { freedBytes, deletedCount, errors }
}

async function cleanupOrphanAgentSessions(scope?: UserScope): Promise<CleanupResult> {
  const dir = getAgentSessionsDir(scope)
  const activeIds = getActiveSessionIds(scope)
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  if (!existsSync(dir)) return { freedBytes, deletedCount, errors }

  try {
    const files = await fsPromises.readdir(dir)
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const id = basename(file, '.jsonl')
      if (activeIds.has(id)) continue
      const freed = safeUnlink(join(dir, file))
      if (freed > 0) { freedBytes += freed; deletedCount++ }
    }
  } catch (e) {
    errors.push(`清理孤儿会话文件失败: ${e}`)
  }

  return { freedBytes, deletedCount, errors }
}

async function cleanupOrphanSdkConfig(scope?: UserScope): Promise<CleanupResult> {
  const sdkDir = getSdkConfigDir(scope)
  const activeSdkIds = getActiveSdkSessionIds(scope)
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const projectsDir = join(sdkDir, 'projects')
  if (existsSync(projectsDir)) {
    try {
      const hashDirs = await fsPromises.readdir(projectsDir)
      for (const hashDir of hashDirs) {
        const projPath = join(projectsDir, hashDir)
        try {
          if (!(await fsPromises.lstat(projPath)).isDirectory()) continue
          const files = await fsPromises.readdir(projPath)
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue
            const sdkId = basename(file, '.jsonl')
            if (activeSdkIds.has(sdkId)) continue
            const freed = safeUnlink(join(projPath, file))
            if (freed > 0) { freedBytes += freed; deletedCount++ }
          }
          const remaining = await fsPromises.readdir(projPath)
          if (remaining.length === 0) {
            rmSyncWithRetry(projPath, { recursive: true, force: true })
          }
        } catch { /* 跳过 */ }
      }
    } catch (e) {
      errors.push(`清理孤儿 SDK projects 失败: ${e}`)
    }
  }

  const fileHistoryDir = join(sdkDir, 'file-history')
  if (existsSync(fileHistoryDir)) {
    try {
      const sdkIds = await fsPromises.readdir(fileHistoryDir)
      for (const sdkId of sdkIds) {
        if (activeSdkIds.has(sdkId)) continue
        const histPath = join(fileHistoryDir, sdkId)
        try {
          if (!(await fsPromises.lstat(histPath)).isDirectory()) continue
          const freed = await safeRmDir(histPath)
          if (freed > 0) { freedBytes += freed; deletedCount++ }
        } catch { /* 跳过 */ }
      }
    } catch (e) {
      errors.push(`清理孤儿 file-history 失败: ${e}`)
    }
  }

  return { freedBytes, deletedCount, errors }
}

async function cleanupOrphanWorkspaces(scope?: UserScope): Promise<CleanupResult> {
  const wsDir = getAgentWorkspacesDir()
  const activeIds = getActiveSessionIds(scope)
  const activeSlugs = getActiveWorkspaceSlugs()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  if (!existsSync(wsDir)) return { freedBytes, deletedCount, errors }

  try {
    const slugs = await fsPromises.readdir(wsDir)
    for (const slug of slugs) {
      const slugDir = join(wsDir, slug)
      try {
        if (!(await fsPromises.lstat(slugDir)).isDirectory()) continue
        const entries = await fsPromises.readdir(slugDir)
        for (const entry of entries) {
          if (isWorkspaceMetadataDir(entry)) continue
          const entryPath = join(slugDir, entry)
          try {
            if (!(await fsPromises.lstat(entryPath)).isDirectory()) continue
            if (activeIds.has(entry) || activeSlugs.has(entry)) continue
            const freed = await cleanupOrphanSessionWorkspaceDir(entryPath)
            if (freed > 0) { freedBytes += freed; deletedCount++ }
          } catch { /* 跳过 */ }
        }
      } catch { /* 跳过 */ }
    }
  } catch (e) {
    errors.push(`清理孤儿工作区目录失败: ${e}`)
  }

  // 清理用户级会话工作目录中的孤儿（迁移后新数据位于用户级目录）
  if (scope) {
    const userWsDir = getUserSessionWorkspacesDir(scope)
    if (existsSync(userWsDir)) {
      try {
        const slugs = await fsPromises.readdir(userWsDir)
        for (const slug of slugs) {
          const slugDir = join(userWsDir, slug)
          try {
            if (!(await fsPromises.lstat(slugDir)).isDirectory()) continue
            const entries = await fsPromises.readdir(slugDir)
            for (const entry of entries) {
              const entryPath = join(slugDir, entry)
              try {
                if (!(await fsPromises.lstat(entryPath)).isDirectory()) continue
                if (activeIds.has(entry)) continue
                const freed = await cleanupOrphanSessionWorkspaceDir(entryPath)
                if (freed > 0) { freedBytes += freed; deletedCount++ }
              } catch { /* 跳过 */ }
            }
          } catch { /* 跳过 */ }
        }
      } catch (e) {
        errors.push(`清理用户会话工作目录失败: ${e}`)
      }
    }
  }

  return { freedBytes, deletedCount, errors }
}

function cleanupArchivedSessions(beforeDays: number, scope?: UserScope): CleanupResult {
  const cutoff = Date.now() - beforeDays * 24 * 60 * 60 * 1000
  const sessions = listAgentSessions(scope)
  const sdkDir = getSdkConfigDir(scope)
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  for (const session of sessions) {
    if (!session.archived || session.updatedAt > cutoff) continue

    const msgPath = join(getAgentSessionsDir(scope), `${session.id}.jsonl`)
    if (existsSync(msgPath)) {
      const freed = safeUnlink(msgPath)
      if (freed > 0) { freedBytes += freed; deletedCount++ }
    }

    if (session.sdkSessionId) {
      const histDir = join(sdkDir, 'file-history', session.sdkSessionId)
      if (existsSync(histDir)) {
        try {
          rmSyncWithRetry(histDir, { recursive: true, force: true })
          deletedCount++
        } catch { /* 跳过 */ }
      }
    }
  }

  if (freedBytes > 0) {
    console.log(`[存储清理] 归档数据: 释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB, 删除 ${deletedCount} 项`)
  }
  return { freedBytes, deletedCount, errors }
}

export async function cleanupStorage(options: CleanupOptions, scope?: UserScope): Promise<CleanupResult> {
  let totalFreed = 0, totalDeleted = 0
  const allErrors: string[] = []

  const merge = (r: CleanupResult) => {
    totalFreed += r.freedBytes
    totalDeleted += r.deletedCount
    allErrors.push(...r.errors)
  }

  for (const cat of options.categories) {
    if (cat === 'temp-files') {
      merge(await cleanupTempFiles())
      continue
    }

    if (options.orphansOnly) {
      switch (cat) {
        case 'agent-sessions': merge(await cleanupOrphanAgentSessions(scope)); break
        case 'sdk-config': merge(await cleanupOrphanSdkConfig(scope)); break
        case 'workspaces': merge(await cleanupOrphanWorkspaces(scope)); break
      }
    } else if (options.archivedBeforeDays > 0) {
      if (cat === 'agent-sessions' || cat === 'sdk-config') {
        merge(cleanupArchivedSessions(options.archivedBeforeDays, scope))
      }
    }
  }

  if (totalFreed > 0) {
    console.log(`[存储清理] 总计释放 ${(totalFreed / 1024 / 1024).toFixed(1)} MB, 删除 ${totalDeleted} 项`)
  }
  return { freedBytes: totalFreed, deletedCount: totalDeleted, errors: allErrors }
}
