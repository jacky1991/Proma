/**
 * LazyFallback — React.lazy 组件加载期间的统一占位
 *
 * 所有路由级 / 重型库懒加载的 Suspense fallback 统一引用此处，
 * 避免每个使用处重复写 spinner，也便于日后全局调整占位样式。
 */
import * as React from 'react'
import { LoadingIndicator } from './loading-indicator'
import { cn } from '@/lib/utils'

export interface LazyFallbackProps {
  className?: string
}

export function LazyFallback({ className }: LazyFallbackProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex min-h-[40px] items-center justify-center text-muted-foreground',
        className,
      )}
    >
      <LoadingIndicator size="sm" />
    </div>
  )
}
