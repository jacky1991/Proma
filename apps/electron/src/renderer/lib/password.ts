/**
 * 前端密码校验工具
 *
 * 长度约束与服务端 apps/server/src/utils/password.ts 契约对齐，
 * 供修改密码（AccountSettings）与重置密码（UserSettings）表单做前端预校验。
 */

/** 密码最小长度 */
export const PASSWORD_MIN = 6

/** 密码最大长度（bcrypt 对超过 72 字节的部分静默截断，提前校验避免歧义） */
export const PASSWORD_MAX = 72

/** 前端密码校验（长度 + 两次一致），返回错误提示；通过返回 null */
export function validateNewPassword(newPassword: string, confirmPassword: string): string | null {
  if (newPassword.length < PASSWORD_MIN) {
    return `密码长度至少 ${PASSWORD_MIN} 字符`
  }
  if (newPassword.length > PASSWORD_MAX) {
    return `密码长度不能超过 ${PASSWORD_MAX} 字符`
  }
  if (newPassword !== confirmPassword) {
    return '两次输入的新密码不一致'
  }
  return null
}
