/**
 * 跟踪本地受控输入更新，直到 React props 把它回写确认。
 * 延迟到达的旧 echo 不应被当作真实的外部替换。
 */
export function recordLocalDraftEcho(pending: readonly string[], value: string): string[] {
  // 不能截断：一旦丢掉仍在路上的旧 echo，它到达时又会被误判成外部内容，
  // 重新触发整篇 setContent。受控状态确认最新值后调用方会立即清空此队列。
  return [...pending, value]
}

/**
 * 当 value 属于本地 echo 时返回剩余待确认的 echo；否则返回 null。
 * 消费匹配条目的同时也会丢弃已到达受控组件的更早 echo。
 */
export function consumeLocalDraftEcho(pending: readonly string[], value: string): string[] | null {
  const echoIndex = pending.indexOf(value)
  return echoIndex === -1 ? null : pending.slice(echoIndex + 1)
}
