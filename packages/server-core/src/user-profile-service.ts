/**
 * 用户档案服务
 *
 * 管理用户档案（用户名 + 头像）的读写。
 * 存储在 ~/.proma/user-profile.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getUserProfilePath } from './config-paths'

/** 默认用户头像 emoji */
export const DEFAULT_USER_AVATAR = '🧑‍💻'

/** 默认用户名 */
export const DEFAULT_USER_NAME = '用户'

/** 用户档案 */
export interface UserProfile {
  /** 用户名 */
  userName: string
  /** 头像（emoji 字符串 或 data:image/* base64 URL） */
  avatar: string
}

/**
 * 获取用户档案
 *
 * 如果文件不存在，返回默认档案。
 */
export function getUserProfile(): UserProfile {
  const filePath = getUserProfilePath()

  if (!existsSync(filePath)) {
    return {
      userName: DEFAULT_USER_NAME,
      avatar: DEFAULT_USER_AVATAR,
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<UserProfile>
    return {
      userName: data.userName || DEFAULT_USER_NAME,
      avatar: data.avatar || DEFAULT_USER_AVATAR,
    }
  } catch (error) {
    console.error('[用户档案] 读取失败:', error)
    return {
      userName: DEFAULT_USER_NAME,
      avatar: DEFAULT_USER_AVATAR,
    }
  }
}

/**
 * 更新用户档案
 *
 * 合并更新字段并写入文件。
 */
export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const current = getUserProfile()
  const updated: UserProfile = {
    ...current,
    ...updates,
  }

  const filePath = getUserProfilePath()

  try {
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    console.log(`[用户档案] 已更新: ${updated.userName}`)
  } catch (error) {
    console.error('[用户档案] 写入失败:', error)
    throw new Error('写入用户档案失败')
  }

  return updated
}
