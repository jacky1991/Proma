/**
 * UserAvatar - 用户头像组件
 *
 * 对标 Cherry Studio 的 EmojiAvatar 设计：
 * - 支持 emoji 字符串（直接渲染文字）
 * - 支持 data:image/* 内联图片（渲染为图片）
 * - 可配置大小
 * - 圆角 20%，柔和边框
 *
 * 安全：仅接受 emoji 与 data:image/*（本地图）。远程 http(s) 头像不发请求、
 * 直接降级为默认占位图标——避免历史数据里的外链头像（如 Google 头像）
 * 触发不可达请求（ERR_CONNECTION_TIMED_OUT）。头像设置入口（GeneralSettings）
 * 本就只产出 emoji 与 data:image，远程 URL 属未文档化死分支。
 */

import * as React from 'react'
import { UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UserAvatarProps {
  /** 头像内容（emoji 字符串 或 data:image/* 内联图片） */
  avatar: string
  /** 尺寸（像素），默认 35 */
  size?: number
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

/** 判断是否为内联图片（仅 data:image/*，不含远程 http） */
function isDataImage(avatar: string): boolean {
  return avatar.startsWith('data:image')
}

/** 判断是否为无效头像（空串或远程 URL）→ 走默认占位 */
function isInvalidAvatar(avatar: string): boolean {
  return !avatar || avatar.startsWith('http')
}

export function UserAvatar({
  avatar,
  size = 35,
  className,
  onClick,
}: UserAvatarProps): React.ReactElement {
  const fontSize = Math.round(size * 0.5)
  const iconSize = Math.round(size * 0.5)

  // 内联图片头像
  if (isDataImage(avatar)) {
    return (
      <div
        className={cn(
          'shrink-0 overflow-hidden rounded-[20%] border-[0.5px] border-foreground/10',
          onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
          className
        )}
        style={{ width: size, height: size }}
        onClick={onClick}
      >
        <img
          src={avatar}
          alt="用户头像"
          className="size-full object-cover"
        />
      </div>
    )
  }

  // 无效头像（空 / 远程 http）：降级为默认占位图标，不渲染文本、不发远程请求
  const showPlaceholder = isInvalidAvatar(avatar)

  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-center rounded-[20%]',
        'bg-foreground/[0.04] dark:bg-foreground/[0.08] border-[0.5px] border-foreground/10',
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
        className
      )}
      style={{ width: size, height: size, fontSize }}
      onClick={onClick}
    >
      {showPlaceholder ? (
        <UserIcon
          className="text-foreground/40"
          style={{ width: iconSize, height: iconSize }}
        />
      ) : (
        avatar
      )}
    </div>
  )
}
