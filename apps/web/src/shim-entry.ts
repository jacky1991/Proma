/**
 * Web 端入口前置：在 React 挂载前注入 window.electronAPI shim
 *
 * 由 vite.config.ts 的 proma-web-shim-inject 插件注入到 renderer/index.html 的
 *   <script src="/main.tsx"> 之前执行（renderer/index.html 零改动）。
 *
 * window.electronAPI 的全局类型声明来自 preload 的 `declare global`
 *   （经 shim/types.ts 的 type-only 引用链加载），此处无需重复声明。
 *
 * 路由守卫（JWT 认证）：
 *   - 始终注入 shim（已登录时正常可用；未登录时 safeDefaults 兜底不崩溃）
 *   - URL 为 /login 或无 access token → 渲染全屏 LoginPage 遮罩
 *   - 登录成功后 LoginPage 执行 window.location.href = '/' 整页刷新，进入正常流程
 */
import { createShim } from './shim'
import { isAuthenticated } from './shim/auth-store.ts'

// Web 运行环境标志：renderer 经 isWebRuntime() 读取，用于条件渲染账号设置等 Web 专属 UI。
// 全局类型声明见 renderer/lib/web-runtime.ts；此处用局部断言（web tsconfig 不含 renderer）。
;(window as Window & { __PROMA_WEB__?: boolean }).__PROMA_WEB__ = true

window.electronAPI = createShim({ apiBase: '/api', wsBase: '/ws' })

if (import.meta.env.DEV) {
  // 开发期标记，便于在控制台确认 shim 已生效
  console.info('[proma-web] electronAPI shim 已注入（已迁移方法走 /api，其余为 stub）')
}

// ===== 路由守卫：未登录时渲染 LoginPage 遮罩 =====
const needLogin = window.location.pathname === '/login' || !isAuthenticated()

if (needLogin) {
  // 同步创建全屏遮罩（防止主应用闪现），背景色与 LoginPage 一致
  const loginRoot = document.createElement('div')
  loginRoot.id = 'login-root'
  loginRoot.style.cssText =
    'position:fixed;inset:0;z-index:99999;overflow-y:auto;background:#0f172a'
  document.body.appendChild(loginRoot)

  // 异步加载并渲染 LoginPage（dynamic import 避免未登录时也拖慢主 bundle）
  void (async () => {
    const [{ LoginPage }, React, ReactDOM] = await Promise.all([
      import('./pages/LoginPage.tsx'),
      import('react'),
      import('react-dom/client'),
    ])
    ReactDOM.createRoot(loginRoot).render(React.createElement(LoginPage))
  })()
}
