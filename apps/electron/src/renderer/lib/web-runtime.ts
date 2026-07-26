/**
 * Web 运行环境探测
 *
 * renderer 为 Electron / Web 双端共用；Web 端由 apps/web 的 shim-entry
 * 在注入 electronAPI shim 前设置 window.__PROMA_WEB__ = true。
 * 需要条件渲染 Web 专属 UI（如账号设置）时使用 isWebRuntime()。
 */

declare global {
  interface Window {
    /** Web shim 注入的运行环境标志（Electron 壳内恒为 undefined） */
    __PROMA_WEB__?: boolean
  }
}

/**
 * 是否运行于 Web shim 环境
 *
 * Electron 壳内恒为 false。
 */
export function isWebRuntime(): boolean {
  return window.__PROMA_WEB__ === true
}
