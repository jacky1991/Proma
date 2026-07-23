import { app } from './app'

const port = Number(process.env.PORT ?? 3000)

Bun.serve({
  port,
  fetch: app.fetch,
  // websocket 处理器占位：M2 迭代 3 启用 AgentEventBus → WS 推送
})

console.log(`Proma server listening on http://127.0.0.1:${port}`)
console.log(`  健康检查：GET  http://127.0.0.1:${port}/api/health`)
console.log(`  示例路由：POST http://127.0.0.1:${port}/api/agent:list-sessions`)
