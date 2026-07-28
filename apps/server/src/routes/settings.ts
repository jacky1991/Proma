/**
 * Settings / UserProfile / Scratch-pad / Proxy / GitHub Release 域 HTTP 路由
 *
 * M2.5 迭代 6：新增 Scratch-pad（3）、Proxy（3）、GitHub Release（3）路由。
 */

import { Hono } from 'hono'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getSettings, updateSettings } from '@proma/server-core/settings-service'
import { getUserProfile, updateUserProfile } from '@proma/server-core/user-profile-service'
import { getScratchPadPath } from '@proma/server-core/config-paths'
import { getUserScope } from '../utils/user-scope'
import { adminOnly } from '../middleware/role.ts'
import {
  getProxySettings,
  saveProxySettings,
} from '@proma/server-core/proxy-settings-service'
import { detectSystemProxy } from '@proma/server-core/system-proxy-detector'
import {
  getLatestRelease,
  listReleases,
  getReleaseByTag,
} from '@proma/server-core/github-release-service'
import type { ProxyConfig, GitHubReleaseListOptions } from '@proma/shared'
import { createLogger } from '@proma/server-core/logger'

/** 模块日志器 */
const logger = createLogger('Settings')

const settings = new Hono()

// ===== Settings / Profile =====

/** POST /api/settings:get → AppSettings */
settings.post('/settings:get', (c) => {
  const scope = getUserScope(c)
  return c.json(getSettings(scope))
})

/** POST /api/settings:update → AppSettings */
settings.post('/settings:update', async (c) => {
  const scope = getUserScope(c)
  const updates = await c.req.json()
  const updated = updateSettings(updates, scope)
  return c.json(updated)
})

/** POST /api/user-profile:get → UserProfile */
settings.post('/user-profile:get', (c) => {
  const scope = getUserScope(c)
  return c.json(getUserProfile(scope))
})

/** POST /api/user-profile:update → UserProfile */
settings.post('/user-profile:update', async (c) => {
  const scope = getUserScope(c)
  const updates = await c.req.json()
  const updated = updateUserProfile(updates, scope)
  return c.json(updated)
})

// ===== Scratch-pad =====

/** POST /api/scratch-pad:load → string（Markdown 内容） */
settings.post('/scratch-pad:load', (c) => {
  const scope = getUserScope(c)
  const path = getScratchPadPath(scope)
  try {
    if (!existsSync(path)) return c.json('')
    const content = readFileSync(path, 'utf-8')
    return c.json(content)
  } catch (err) {
    logger.error('ScratchPad 加载失败', { error: err })
    return c.json('')
  }
})

/** POST /api/scratch-pad:save → boolean */
settings.post('/scratch-pad:save', async (c) => {
  const scope = getUserScope(c)
  const { content } = await c.req.json<{ content: string }>()
  const path = getScratchPadPath(scope)
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, content ?? '', 'utf-8')
    return c.json(true)
  } catch (err) {
    logger.error('ScratchPad 保存失败', { error: err })
    return c.json(false)
  }
})

/**
 * POST /api/scratch-pad:export → 文件下载
 *
 * Web 端：服务端生成文件 → 浏览器下载（Content-Disposition: attachment）。
 * 请求体：{ markdown: string, filename?: string }
 */
settings.post('/scratch-pad:export', async (c) => {
  const { markdown, filename } = await c.req.json<{ markdown: string; filename?: string }>()
  const safeName = (filename || 'scratch-pad.md').replace(/[/\\:*?"<>|]/g, '_')
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}"`,
    },
  })
})

// ===== Proxy =====
// 注意：proxy-settings.json 位于全局数据根且含 adminPassword，三个路由（含读取）均仅管理员可用。
// 同文件的 settings:* / user-profile:* / scratch-pad:* / github-release:* 为用户私有或公开路由，不挂门控。

/** POST /api/proxy:get-settings → ProxyConfig（仅管理员） */
settings.post('/proxy:get-settings', adminOnly, async (c) => {
  const config = await getProxySettings()
  return c.json(config)
})

/** POST /api/proxy:update-settings → void（仅管理员） */
settings.post('/proxy:update-settings', adminOnly, async (c) => {
  const config = await c.req.json<ProxyConfig>()
  await saveProxySettings(config)
  return c.json({ ok: true })
})

/** POST /api/proxy:detect-system → SystemProxyDetectResult（仅管理员） */
settings.post('/proxy:detect-system', adminOnly, async (c) => {
  const result = await detectSystemProxy()
  return c.json(result)
})

// ===== GitHub Release =====

/** POST /api/github-release:get-latest → GitHubRelease | null */
settings.post('/github-release:get-latest', async (c) => {
  const release = await getLatestRelease()
  return c.json(release)
})

/** POST /api/github-release:list → GitHubRelease[] */
settings.post('/github-release:list', async (c) => {
  let options: GitHubReleaseListOptions = {}
  try {
    options = await c.req.json<GitHubReleaseListOptions>()
  } catch {
    // 无请求体时使用默认选项
  }
  const releases = await listReleases(options)
  return c.json(releases)
})

/** POST /api/github-release:get-by-tag → GitHubRelease | null */
settings.post('/github-release:get-by-tag', async (c) => {
  const { tag } = await c.req.json<{ tag: string }>()
  const release = await getReleaseByTag(tag)
  return c.json(release)
})

export { settings }
