/**
 * BrandingHeader - 侧边栏品牌区（产品 Logo + 名称）
 *
 * 仅 Web 端渲染（桌面端 return null，保持原有顶部布局，不影响 ModeSwitcher 位置）。
 * - 展开态横排 [Logo + 产品名 ... 收起按钮]：收起按钮为纯图标、无边框，置于品牌行右侧
 *   （onToggleCollapse 提供时渲染；Agent 与 Chat 侧边栏共用）
 * - 折叠态仅居中显示 Logo 图标（rail 形态，展开按钮由各侧边栏自行渲染）
 *
 * 读取全局品牌配置（管理员设置），未配置时回退内置默认。
 */

import * as React from 'react'
import { PanelLeftClose } from 'lucide-react'
import { isWebRuntime } from '@/lib/web-runtime'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { displayLogoUrlAtom, displayProductNameAtom } from '@/atoms/branding-atoms'
import { useAtomValue } from 'jotai'

interface BrandingHeaderProps {
  /** 折叠态：仅居中显示 Logo 图标 */
  collapsed?: boolean
  /** 展开态：右侧收起按钮回调（提供时渲染纯图标按钮，无边框） */
  onToggleCollapse?: () => void
}

export function BrandingHeader({
  collapsed = false,
  onToggleCollapse,
}: BrandingHeaderProps): React.ReactElement | null {
  const logoUrl = useAtomValue(displayLogoUrlAtom)
  const productName = useAtomValue(displayProductNameAtom)

  // 仅 Web 端渲染品牌区；桌面端保持原有顶部布局
  if (!isWebRuntime()) return null

  if (collapsed) {
    // 折叠态：居中 Logo 图标（略大于展开态，作为 mini rail 焦点）
    return (
      <div className="py-2.5 flex justify-center titlebar-no-drag">
        <img
          src={logoUrl}
          alt={productName}
          className="size-10 rounded-xl object-contain"
          draggable={false}
        />
      </div>
    )
  }

  // 展开态：品牌名作为顶部锚点，Logo 与文字均略大于周围控件以突出品牌
  return (
    <div className="px-3 py-3 flex items-center gap-3 titlebar-no-drag">
      <img
        src={logoUrl}
        alt={productName}
        className="size-9 rounded-lg object-contain flex-shrink-0"
        draggable={false}
      />
      <span className="flex-1 min-w-0 text-base font-semibold tracking-tight text-foreground truncate">
        {productName}
      </span>
      {onToggleCollapse && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="收起侧边栏"
              onClick={onToggleCollapse}
              className="flex-shrink-0 size-7 flex items-center justify-center rounded-lg text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.06] transition-colors"
            >
              <PanelLeftClose size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            收起侧边栏 ({navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
