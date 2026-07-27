// 必须最先导入：在所有业务模块加载前设置 Web 独立数据根（~/.proma-web/）
import './bootstrap'

import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { app } from './app'
import { websocketHandlers } from './ws'
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
  fetch(req, srv) {
    const url = new URL(req.url)
    // WebSocket 升级：/ws 路径
    if (url.pathname === '/ws') {
      // upgrade 时初始化连接状态（subscriptions 集合），open 中无需重复赋值
      if (srv.upgrade(req, { data: { sessions: new Set<string>() } })) {
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
