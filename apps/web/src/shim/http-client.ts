/**
 * HTTP 客户端：已迁移的 invoke 方法走此封装 → POST /api/<channel>
 *
 * 约定：shim 将 ipcRenderer.invoke(channel, ...args) 映射为 POST /api/<channel>，
 *   args 经 JSON 序列化为请求体（无参时不发 body）。
 *   响应体 JSON 解析后返回；空 body（如删除类接口）返回 undefined。
 */

export interface ShimConfig {
  /** HTTP 接口基址，默认 '/api'（dev 期由 vite 代理到 server） */
  apiBase: string
  /** WebSocket 基址，默认 '/ws'（M2 迭代 3 启用） */
  wsBase: string
}

/** 构造一个绑定 apiBase 的 invoke 函数 */
export function createHttpClient(apiBase: string) {
  return async function invoke<T = unknown>(channel: string, args?: unknown): Promise<T> {
    const res = await fetch(`${apiBase}/${channel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: args === undefined ? undefined : JSON.stringify(args),
    })
    if (!res.ok) {
      throw new Error(`接口 ${channel} 调用失败：HTTP ${res.status}`)
    }
    // 部分接口无返回体（删除 / 更新类），容忍空 body
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }
}
