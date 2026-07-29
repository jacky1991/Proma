// 必须最先导入：在所有业务模块加载前设置 Web 独立数据根（~/.proma-web/）
import './bootstrap'

import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { app } from './app'
import { websocketHandlers } from './ws'
import { verifyToken } from './auth/jwt'
import { validateProductionEnv } from './utils/env'
import { getDataRoot, getProxySettingsPath, seedDefaultSkills } from '@proma/server-core/config-paths'
import { upgradeDefaultSkillsInWorkspaces } from '@proma/server-core/agent-workspace-manager'
import { initAdminUser } from '@proma/server-core/user-manager'
import { createLogger } from '@proma/server-core/logger'

/** 模块日志器（启动期诊断与运行时日志统一出口） */
const logger = createLogger('启动')

// ─── 生产敏感配置强制校验（开发态 PROMA_DEV=1 跳过）───
// 生产态必须显式设置 PROMA_JWT_SECRET 与 PROMA_SERVER_MASTER_KEY，缺失即退出：
// 避免 JWT 回落公开默认密钥（可伪造任意 admin token）、渠道 API Key 明文落盘。
const envCheck = validateProductionEnv()
if (!envCheck.ok) {
  logger.error('生产模式缺少必需配置，启动中止', {
    missing: envCheck.missing,
    hint: '设置上述环境变量后重启（开发模式可设 PROMA_DEV=1 跳过）',
  })
  process.exit(1)
}

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
  logger.error('未配置 admin 密码，启动中止', {
    path: proxySettingsPath,
    hint: '请在 proxy-settings.json 中添加 adminPassword 字段，示例：{ "adminPassword": "你的管理员密码", "enabled": false }',
  })
  process.exit(1)
}

initAdminUser(adminPassword)

// 同步内置默认 Skills：bundle(packages/server-core/default-skills) → ~/.proma-web/default-skills/ → 各工作区
// 失败不阻塞启动（单 skill 异常已在内部吞掉，此处仅兜底整体异常）
try {
  seedDefaultSkills()
  upgradeDefaultSkillsInWorkspaces()
} catch (err) {
  logger.error('同步默认 Skills 失败', { error: err })
}

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

logger.info('Proma server 已启动', {
  http: `http://127.0.0.1:${port}`,
  health: 'GET /api/health',
  ws: `ws://127.0.0.1:${port}/ws`,
})
