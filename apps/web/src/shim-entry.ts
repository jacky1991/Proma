/**
 * Web 端入口前置：在 React 挂载前注入 window.electronAPI shim
 *
 * 由 vite.config.ts 的 proma-web-shim-inject 插件注入到 renderer/index.html 的
 *   <script src="/main.tsx"> 之前执行（renderer/index.html 零改动）。
 *
 * window.electronAPI 的全局类型声明来自 preload 的 `declare global`
 *   （经 shim/types.ts 的 type-only 引用链加载），此处无需重复声明。
 */
import { createShim } from './shim'

window.electronAPI = createShim({ apiBase: '/api', wsBase: '/ws' })

if (import.meta.env.DEV) {
  // 开发期标记，便于在控制台确认 shim 已生效
  console.info('[proma-web] electronAPI shim 已注入（已迁移方法走 /api，其余为 stub）')
}
