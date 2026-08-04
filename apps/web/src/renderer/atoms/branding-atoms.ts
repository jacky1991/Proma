/**
 * Branding Atoms - 品牌配置状态（产品名称 + Logo）
 *
 * Web 端由 BrandingInitializer 在启动时经 window.electronAPI.getBrandingConfig 灌入；
 * 管理员通过设置面板修改后直接写入此 atom，侧边栏即时更新。
 * Electron 端 getBrandingConfig 不存在，atom 保持默认值（组件层另以 isWebRuntime 守卫不渲染品牌区）。
 */

import { atom } from 'jotai'
import type { BrandingConfig } from '@proma/shared'
// 默认 Logo（未自定义时回退）：蓝紫渐变，在浅 / 深界面均清晰
import defaultLogoUrl from '@/assets/bots/proma-logos/proma-gradient.png'

/** 默认产品名称（未配置时回退） */
export const DEFAULT_PRODUCT_NAME = 'Proma'

/** 默认 Logo URL（未配置时回退，Vite 打包的资源 URL） */
export const DEFAULT_LOGO_URL = defaultLogoUrl

/** 品牌配置原始值（null 表示尚未加载；空对象表示已加载但未配置） */
export const brandingConfigAtom = atom<BrandingConfig | null>(null)

/** 实际显示的产品名称（回退默认 "Proma"） */
export const displayProductNameAtom = atom((get) => {
  const config = get(brandingConfigAtom)
  const name = config?.productName?.trim()
  return name && name.length > 0 ? name : DEFAULT_PRODUCT_NAME
})

/** 实际显示的 Logo（自定义 data URL 或内置默认 Logo） */
export const displayLogoUrlAtom = atom((get) => {
  const config = get(brandingConfigAtom)
  const logo = config?.logoDataUrl?.trim()
  return logo && logo.length > 0 ? logo : DEFAULT_LOGO_URL
})
