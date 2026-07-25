import { app } from './app'
import { websocketHandlers } from './ws'

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
