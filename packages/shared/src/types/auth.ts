/**
 * Web 端认证与用户管理相关类型
 *
 * 服务端路由、preload 契约、Web shim 与 renderer 四端共用。
 */

/** 用户角色 */
export type UserRole = 'admin' | 'user'

/**
 * 对外暴露的用户信息（公开结构，不含 passwordHash 等敏感字段）
 *
 * 登录 / 注册响应的 user 字段、user:list 列表项均为此结构。
 */
export interface AuthUser {
  /** 用户 ID */
  id: string
  /** 用户名 */
  username: string
  /** 角色：admin（内置）或 user（注册） */
  role: UserRole
}

/** 修改自己密码的请求体（auth:change-password） */
export interface ChangePasswordInput {
  /** 旧密码（用于校验身份） */
  oldPassword: string
  /** 新密码 */
  newPassword: string
}

/** 管理员重置任意用户密码的请求体（user:reset-password） */
export interface ResetUserPasswordInput {
  /** 目标用户 ID */
  userId: string
  /** 新密码 */
  newPassword: string
}

/** 管理员删除用户的请求体（user:delete） */
export interface DeleteUserInput {
  /** 目标用户 ID */
  userId: string
  /** 删除确认标志，必须为 true（前端二次确认弹窗传入，防误删） */
  confirm: boolean
}
