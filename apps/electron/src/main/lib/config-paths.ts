/**
 * 配置路径工具（Electron 端）
 *
 * 纯路径计算与 parseSkillVersion 的真源在 @proma/server-core/config-paths；此处 re-export 之外，
 * 本地保留依赖 Electron 打包资源（process.resourcesPath / app.isPackaged）的函数：
 * getBundledCliPath（定位打包 CLI 二进制）、seedDefaultSkills（同步 bundle 内置 Skills）。
 */

export * from '@proma/server-core/config-paths'

import { join, basename } from 'node:path'
import { existsSync, cpSync, rmSync, readdirSync } from 'node:fs'
import * as configPaths from '@proma/server-core/config-paths'

/** 比较两个 semver 版本字符串
 *
 * @returns 正数表示 a > b，0 表示相等，负数表示 a < b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 防御性目录基名集合：复制 default skills 时永远跳过这些目录，避免
 *  .git 0444 文件、node_modules 文件爆炸等场景把启动期同步链路炸掉。 */
const DEFAULT_SKILL_COPY_BLOCKLIST = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  '.next',
  '.cache',
  '.turbo',
  '__pycache__',
])

function defaultSkillCopyFilter(src: string): boolean {
  return !DEFAULT_SKILL_COPY_BLOCKLIST.has(basename(src))
}

/**
 * 获取打包进 App 的 proma CLI 二进制路径。
 *
 * 打包模式下从 process.resourcesPath/bin 取（electron-builder extraResources 注入）。
 * 开发模式下没有编译二进制——返回 undefined，由调用方回退到源码运行。
 */
export function getBundledCliPath(): string | undefined {
  const { app } = require('electron')
  if (!app.isPackaged) return undefined
  const binName = process.platform === 'win32' ? 'proma.exe' : 'proma'
  const cliPath = join(process.resourcesPath, 'bin', binName)
  return existsSync(cliPath) ? cliPath : undefined
}

/**
 * 从 app bundle 同步默认 Skills 到 ~/.proma/default-skills/
 *
 * 打包模式下从 process.resourcesPath/default-skills 复制；
 * 开发模式下从源码 default-skills/ 目录复制。
 */
export function seedDefaultSkills(): void {
  const { app } = require('electron')
  const bundledDir = app.isPackaged
    ? join(process.resourcesPath, 'default-skills')
    : join(__dirname, '../default-skills')

  if (!existsSync(bundledDir)) {
    console.log('[配置] 未找到内置 default-skills 目录，跳过')
    return
  }

  const userDir = configPaths.getDefaultSkillsDir()

  try {
    const entries = readdirSync(bundledDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const source = join(bundledDir, entry.name)
      const target = join(userDir, entry.name)

      try {
        if (!existsSync(target)) {
          cpSync(source, target, { recursive: true, filter: defaultSkillCopyFilter })
          console.log(`[配置] 已同步默认 Skill: ${entry.name}`)
          continue
        }

        const bundledVer = configPaths.parseSkillVersion(source)
        const existingVer = configPaths.parseSkillVersion(target)

        if (compareSemver(bundledVer, existingVer) > 0) {
          // rm-then-cp：rmSync 不依赖目标文件写权限（只读 .git/objects/ 等
          // 0444 文件用 cpSync({ force: true }) 无法覆盖会 EACCES，但
          // rmSync({ force: true }) 只需父目录可写就能 unlink）。
          rmSync(target, { recursive: true, force: true })
          cpSync(source, target, { recursive: true, filter: defaultSkillCopyFilter })
          console.log(`[配置] 已升级默认 Skill: ${entry.name} (${existingVer} → ${bundledVer})`)
        }
      } catch (err) {
        // 单 skill 失败不影响其他 skill 同步。
        console.warn(`[配置] 同步默认 Skill 失败 (${entry.name})，跳过:`, err)
      }
    }
  } catch (err) {
    console.warn('[配置] 同步默认 Skills 失败:', err)
  }
}
