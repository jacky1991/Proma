import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

/**
 * Web 端 Vite 配置
 *
 * 核心策略（方案 A，详见 M1 迭代 0 计划 §3.1）：
 *   root 指向 apps/electron/src/renderer，renderer 源码零改动复用。
 *   base 改为 '/'（区别于 electron 的 './'），alias 重新指向共享 renderer / types。
 *
 * shim 注入：通过 transformIndexHtml 在 renderer/index.html 的 main.tsx 之前
 *   插入虚拟入口 /@proma-shim/entry，再 resolveId 重定向到 apps/web/src/shim-entry.ts，
 *   保证 window.electronAPI 在 React 挂载前就绪（renderer/index.html 不改动）。
 */

// renderer 源码零改动复用（方案 A）：root 指向 electron renderer
const rendererRoot = resolve(__dirname, '../electron/src/renderer')
const electronSrc = resolve(__dirname, '../electron/src')

// shim 虚拟入口：被注入到 index.html，重定向到真实 shim-entry.ts
const SHIM_VIRTUAL_ID = '/@proma-shim/entry'
const SHIM_ENTRY_FILE = resolve(__dirname, 'src/shim-entry.ts')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'proma-web-shim-inject',
      transformIndexHtml(html) {
        const marker = '<script type="module" src="/main.tsx"></script>'
        if (!html.includes(marker)) return html
        return html.replace(
          marker,
          `<script type="module" src="${SHIM_VIRTUAL_ID}"></script>\n    ${marker}`,
        )
      },
      resolveId(id) {
        if (id === SHIM_VIRTUAL_ID) return SHIM_ENTRY_FILE
        return null
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: rendererRoot,
  base: '/',
  resolve: {
    alias: {
      '@/types': resolve(electronSrc, 'types'),
      '@': rendererRoot,
    },
  },
  css: {
    // root 在 electron renderer 下，需显式指定 apps/web 的 postcss 配置
    postcss: resolve(__dirname, 'postcss.config.js'),
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    open: false,
    // 允许 dev server 读取 root 外的源码（apps/web shim、apps/electron renderer/types、packages/*）
    fs: {
      allow: [
        resolve(__dirname),
        resolve(__dirname, '../electron'),
        resolve(__dirname, '../..'),
      ],
    },
    // 将 /api 与 /ws 代理到本地 server，shim 内以相对路径调用即可，浏览器无跨域
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
})
