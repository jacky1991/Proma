/**
 * AccountSettings - 账号设置页（仅 Web 端显示）
 *
 * - 当前账号：用户名 + 角色
 * - 修改密码：校验旧密码后修改自己的密码
 * - 用户管理（仅管理员）：用户列表 + 重置任意用户密码
 *
 * 依赖 Web shim 提供的可选方法（getAuthUser / changePassword /
 * listUsers / resetUserPassword）；Electron 端该 tab 不会出现。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import type { AuthUser } from '@proma/shared'
import { useEnsureCurrentUser, isAdminAtom } from '@/atoms/auth'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSecretInput,
} from './primitives'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ConfirmDialog } from '../ui/confirm-dialog'

/** 密码长度约束（与服务端 apps/server/src/utils/password.ts 保持一致） */
const PASSWORD_MIN = 6
const PASSWORD_MAX = 72

/** 角色徽章 */
function RoleBadge({ role }: { role: AuthUser['role'] }): React.ReactElement {
  return (
    <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
      {role === 'admin' ? '管理员' : '普通用户'}
    </Badge>
  )
}

/** 前端密码校验（长度 + 两次一致），返回错误提示；通过返回 null */
function validateNewPassword(newPassword: string, confirmPassword: string): string | null {
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

/** 用户管理（仅管理员）：用户列表 + 重置密码 */
function UserManagementSection(): React.ReactElement {
  const currentUser = useEnsureCurrentUser()
  const [users, setUsers] = React.useState<AuthUser[]>([])
  // 重置密码弹窗目标
  const [resetTarget, setResetTarget] = React.useState<AuthUser | null>(null)
  const [resetPassword, setResetPassword] = React.useState('')
  const [resetConfirm, setResetConfirm] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  // 重置自己密码的二次确认
  const [selfConfirmTarget, setSelfConfirmTarget] = React.useState<AuthUser | null>(null)

  // 加载用户列表
  React.useEffect(() => {
    const api = window.electronAPI.listUsers
    if (!api) return
    api()
      .then(setUsers)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '加载用户列表失败')
      })
  }, [])

  /** 点击「重置密码」：重置自己时先二次确认 */
  const handleResetClick = (user: AuthUser): void => {
    if (currentUser && user.id === currentUser.id) {
      setSelfConfirmTarget(user)
      return
    }
    setResetTarget(user)
  }

  /** 执行重置 */
  const handleResetSubmit = async (): Promise<void> => {
    if (!resetTarget) return

    const invalid = validateNewPassword(resetPassword, resetConfirm)
    if (invalid) {
      toast.error(invalid)
      return
    }

    const api = window.electronAPI.resetUserPassword
    if (!api) return

    setSubmitting(true)
    try {
      await api({ userId: resetTarget.id, newPassword: resetPassword })
      toast.success(`已重置用户 ${resetTarget.username} 的密码`)
      setResetTarget(null)
      setResetPassword('')
      setResetConfirm('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重置密码失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SettingsSection title="用户管理" description="仅管理员可见：查看全部用户并重置其密码">
      <SettingsCard>
        {users.map((user) => (
          <SettingsRow
            key={user.id}
            label={user.username}
            description={user.id === currentUser?.id ? '当前登录账号' : undefined}
          >
            <div className="flex items-center gap-2">
              <RoleBadge role={user.role} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleResetClick(user)}
              >
                重置密码
              </Button>
            </div>
          </SettingsRow>
        ))}
      </SettingsCard>

      {/* 重置密码弹窗 */}
      <Dialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null)
            setResetPassword('')
            setResetConfirm('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置密码：{resetTarget?.username}</DialogTitle>
            <DialogDescription>
              将直接覆盖该用户的密码，无需旧密码。请通过安全渠道告知用户新密码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="reset-password">新密码</Label>
              <Input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder={`${PASSWORD_MIN}-${PASSWORD_MAX} 字符`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password-confirm">确认新密码</Label>
              <Input
                id="reset-password-confirm"
                type="password"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="再次输入新密码"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleResetSubmit} disabled={submitting}>
              {submitting ? '提交中…' : '确认重置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置自己密码的二次确认 */}
      <ConfirmDialog
        open={selfConfirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSelfConfirmTarget(null)
        }}
        title="重置自己的密码？"
        description="重置后当前登录状态不受影响，但其他设备上的旧令牌过期后将无法再用旧密码登录。"
        confirmLabel="继续重置"
        variant="default"
        onConfirm={() => {
          if (selfConfirmTarget) {
            setResetTarget(selfConfirmTarget)
          }
          setSelfConfirmTarget(null)
        }}
      />
    </SettingsSection>
  )
}

export function AccountSettings(): React.ReactElement {
  const currentUser = useEnsureCurrentUser()
  const isAdmin = useAtomValue(isAdminAtom)

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

      {isAdmin && <UserManagementSection />}
    </div>
  )
}
