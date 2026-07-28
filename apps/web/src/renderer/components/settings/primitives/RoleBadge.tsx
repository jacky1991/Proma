/**
 * RoleBadge - 用户角色徽章
 *
 * 账号设置（AccountSettings）与用户管理（UserSettings）共用。
 */

import * as React from 'react'
import type { AuthUser } from '@proma/shared'
import { Badge } from '@/components/ui/badge'

export function RoleBadge({ role }: { role: AuthUser['role'] }): React.ReactElement {
  return (
    <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
      {role === 'admin' ? '管理员' : '普通用户'}
    </Badge>
  )
}
