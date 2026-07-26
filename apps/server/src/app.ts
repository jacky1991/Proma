import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { agent } from './routes/agent'
import { channel } from './routes/channel'
import { settings } from './routes/settings'
import { systemPrompt } from './routes/system-prompt'
import { chat } from './routes/chat'
import { upload } from './routes/upload'
import { chatTool } from './routes/chat-tool'
import { storage } from './routes/storage'
import { automation } from './routes/automation'
import { auth } from './routes/auth'
import { user } from './routes/user'
import { authMiddleware, AUTH_EXEMPT_PATHS } from './middleware/auth'

const app = new Hono()

// 开发期 CORS：允许 web 端（127.0.0.1:5174）直连。
// dev 期 vite 已做 /api 代理（同源），此处仅为直连场景兜底。
app.use(
  '/api/*',
  cors({ origin: ['http://127.0.0.1:5174', 'http://localhost:5174'] }),
)

/**
 * 健康检查
 * GET /api/health → { ok: true, name, version }
 */
app.get('/api/health', (c) =>
  c.json({ ok: true, name: 'proma-server', version: '0.0.1' }),
)

// 全局认证中间件：豁免路径（健康检查 / 注册 / 登录 / 刷新）直接放行，
// 其余 /api/* 请求必须携带有效 Bearer token。
app.use('/api/*', async (c, next) => {
  if (AUTH_EXEMPT_PATHS.includes(c.req.path)) {
    return next()
  }
  return authMiddleware(c, next)
})

// 挂载认证路由（注册/登录/刷新已由 AUTH_EXEMPT_PATHS 豁免；/auth:me 与 /auth:change-password 自带行内中间件）
app.route('/api', auth)

// 挂载用户管理路由（全部经 adminOnly 角色校验）
app.route('/api', user)

// 挂载业务路由
app.route('/api', agent)
app.route('/api', channel)
app.route('/api', settings)
app.route('/api', systemPrompt)
app.route('/api', chat)
app.route('/api', upload)
app.route('/api', chatTool)
app.route('/api', storage)
app.route('/api', automation)

export { app }
