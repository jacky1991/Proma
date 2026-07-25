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

const settings = new Hono()

// ===== Settings / Profile =====

/** POST /api/settings:get → AppSettings */
settings.post('/settings:get', (c) => {
  return c.json(getSettings())
})

/** POST /api/settings:update → AppSettings */
settings.post('/settings:update', async (c) => {
  const updates = await c.req.json()
  const updated = updateSettings(updates)
  return c.json(updated)
})

/** POST /api/user-profile:get → UserProfile */
settings.post('/user-profile:get', (c) => {
  return c.json(getUserProfile())
})

/** POST /api/user-profile:update → UserProfile */
settings.post('/user-profile:update', async (c) => {
  const updates = await c.req.json()
  const updated = updateUserProfile(updates)
  return c.json(updated)
})

// ===== Scratch-pad =====

/** POST /api/scratch-pad:load → string（Markdown 内容） */
settings.post('/scratch-pad:load', (c) => {
  const path = getScratchPadPath()
  try {
    if (!existsSync(path)) return c.json('')
    const content = readFileSync(path, 'utf-8')
    return c.json(content)
  } catch (err) {
    console.error('[ScratchPad] 加载失败:', err)
    return c.json('')
  }
})

/** POST /api/scratch-pad:save → boolean */
settings.post('/scratch-pad:save', async (c) => {
  const { content } = await c.req.json<{ content: string }>()
  const path = getScratchPadPath()
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, content ?? '', 'utf-8')
    return c.json(true)
  } catch (err) {
    console.error('[ScratchPad] 保存失败:', err)
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

/** POST /api/proxy:get-settings → ProxyConfig */
settings.post('/proxy:get-settings', async (c) => {
  const config = await getProxySettings()
  return c.json(config)
})

/** POST /api/proxy:update-settings → void */
settings.post('/proxy:update-settings', async (c) => {
  const config = await c.req.json<ProxyConfig>()
  await saveProxySettings(config)
  return c.json({ ok: true })
})

/** POST /api/proxy:detect-system → SystemProxyDetectResult */
settings.post('/proxy:detect-system', async (c) => {
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
