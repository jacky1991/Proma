/**
 * 用户档案类型
 *
 * 用户名、头像等档案定义（transport 无关的共享契约）。
 * IPC 通道常量仍保留在 Electron 端（apps/electron/src/types/）。
 */

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
