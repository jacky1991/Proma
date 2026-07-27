/**
 * sdk-config 按用户拆分迁移工具
 *
 * 背景：M3 迭代 8 之前，Agent SDK 转录（Claude 的 projects/、Pi 的 sessions/、
 * 文件回退备份 file-history/）全局共享于 {dataRoot}/sdk-config/；拆分后按用户落到
 * {dataRoot}/users/{userId}/sdk-config/（config-paths.ts:getSdkConfigDir(scope)）。
 *
 * 本工具遍历每个用户的会话索引，将全局目录下的存量文件归属到对应用户：
 * - `piSessionFile`（元数据中记录的绝对路径）→ 移到归属用户目录，并回写元数据
 * - `sdkSessionId` / `forkSourceSdkSessionId` → 按 projects/{hash}/{sid}.jsonl 与
 *   file-history/{sid}/ 匹配后移动（保持相对结构）；这类路径始终以
 *   getSdkConfigDir(scope) 为根重新遍历定位，无需回写元数据
 *
 * 无法归属的文件（孤儿）保持原位并在结果中报告，由存储清理或人工处理。
 * 与 migrateToMultiUser 一致：手动能力，服务端启动不自动触发；复制模式这里表现为
 * rename（同一数据根内）、幂等、支持 dryRun。
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { getSdkConfigDir } from '../config-paths.ts'
import { listAgentSessions, updateAgentSessionMeta } from '../agent-session-manager.ts'
import { listUsers } from '../user-manager.ts'

/** 单条迁移记录 */
interface MovedEntry {
  from: string
  to: string
}

/** 迁移结果 */
export interface SdkConfigMigrationResult {
  /** 已移动（或 dryRun 下将要移动）的文件/目录 */
  moved: MovedEntry[]
  /** 回写了 piSessionFile 的会话数 */
  updatedSessions: number
  /** 无法归属用户、保持原位的文件 */
  orphans: string[]
  /** 移动失败项（含原因） */
  errors: string[]
  dryRun: boolean
}

/**
 * 是否需要迁移：全局 sdk-config 下仍存在常规子项（sessions/projects/file-history 等）
 *
 * 目录本身会被 getSdkConfigDir() 自动创建，故以「是否有子项」为判据。
 */
export function needsSdkConfigMigration(): boolean {
  const globalDir = getSdkConfigDir()
  if (!existsSync(globalDir)) return false
  try {
    return readdirSync(globalDir).length > 0
  } catch {
    return false
  }
}

/** 归属信息：文件应落到哪个用户目录 */
interface Ownership {
  userId: string
  /** 若由 piSessionFile 命中，迁移后需回写该会话的元数据 */
  sessionId?: string
}

/** 递归收集目录下的所有文件（绝对路径） */
function collectFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      try {
        if (statSync(full).isDirectory()) {
          walk(full)
        } else {
          out.push(full)
        }
      } catch {
        /* 跳过不可读项 */
      }
    }
  }
  walk(root)
  return out
}

/** 自底向上清理空目录（保留 root 本身） */
function pruneEmptyDirs(root: string): void {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(root, name)
    try {
      if (statSync(full).isDirectory()) {
        pruneEmptyDirs(full)
        if (readdirSync(full).length === 0) rmdirSync(full)
      }
    } catch {
      /* 跳过 */
    }
  }
}

/**
 * 将全局 sdk-config 存量数据迁移到各用户目录
 *
 * @param options.dryRun 试运行：只报告将要发生的移动，不写盘
 */
export function migrateSdkConfigToUsers(options?: { dryRun?: boolean }): SdkConfigMigrationResult {
  const dryRun = options?.dryRun ?? false
  const globalDir = getSdkConfigDir()
  const result: SdkConfigMigrationResult = {
    moved: [],
    updatedSessions: 0,
    orphans: [],
    errors: [],
    dryRun,
  }

  if (!existsSync(globalDir)) {
    console.log('[sdk-config 迁移] 全局目录不存在，无需迁移')
    return result
  }

  // 1. 构建归属表：源绝对路径 → 归属用户
  const ownership = new Map<string, Ownership>()
  const users = listUsers()

  for (const user of users) {
    const scope = { userId: user.id }
    const sessions = listAgentSessions(scope)

    for (const session of sessions) {
      // Pi 转录：元数据记录了精确绝对路径
      if (session.piSessionFile && session.piSessionFile.startsWith(globalDir + '/')) {
        ownership.set(session.piSessionFile, { userId: user.id, sessionId: session.id })
      }

      // Claude 转录与文件回退备份：按 sdkSessionId 在全局目录下匹配
      const sdkIds = [session.sdkSessionId, session.forkSourceSdkSessionId].filter(Boolean) as string[]
      for (const sid of sdkIds) {
        const projectsDir = join(globalDir, 'projects')
        if (existsSync(projectsDir)) {
          for (const hashDir of readdirSync(projectsDir)) {
            const candidate = join(projectsDir, hashDir, `${sid}.jsonl`)
            if (existsSync(candidate) && !ownership.has(candidate)) {
              ownership.set(candidate, { userId: user.id })
            }
          }
        }
        const histDir = join(globalDir, 'file-history', sid)
        if (existsSync(histDir) && !ownership.has(histDir)) {
          ownership.set(histDir, { userId: user.id })
        }
      }
    }
  }

  // 2. 执行移动（目录项整体移动；其下文件不再单独处理）
  const movedPrefixes: string[] = []
  for (const [src, info] of ownership) {
    const rel = relative(globalDir, src)
    const target = join(getSdkConfigDir({ userId: info.userId }), rel)

    if (!dryRun) {
      try {
        mkdirSync(dirname(target), { recursive: true })
        renameSync(src, target)
      } catch (e) {
        result.errors.push(`${src} → ${target}: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      // Pi 会话回写元数据（指向用户目录下的新路径）
      if (info.sessionId) {
        try {
          updateAgentSessionMeta(info.sessionId, { piSessionFile: target }, { userId: info.userId })
          result.updatedSessions++
        } catch (e) {
          result.errors.push(`回写 piSessionFile 失败 (${info.sessionId}): ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }

    movedPrefixes.push(src)
    result.moved.push({ from: src, to: target })
  }

  // 3. 孤儿识别：全局目录下未被任何归属项覆盖的剩余文件
  const allFiles = collectFiles(globalDir)
  for (const file of allFiles) {
    const covered = movedPrefixes.some((p) => file === p || file.startsWith(p + '/'))
    if (!covered) result.orphans.push(file)
  }

  // 4. 清理移动后残留的空目录（保留全局根目录本身）
  if (!dryRun && result.moved.length > 0) {
    pruneEmptyDirs(globalDir)
  }

  console.log(
    `[sdk-config 迁移] ${dryRun ? '试运行：' : ''}移动 ${result.moved.length} 项` +
    `，回写会话 ${result.updatedSessions} 个` +
    `，孤儿 ${result.orphans.length} 个` +
    (result.errors.length > 0 ? `，失败 ${result.errors.length} 个` : ''),
  )

  return result
}
