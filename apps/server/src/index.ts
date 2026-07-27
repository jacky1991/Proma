// 必须最先导入：在所有业务模块加载前设置 Web 独立数据根（~/.proma-web/）
import './bootstrap'

import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { app } from './app'
import { websocketHandlers } from './ws'
import { verifyToken } from './auth/jwt'
import { getDataRoot, getProxySettingsPath } from '@proma/server-core/config-paths'
import { initAdminUser } from '@proma/server-core/user-manager'

// ─── 产品初始化 ───

// 1. 初始化目录结构
const dataRoot = getDataRoot()
for (const dir of ['users', 'agent-workspaces']) {
  const p = `${dataRoot}/${dir}`
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

// 2. 读取 admin 密码配置并初始化内置 admin 账户
// 注：生产首次启动以干净数据根起步，不做桌面数据自动迁移；
// 如需从 ~/.proma/ 迁移，手动调用 @proma/server-core/migration 的 migrateToMultiUser()。
const proxySettingsPath = getProxySettingsPath()
let adminPassword: string | undefined

if (existsSync(proxySettingsPath)) {
  try {
    const settings = JSON.parse(readFileSync(proxySettingsPath, 'utf-8'))
    adminPassword = settings.adminPassword
  } catch {
    // 配置文件解析失败，视为未设置
  }
}

if (!adminPassword) {
  console.error('')
  console.error('[启动失败] 未配置 admin 密码。')
  console.error(`  请在 ${proxySettingsPath} 中添加 "adminPassword" 字段：`)
  console.error('  {')
  console.error('    "adminPassword": "你的管理员密码",')
  console.error('    "enabled": false,')
  console.error('    ...')
  console.error('  }')
  console.error('')
  process.exit(1)
}

initAdminUser(adminPassword)

// ─── 启动 HTTP + WebSocket 服务器 ───
const port = Number(process.env.PORT ?? 3000)

const server = Bun.serve({
  port,
  async fetch(req, srv) {
    const url = new URL(req.url)
    // WebSocket 升级：/ws 路径（AC-1：连接认证）
    if (url.pathname === '/ws') {
      // 浏览器 WebSocket API 无法自定义请求头，token 只能经 query 参数传递。
      // 权衡：token 会出现在服务端访问日志中；access token 有效期 1 天，
      // 企业内网部署可接受（与部署假设一致）。
      const token = url.searchParams.get('token')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        return new Response('Unauthorized', { status: 401 })
      }

      // upgrade 时将认证结果写入连接状态，供订阅归属校验与 '*' 广播过滤使用
      if (srv.upgrade(req, {
        data: {
          userId: payload.sub,
          username: payload.username,
          role: payload.role,
          sessions: new Set<string>(),
        },
      })) {
        return // 升级成功，不返回 HTTP 响应
      }
      return new Response('WebSocket 升级失败', { status: 400 })
    }
    // 其余请求走 Hono 路由
    return app.fetch(req)
  },
  websocket: websocketHandlers,
})

console.log(`Proma server listening on http://127.0.0.1:${port}`)
console.log(`  健康检查：GET  http://127.0.0.1:${port}/api/health`)
console.log(`  WebSocket：ws://127.0.0.1:${port}/ws`)
