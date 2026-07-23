/**
 * 事件流下沉端口
 *
 * 抽象 Agent 运行时事件向外的推送通道，去耦 Electron webContents.send。
 * - Electron 侧：实现为 webContents.send（向渲染进程广播）
 * - Server 侧：实现为 WebSocket 推送（M2 迭代 3 落地，多连接广播 + 断线重连 + 事件补偿）
 *
 * 本迭代（M1）核心域 manager 层不直接 emit；端口预留给 M2 迁移 orchestrator 时使用。
 */
export interface StreamSink {
  /** 向指定会话推送一个事件 payload。 */
  emit(sessionId: string, payload: unknown): void
}
