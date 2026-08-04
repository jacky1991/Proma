/**
 * 品牌配置服务
 *
 * 管理全局品牌配置（产品名称 + Logo），存储在 ~/.proma-web/branding-config.json。
 * 读取对所有用户公开（侧边栏 / 登录页展示），写入仅管理员（路由层 adminOnly 拦截）。
 *
 * Logo 以 base64 data URL 内联存储，单文件可移植；限制 ≤ 512KB、仅 image/* 类型。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { BrandingConfig } from '@proma/shared'
import { getBrandingConfigPath } from './config-paths'

/** Logo base64 解码后最大字节数（512KB） */
const MAX_LOGO_BYTES = 512 * 1024

/** data URL 前缀校验：data:image/<mime>;base64,<payload> */
const DATA_URL_IMAGE_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,/

/** 默认空配置（未配置时返回，由前端兜默认值） */
const DEFAULT_BRANDING_CONFIG: BrandingConfig = {}

/**
 * 读取品牌配置
 *
 * 配置文件不存在或解析失败时返回空对象，由前端回退到内置默认值。
 */
export function getBrandingConfig(): BrandingConfig {
  const configPath = getBrandingConfigPath()

  if (!existsSync(configPath)) {
    return DEFAULT_BRANDING_CONFIG
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    return normalizeBrandingConfig(JSON.parse(raw))
  } catch (error) {
    console.error('[品牌配置] 读取配置失败:', error)
    return DEFAULT_BRANDING_CONFIG
  }
}

/**
 * 更新品牌配置（合并写入）
 *
 * @param updates 部分字段；productName 传空串、logoDataUrl 传 undefined / 空串均视为清除
 * @returns 写入后的完整配置
 */
export function updateBrandingConfig(updates: Partial<BrandingConfig>): BrandingConfig {
  const current = getBrandingConfig()
  const merged: BrandingConfig = { ...current }

  if (updates.productName !== undefined) {
    const trimmed = updates.productName.trim()
    // 空串视为不设置产品名（回退默认），避免存入无意义空白
    merged.productName = trimmed.length > 0 ? trimmed : undefined
  }

  if (updates.logoDataUrl !== undefined) {
    const logo = updates.logoDataUrl.trim()
    if (logo.length === 0) {
      // 清除自定义 Logo（回退内置默认）
      merged.logoDataUrl = undefined
    } else {
      validateLogoDataUrl(logo)
      merged.logoDataUrl = logo
    }
  }

  const configPath = getBrandingConfigPath()
  try {
    writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8')
    console.log('[品牌配置] 配置已保存:', { hasName: !!merged.productName, hasLogo: !!merged.logoDataUrl })
  } catch (error) {
    console.error('[品牌配置] 保存配置失败:', error)
    throw new Error('保存品牌配置失败')
  }

  return merged
}

/**
 * 校验 Logo data URL：必须为 image/* 前缀，解码后不超过上限
 *
 * @throws 格式错误或超限时抛出错误（路由层捕获后返回 400）
 */
function validateLogoDataUrl(logoDataUrl: string): void {
  if (!DATA_URL_IMAGE_RE.test(logoDataUrl)) {
    throw new Error('Logo 格式无效：必须是 image/* 类型的 base64 data URL')
  }
  const base64Payload = logoDataUrl.split(',', 2)[1] ?? ''
  const buffer = Buffer.from(base64Payload, 'base64')
  if (buffer.length === 0) {
    throw new Error('Logo 内容为空')
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new Error(
      `Logo 过大：${Math.round(buffer.length / 1024)}KB 超过 ${MAX_LOGO_BYTES / 1024}KB 限制`,
    )
  }
}

/**
 * 规范化读取到的配置：仅保留已知字段，剔除脏数据
 */
function normalizeBrandingConfig(raw: unknown): BrandingConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_BRANDING_CONFIG
  const obj = raw as Record<string, unknown>
  const config: BrandingConfig = {}

  if (typeof obj.productName === 'string' && obj.productName.trim().length > 0) {
    config.productName = obj.productName.trim()
  }
  if (typeof obj.logoDataUrl === 'string' && obj.logoDataUrl.length > 0) {
    config.logoDataUrl = obj.logoDataUrl
  }

  return config
}
