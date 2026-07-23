import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AGENT_IPC_CHANNELS } from '@proma/shared'

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

/**
 * 示例路由：Agent 会话列表（对应 AGENT_IPC_CHANNELS.LIST_SESSIONS）
 * POST /api/agent:list-sessions → []
 *
 * 迭代 0 返回空列表以打通 shim→HTTP→server 链路；
 * 迭代 1 接入 @proma/server-core 后替换为引擎实例化结果。
 */
app.post(`/api/${AGENT_IPC_CHANNELS.LIST_SESSIONS}`, (c) => c.json([]))

export { app }
