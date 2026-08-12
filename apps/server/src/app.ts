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
import { file } from './routes/file'
import { auth } from './routes/auth'
import { user } from './routes/user'
import { authMiddleware, AUTH_EXEMPT_PATHS } from './middleware/auth'
import { adminOnly } from './middleware/role'
import { getConnectionCount, getBufferedSessionCount } from './ws'
import { orchestrator } from './engine'
import { getServerVersion } from './utils/version'
import { createLogger } from '@proma/server-core/logger'
import { serveStatic } from 'hono/bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const app = new Hono()

/** 模块日志器 */
const logger = createLogger('服务器')

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
  c.json({ ok: true, name: 'proma-server', version: getServerVersion() }),
)

// 全局认证中间件：豁免路径（健康检查 / 注册 / 登录 / 刷新）直接放行，
// 其余 /api/* 请求必须携带有效 Bearer token。
app.use('/api/*', async (c, next) => {
  if (AUTH_EXEMPT_PATHS.includes(c.req.path)) {
    return next()
  }
  return authMiddleware(c, next)
})

/**
 * 运行时指标（仅管理员）
 * GET /api/metrics → { wsConnections, activeSessions, bufferedSessions, uptimeSec, version }
 *
 * 不在 AUTH_EXEMPT_PATHS：需登录（全局 authMiddleware）+ 管理员（adminOnly），
 * 避免向普通用户暴露内部规模信息（AC-5 / AC-6）。
 */
app.get('/api/metrics', adminOnly, (c) =>
  c.json({
    wsConnections: getConnectionCount(),
    activeSessions: orchestrator.getActiveSessionCount(),
    bufferedSessions: getBufferedSessionCount(),
    uptimeSec: Math.floor(process.uptime()),
    version: getServerVersion(),
  }),
)

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
app.route('/api', file)

// ─── 同源前端静态资源服务（仅 PROMA_WEB_DIST 设置且目录存在时启用）───
// /api/* 已在前挂载；/ws 已在 index.ts 的 Bun.serve.fetch 内早于 app.fetch 拦截。
// 开发模式（未设 PROMA_WEB_DIST）不启用，仍由 vite(5174) 提供前端。
const WEB_DIST = process.env.PROMA_WEB_DIST
if (WEB_DIST && existsSync(WEB_DIST)) {
  // 1) 根路径显式返回 index.html（避免 serveStatic 把目录 '/' 当文件命中）
  app.get('/', (c) => new Response(Bun.file(join(WEB_DIST, 'index.html'))))

  // 2) 静态资源（/assets/*、favicon、带 hash 的文件）。未命中文件 → next() 落入 fallback
  app.get('*', serveStatic({ root: WEB_DIST }))

  // 3) SPA history fallback：深路径未命中静态文件 → index.html。
  //    显式排除 /api/* 与 /ws，让未匹配的 API 请求返回 404 JSON 而非 HTML。
  app.get('*', async (c) => {
    const { pathname } = new URL(c.req.url)
    if (pathname === '/ws' || pathname.startsWith('/api/')) {
      return c.notFound()
    }
    return new Response(Bun.file(join(WEB_DIST, 'index.html')))
  })

  logger.info('已启用同源前端静态资源服务', { webDist: WEB_DIST })
}

/**
 * 全局错误处理
 *
 * service 层（@proma/server-core/*）在参数校验、权限边界等场景抛出的 Error，
 * 统一透传中文 message 为 `{ error }` + 400，让前端 http-client 能取到 body.error 展示。
 * 未识别的异常返回 500 + 通用文案，避免泄漏堆栈等内部信息。
 *
 * 未加此前，任何路由 handler 内的 throw 都会被 Hono 默认处理器吞成不透明 500
 * （非 `{error}` 响应体），导致用户只看到「HTTP 500」而看不到原因。
 */
app.onError((err, c) => {
  if (err instanceof Error) {
    logger.warn('请求处理失败', { path: c.req.path, message: err.message })
    return c.json({ error: err.message }, 400)
  }
  logger.error('未处理异常', { path: c.req.path, error: String(err) })
  return c.json({ error: '服务器内部错误' }, 500)
})

export { app }
