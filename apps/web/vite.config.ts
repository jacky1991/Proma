import { defineConfig } from 'vite'
import type { OutputAsset, OutputChunk } from 'rollup'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import pkg from './package.json' with { type: 'json' }

/**
 * Web 端 Vite 配置
 *
 * 核心策略（方案 A，详见 M1 迭代 0 计划 §3.1）：
 *   root 指向 apps/electron/src/renderer，renderer 源码零改动复用。
 *   base 改为 '/'（区别于 electron 的 './'），alias 重新指向共享 renderer / types。
 *
 * shim 注入（保证 window.electronAPI 在 React 挂载前就绪，renderer/index.html 不改动）：
 *   - dev：transformIndexHtml 在源 HTML 的 main.tsx 之前插入虚拟入口 /@proma-shim/entry，
 *     resolveId 重定向到 apps/web/src/shim-entry.ts。dev 直出源 HTML，marker 保留可命中。
 *   - build：vite:build-html 的 transform 钩子会在所有 transformIndexHtml 之前把 /main.tsx
 *     替换为带 hash 与 crossorigin 的产物 URL（实测即便 enforce: 'pre' 也来不及），marker
 *     已不存在 → transformIndexHtml 路径失效。故 build 改用：
 *       1. rollupOptions.input 把 shim-entry 显式声明为入口（否则无人引用会被剔除）；
 *       2. writeBundle 在产物 index.html 里找到 main 入口 script，在其前插入 shim chunk
 *          的 <script> 引用，确保 shim 在 main 之前执行（module script 按文档序执行）。
 */

// renderer 源码零改动复用（方案 A）：root 指向 electron renderer
const rendererRoot = resolve(__dirname, '../electron/src/renderer')
const electronSrc = resolve(__dirname, '../electron/src')

// shim 虚拟入口：dev 期被注入到 index.html，重定向到真实 shim-entry.ts
const SHIM_VIRTUAL_ID = '/@proma-shim/entry'
const SHIM_ENTRY_FILE = resolve(__dirname, 'src/shim-entry.ts')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'proma-web-shim-inject',
      // dev 注入路径：源 HTML 中 marker 仍是原始 /main.tsx 形式
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
      // build 注入路径：在打包产物 index.html 的 main 入口 script 前插入 shim chunk 引用。
      //   用 writeBundle（而非 generateBundle）——vite:build-html 在其 generateBundle 中才
      //   发射最终 HTML asset，本插件默认顺序的 generateBundle 早于它，拿不到 HTML asset。
      //   writeBundle 在所有 generateBundle 之后执行，此时 HTML 已写入磁盘，直接改写文件。
      writeBundle(_opts, bundle) {
        const htmlAsset = Object.values(bundle).find(
          (v): v is OutputAsset => v.type === 'asset' && v.fileName.endsWith('.html'),
        )
        if (!htmlAsset || typeof htmlAsset.source !== 'string') {
          console.warn('[proma-web] 未在产物中找到 index.html，跳过 shim 注入')
          return
        }

        const shimChunk = Object.values(bundle).find(
          (v): v is OutputChunk =>
            v.type === 'chunk' && !!v.facadeModuleId?.endsWith('shim-entry.ts'),
        )
        if (!shimChunk) {
          console.warn('[proma-web] 未找到 shim-entry chunk，跳过 HTML 注入')
          return
        }

        // main 入口 script 形如 <script type="module" crossorigin src="/assets/index-HASH.js"></script>
        const mainScriptRe = /<script type="module" crossorigin src="[^"]+"><\/script>/
        const match = htmlAsset.source.match(mainScriptRe)
        if (!match) {
          console.warn('[proma-web] 未匹配到 main 入口 script，跳过 shim 注入')
          return
        }

        const shimTag = `<script type="module" crossorigin src="/${shimChunk.fileName}"></script>`
        const nextSource = htmlAsset.source.replace(match[0], `${shimTag}\n    ${match[0]}`)

        // bundle.source 已被 Vite 写入磁盘，此处同步更新内存与磁盘
        htmlAsset.source = nextSource
        const htmlPath = resolve(rendererRoot, 'dist', htmlAsset.fileName)
        try {
          writeFileSync(htmlPath, nextSource, 'utf-8')
          console.info(`[proma-web] 已在 index.html 注入 shim 入口：/${shimChunk.fileName}`)
        } catch (error) {
          console.error('[proma-web] 写回 index.html 失败:', error)
        }
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
  build: {
    rollupOptions: {
      // shim-entry 作为显式入口：否则 build 产物中无人引用会被 Rollup 剔除
      input: {
        main: resolve(rendererRoot, 'index.html'),
        'proma-shim': SHIM_ENTRY_FILE,
      },
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
