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
 *   root 指向 apps/web/src/renderer（M4 迭代 11 步骤 3 已从 apps/electron 物理搬迁至此），
 *   renderer 源码零改动复用，Web 构建完全脱离 apps/electron 目录。
 *   base 改为 '/'（区别于 electron 的 './'），alias 指向本地 renderer 与 shared 领域类型。
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

// renderer 源码零改动复用（方案 A）：root 指向本地 renderer（已搬迁至 apps/web）
const rendererRoot = resolve(__dirname, 'src/renderer')
// 领域类型别名指向共享包源码（原 electron/src/types 已迁回 @proma/shared）
const sharedTypes = resolve(__dirname, '../../packages/shared/src/types')

// shim 虚拟入口：dev 期被注入到 index.html，重定向到真实 shim-entry.ts
const SHIM_VIRTUAL_ID = '/@proma-shim/entry'
const SHIM_ENTRY_FILE = resolve(__dirname, 'src/shim-entry.ts')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'proma-web-shim-inject',
      // dev 注入路径：源 HTML 中 marker 仍是原始 /<name>.tsx 形式
      // （index.html 的 /main.tsx、widget.html 的 /widget-main.tsx 等，逐入口注入）
      transformIndexHtml(html) {
        const entryScriptRe = /<script type="module" src="\/[^"]+\.tsx"><\/script>/
        const match = html.match(entryScriptRe)
        if (!match) return html
        return html.replace(
          match[0],
          `<script type="module" src="${SHIM_VIRTUAL_ID}"></script>\n    ${match[0]}`,
        )
      },
      resolveId(id) {
        if (id === SHIM_VIRTUAL_ID) return SHIM_ENTRY_FILE
        return null
      },
      // build 注入路径：在打包产物各 HTML 的入口 script 前插入 shim chunk 引用。
      //   用 writeBundle（而非 generateBundle）——vite:build-html 在其 generateBundle 中才
      //   发射最终 HTML asset，本插件默认顺序的 generateBundle 早于它，拿不到 HTML asset。
      //   writeBundle 在所有 generateBundle 之后执行，此时 HTML 已写入磁盘，直接改写文件。
      writeBundle(_opts, bundle) {
        const shimChunk = Object.values(bundle).find(
          (v): v is OutputChunk =>
            v.type === 'chunk' && !!v.facadeModuleId?.endsWith('shim-entry.ts'),
        )
        if (!shimChunk) {
          console.warn('[proma-web] 未找到 shim-entry chunk，跳过 HTML 注入')
          return
        }

        const htmlAssets = Object.values(bundle).filter(
          (v): v is OutputAsset =>
            v.type === 'asset' && v.fileName.endsWith('.html') && typeof v.source === 'string',
        )
        if (htmlAssets.length === 0) {
          console.warn('[proma-web] 未在产物中找到 HTML，跳过 shim 注入')
          return
        }

        // 入口 script 形如 <script type="module" crossorigin src="/assets/index-HASH.js"></script>
        const entryScriptRe = /<script type="module" crossorigin src="[^"]+"><\/script>/
        const shimTag = `<script type="module" crossorigin src="/${shimChunk.fileName}"></script>`

        for (const htmlAsset of htmlAssets) {
          const source = htmlAsset.source as string
          const match = source.match(entryScriptRe)
          if (!match) {
            console.warn(`[proma-web] ${htmlAsset.fileName} 未匹配到入口 script，跳过 shim 注入`)
            continue
          }

          const nextSource = source.replace(match[0], `${shimTag}\n    ${match[0]}`)

          // bundle.source 已被 Vite 写入磁盘，此处同步更新内存与磁盘
          htmlAsset.source = nextSource
          const htmlPath = resolve(rendererRoot, 'dist', htmlAsset.fileName)
          try {
            writeFileSync(htmlPath, nextSource, 'utf-8')
            console.info(`[proma-web] 已在 ${htmlAsset.fileName} 注入 shim 入口：/${shimChunk.fileName}`)
          } catch (error) {
            console.error(`[proma-web] 写回 ${htmlAsset.fileName} 失败:`, error)
          }
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
      '@/types': sharedTypes,
      '@': rendererRoot,
    },
  },
  build: {
    rollupOptions: {
      // shim-entry 作为显式入口：否则 build 产物中无人引用会被 Rollup 剔除
      // widget：悬浮 Chatbox 独立入口（第三方 iframe 嵌入，见 docs/plans/2026-08-13-chat-floating-widget.md）
      input: {
        main: resolve(rendererRoot, 'index.html'),
        widget: resolve(rendererRoot, 'widget.html'),
        'proma-shim': SHIM_ENTRY_FILE,
      },
      output: {
        // 分桶打包 node_modules 依赖（@proma/* workspace 源码包排除），
        // 提升长缓存命中率与并行下载；已被 import() 切开的动态 chunk 不受影响。
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // workspace 源码包（软链解析到源码路径），不归入任何桶
          if (id.includes('node_modules/@proma/')) return

          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          )
            return 'react-vendor'
          if (id.includes('node_modules/@radix-ui/')) return 'radix'
          if (id.includes('node_modules/jotai/')) return 'jotai'
          if (id.includes('node_modules/@tiptap/')) return 'tiptap'
          if (id.includes('node_modules/lucide-react/')) return 'icons'

          // 数学插件栈：随 MathMarkdown 懒加载，不进同步 markdown 桶
          if (
            id.includes('node_modules/remark-math/') ||
            id.includes('node_modules/rehype-katex/') ||
            id.includes('node_modules/katex/')
          )
            return undefined

          // markdown 渲染栈（react-markdown + remark/rehype/micromark 全家桶）
          if (
            /node_modules\/(react-markdown|remark-[^/]*|rehype-[^/]*|unified|micromark[^/]*|mdast[^/]*|hast[^/]*|unist-[^/]*|vfile|trough|bail|decode-named-character-reference|character-[^/]*|trim-lines|html-url-attributes|is-plain-obj|comma-separated-tokens|space-separated-tokens|property-information|estree-[^/]*)/.test(
              id,
            )
          )
            return 'markdown'

          // 其余动态导入的重型库：不指定桶，交 Vite 按动态 import 边界自动切分，
          // 避免被下方 vendor 兜底吞入静态首屏桶
          if (
            id.includes('node_modules/mermaid/') ||
            id.includes('node_modules/@shikijs/') ||
            id.includes('node_modules/shiki/') ||
            id.includes('node_modules/cytoscape/') ||
            id.includes('node_modules/lowlight/') ||
            id.includes('node_modules/highlight.js/')
          )
            return undefined

          // 其余：交 Vite 自动决策（动态库按 import() 切，同步小库进 main）
          return undefined
        },
      },
    },
  },
  css: {
    // root 在 src/renderer 下，需显式指定 apps/web 的 postcss 配置
    postcss: resolve(__dirname, 'postcss.config.js'),
  },
  // 首次访问加速：预构建重型依赖，缓解 dev 首屏「冷启动逐文件编译」卡顿
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'jotai',
      'react-markdown',
      'remark-gfm',
      '@tiptap/core',
      '@tiptap/react',
      '@tiptap/starter-kit',
      // 注意：勿列入 @tiptap/pm —— 它是 prosemirror 聚合包，仅子路径（@tiptap/pm/state 等），
      // 无 "." 主 entry，列入会使 dev 启动报 "Missing . specifier in @tiptap/pm"
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-tabs',
      'lucide-react',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    open: false,
    // 预热首屏入口链路：dev 启动后后台转换，首次访问不再逐文件即时编译。
    // 用绝对路径规避 root 歧义（config.root 已改为 src/renderer）。
    warmup: {
      clientFiles: [
        resolve(rendererRoot, 'main.tsx'),
        resolve(rendererRoot, 'components/ai-elements/message.tsx'),
        resolve(rendererRoot, 'components/chat/ChatView.tsx'),
      ],
    },
    // 允许 dev server 读取 root 外的源码（apps/web shim/types、monorepo 根下的 packages/*）
    fs: {
      allow: [
        resolve(__dirname),
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
