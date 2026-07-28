/**
 * UserSettings - 用户管理页（仅 Web 端管理员可见）
 *
 * - 用户列表（user:list）
 * - 重置任意用户密码（user:reset-password，重置自己时先二次确认）
 * - 删除用户（user:delete，二次确认弹窗 + confirm 标志，级联清理私有数据）
 *
 * 依赖 Web shim 提供的可选方法（listUsers / resetUserPassword / deleteUser）；
 * Electron 端无登录概念，此 tab 不渲染（SettingsPanel 经 adminOnly 标记隐藏，桌面端同时被平台过滤排除）。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import type { AuthUser } from '@proma/shared'
import { authUserAtom, isAdminAtom } from '@/atoms/auth'
import { PASSWORD_MIN, PASSWORD_MAX, validateNewPassword } from '@/lib/password'
import { SettingsSection, SettingsCard, SettingsRow, SettingsSecretInput, RoleBadge } from './primitives'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/confirm-dialog'

export function UserSettings(): React.ReactElement | null {
  const isAdmin = useAtomValue(isAdminAtom)
  const currentUser = useAtomValue(authUserAtom)
  const [users, setUsers] = React.useState<AuthUser[]>([])
  // 重置密码弹窗目标
  const [resetTarget, setResetTarget] = React.useState<AuthUser | null>(null)
  const [resetPassword, setResetPassword] = React.useState('')
  const [resetConfirm, setResetConfirm] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  // 重置自己密码的二次确认
  const [selfConfirmTarget, setSelfConfirmTarget] = React.useState<AuthUser | null>(null)
  // 删除用户弹窗目标
  const [deleteTarget, setDeleteTarget] = React.useState<AuthUser | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // 加载用户列表（仅管理员可调用，服务端同样 403 拦截）
  React.useEffect(() => {
    if (!isAdmin) return
    const api = window.electronAPI.listUsers
    if (!api) return
    api()
      .then(setUsers)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '加载用户列表失败')
      })
  }, [isAdmin])

  // 兜底防御：非管理员不渲染（SettingsPanel 已隐藏 tab + 深链回退）
  if (!isAdmin) return null

  /** 判断目标用户是否为当前登录账号 */
  const isSelf = (user: AuthUser): boolean => user.id === currentUser?.id

  /** 点击「重置密码」：重置自己时先二次确认 */
  const handleResetClick = (user: AuthUser): void => {
    if (isSelf(user)) {
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

  /** 确认删除用户（confirm: true 与服务端防误删契约一致） */
  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return

    const api = window.electronAPI.deleteUser
    if (!api) return

    setDeleting(true)
    try {
      await api({ userId: deleteTarget.id, confirm: true })
      toast.success(`已删除用户 ${deleteTarget.username}`)
      setUsers((prev) => prev.filter((user) => user.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除用户失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="用户管理" description="查看全部用户、重置密码或删除账户（删除将级联清理其会话、对话与设置数据）">
        <SettingsCard>
          {users.map((user) => (
            <SettingsRow
              key={user.id}
              label={user.username}
              description={isSelf(user) ? '当前登录账号' : undefined}
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
                {/* 禁止删除自己（服务端同样拦截，前端先行隐藏避免误操作） */}
                {!isSelf(user) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(user)}
                  >
                    删除
                  </Button>
                )}
              </div>
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>

      {/* 重置密码弹窗（提交中禁止误关，与删除确认同范式） */}
      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setResetTarget(null)
            setResetPassword('')
            setResetConfirm('')
          }
        }}
        title={`重置密码：${resetTarget?.username ?? ''}`}
        confirmLabel="确认重置"
        loadingLabel="提交中…"
        loading={submitting}
        variant="default"
        onConfirm={handleResetSubmit}
      >
        <div className="space-y-2 text-left">
          <p className="text-sm text-muted-foreground">
            将直接覆盖该用户的密码，无需旧密码。请通过安全渠道告知用户新密码。
          </p>
          <SettingsSecretInput
            label="新密码"
            value={resetPassword}
            onChange={setResetPassword}
            placeholder={`${PASSWORD_MIN}-${PASSWORD_MAX} 字符`}
          />
          <SettingsSecretInput
            label="确认新密码"
            value={resetConfirm}
            onChange={setResetConfirm}
            placeholder="再次输入新密码"
          />
        </div>
      </ConfirmDialog>

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

      {/* 删除用户二次确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
        title={`删除用户「${deleteTarget?.username ?? ''}」？`}
        description="该用户的会话、对话、设置与附件等私有数据将被级联清理，此操作不可恢复。"
        confirmLabel="确认删除"
        loadingLabel="删除中…"
        loading={deleting}
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
