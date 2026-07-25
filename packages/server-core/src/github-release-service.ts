/**
 * GitHub Release 服务
 *
 * 从 GitHub API 获取项目的发布日志（Release Notes）。
 * 零 Electron 依赖，Electron 端与 Web 服务端共用。
 */

import type {
  GitHubRelease,
  GitHubReleaseListOptions,
} from '@proma/shared'

/** GitHub API 基础 URL */
const GITHUB_API_BASE = 'https://api.github.com'

/** GitHub 仓库配置（优先从环境变量读取，支持 fork 部署） */
const GITHUB_REPO = {
  owner: process.env.PROMA_GITHUB_OWNER || 'ErlichLiu',
  repo: process.env.PROMA_GITHUB_REPO || 'Proma',
}

/** Release 缓存 */
interface ReleaseCache {
  data: GitHubRelease[]
  timestamp: number
}

let releaseCache: ReleaseCache | null = null

/** 单个 Release 缓存（按 tag） */
const tagCache = new Map<string, { data: GitHubRelease; timestamp: number }>()

/** 缓存有效期（30 分钟） */
const CACHE_TTL = 30 * 60 * 1000

/** Rate limit 冷却标记 */
let rateLimitUntil = 0

/**
 * 从 GitHub API 获取 releases
 */
async function fetchFromGitHub<T>(endpoint: string): Promise<T> {
  if (Date.now() < rateLimitUntil) {
    throw new Error('GitHub API 请求过于频繁，请稍后再试')
  }

  const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}${endpoint}`
  console.log(`[GitHub Release] 正在请求: ${url}`)

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Proma-Server',
    },
  })

  if (response.status === 403 || response.status === 429) {
    rateLimitUntil = Date.now() + 15 * 60 * 1000
    throw new Error('GitHub API 请求过于频繁，请 15 分钟后重试')
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API 请求失败 (${response.status})，请检查网络连接后重试`
    )
  }

  return response.json() as Promise<T>
}

/**
 * 获取最新的 Release
 */
export async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const release = await fetchFromGitHub<GitHubRelease>('/releases/latest')
    console.log(`[GitHub Release] 获取最新 Release: v${release.tag_name}`)
    return release
  } catch (error) {
    console.error('[GitHub Release] 获取最新 Release 失败:', error)
    return null
  }
}

/**
 * 获取 Release 列表
 */
export async function listReleases(
  options: GitHubReleaseListOptions = {}
): Promise<GitHubRelease[]> {
  const {
    perPage = 10,
    page = 1,
    includePrerelease = false,
  } = options

  try {
    // 检查缓存
    if (
      releaseCache &&
      Date.now() - releaseCache.timestamp < CACHE_TTL &&
      page === 1
    ) {
      console.log('[GitHub Release] 使用缓存的 Release 列表')
      const filtered = includePrerelease
        ? releaseCache.data
        : releaseCache.data.filter(r => !r.prerelease && !r.draft)
      return filtered.slice(0, perPage)
    }

    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
    })

    const releases = await fetchFromGitHub<GitHubRelease[]>(
      `/releases?${params.toString()}`
    )

    console.log(`[GitHub Release] 获取到 ${releases.length} 个 Releases`)

    const filtered = includePrerelease
      ? releases
      : releases.filter(r => !r.prerelease && !r.draft)

    if (page === 1) {
      releaseCache = { data: releases, timestamp: Date.now() }
    }

    return filtered
  } catch (error) {
    console.error('[GitHub Release] 获取 Release 列表失败:', error)
    if (releaseCache) {
      console.log('[GitHub Release] API 请求失败，使用过期缓存')
      const filtered = includePrerelease
        ? releaseCache.data
        : releaseCache.data.filter(r => !r.prerelease && !r.draft)
      return filtered.slice(0, perPage)
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * 根据标签名获取指定的 Release
 */
export async function getReleaseByTag(tag: string): Promise<GitHubRelease | null> {
  try {
    const cached = tagCache.get(tag)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }

    const release = await fetchFromGitHub<GitHubRelease>(
      `/releases/tags/${tag}`
    )
    console.log(`[GitHub Release] 获取 Release: ${tag}`)

    tagCache.set(tag, { data: release, timestamp: Date.now() })
    return release
  } catch (error) {
    console.error(`[GitHub Release] 获取 Release ${tag} 失败:`, error)
    const cached = tagCache.get(tag)
    if (cached) return cached.data
    return null
  }
}

/**
 * 清除缓存
 */
export function clearReleaseCache(): void {
  releaseCache = null
  tagCache.clear()
  console.log('[GitHub Release] 缓存已清除')
}
