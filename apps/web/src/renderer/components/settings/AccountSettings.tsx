/**
 * AccountSettings - 账号设置页（仅 Web 端显示）
 *
 * - 当前账号：用户名 + 角色
 * - 修改密码：校验旧密码后修改自己的密码
 * - 退出登录
 *
 * 用户管理（列表/重置密码/删除）已独立为 UserSettings（管理员专属 tab）。
 * 依赖 Web shim 提供的可选方法（getAuthUser / changePassword / logout）。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { authUserAtom } from '@/atoms/auth'
import { PASSWORD_MIN, PASSWORD_MAX, validateNewPassword } from '@/lib/password'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSecretInput,
  RoleBadge,
} from './primitives'
import { Button } from '../ui/button'

/** 修改密码表单 */
function ChangePasswordCard(): React.ReactElement {
  const [oldPassword, setOldPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmit = async (): Promise<void> => {
    if (!oldPassword) {
      toast.error('请输入旧密码')
      return
    }
    const invalid = validateNewPassword(newPassword, confirmPassword)
    if (invalid) {
      toast.error(invalid)
      return
    }

    const api = window.electronAPI.changePassword
    if (!api) return

    setSubmitting(true)
    try {
      await api({ oldPassword, newPassword })
      toast.success('密码已修改')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '修改密码失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SettingsSection
      title="修改密码"
      description="修改后其他已登录设备将在令牌过期后需重新登录"
    >
      <SettingsCard>
        <SettingsSecretInput
          label="旧密码"
          value={oldPassword}
          onChange={setOldPassword}
          placeholder="请输入当前密码"
        />
        <SettingsSecretInput
          label="新密码"
          value={newPassword}
          onChange={setNewPassword}
          placeholder={`${PASSWORD_MIN}-${PASSWORD_MAX} 字符`}
        />
        <SettingsSecretInput
          label="确认新密码"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="再次输入新密码"
        />
        <div className="px-4 py-3 flex justify-end">
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '提交中…' : '确认修改'}
          </Button>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

export function AccountSettings(): React.ReactElement {
  const currentUser = useAtomValue(authUserAtom)

  /** 退出登录：清空本地凭证后整页跳转登录页（路由守卫渲染 LoginPage） */
  const handleLogout = async (): Promise<void> => {
    const api = window.electronAPI.logout
    if (!api) return
    try {
      await api()
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="当前账号">
        <SettingsCard>
          <SettingsRow label="用户名" description={currentUser?.username ?? '加载中…'}>
            {currentUser && <RoleBadge role={currentUser.role} />}
          </SettingsRow>
          <SettingsRow label="登录状态" description="退出后需使用账号密码重新登录">
            <Button variant="outline" size="sm" onClick={handleLogout}>
              退出登录
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <ChangePasswordCard />
    </div>
  )
}
