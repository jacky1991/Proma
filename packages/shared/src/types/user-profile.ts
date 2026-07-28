/**
 * 用户档案类型
 *
 * 用户名、头像等档案定义（transport 无关的共享契约）。
 * 原 Electron IPC 通道常量已随桌面端删除（M4 迭代 11）。
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
