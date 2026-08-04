/**
 * BrandingHeader - 侧边栏品牌区（产品 Logo + 名称）
 *
 * 仅 Web 端渲染（桌面端 return null，保持原有顶部布局，不影响 ModeSwitcher 位置）。
 * 展开态横排 [Logo + 产品名]，折叠态仅居中显示 Logo 图标。
 * 读取全局品牌配置（管理员设置），未配置时回退内置默认。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { isWebRuntime } from '@/lib/web-runtime'
import { displayLogoUrlAtom, displayProductNameAtom } from '@/atoms/branding-atoms'

interface BrandingHeaderProps {
  /** 折叠态：仅居中显示 Logo 图标 */
  collapsed?: boolean
}

export function BrandingHeader({ collapsed = false }: BrandingHeaderProps): React.ReactElement | null {
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
      <span className="text-base font-semibold tracking-tight text-foreground truncate">
        {productName}
      </span>
    </div>
  )
}
