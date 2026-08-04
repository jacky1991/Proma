/**
 * 品牌定制相关类型定义
 *
 * 品牌配置（产品名称 + Logo）存储在全局共享的 branding-config.json 中，
 * 由管理员通过设置面板配置，对所有用户可见（读取公开、写入仅管理员）。
 */

/**
 * 品牌配置（产品名称 + Logo）
 *
 * 所有字段可选：未配置时由前端回退到内置默认值（产品名 "Proma"、内置 Logo）。
 */
export interface BrandingConfig {
  /** 产品名称，缺省回退 "Proma" */
  productName?: string
  /**
   * Logo base64 data URL（如 "data:image/png;base64,..."）。
   * 缺省回退内置 Logo；传入 undefined / 空串表示清除自定义 Logo。
   * 服务端限制：仅接受 image/* 前缀，解码后 ≤ 512KB。
   */
  logoDataUrl?: string
}
