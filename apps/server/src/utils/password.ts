/**
 * 密码校验工具
 *
 * 供认证路由（注册 / 改密）与用户管理路由（重置密码）共用。
 */

/** 密码最小长度 */
export const PASSWORD_MIN = 6

/** 密码最大长度（bcrypt 对超过 72 字节的部分静默截断，提前校验避免歧义） */
export const PASSWORD_MAX = 72

/**
 * 校验密码强度（当前仅长度约束）
 *
 * @param password 待校验密码
 * @returns 校验不通过返回中文错误提示；通过返回 null
 */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `密码长度至少 ${PASSWORD_MIN} 字符`
  }
  if (password.length > PASSWORD_MAX) {
    return `密码长度不能超过 ${PASSWORD_MAX} 字符`
  }
  return null
}
