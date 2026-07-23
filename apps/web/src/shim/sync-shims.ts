/**
 * sendSync / 同步调用的浏览器降级
 *
 * 浏览器无同步 IPC：
 *   - updateSettingsSync / saveScratchPadSync 等 sendSync 调用降级为异步 Promise
 *     （调用方多为 fire-and-forget，影响可控；真实实现见后续迭代）
 *   - getPathForFile（webUtils 同步语义）在 Web 端无文件系统，返回空串占位
 *     （在 shim/index.ts 的 Proxy 中直接特判）
 */

/** 将同步方法降级为 resolve(undefined) 的异步函数 */
export function syncAsAsync(_name: string): (...args: unknown[]) => Promise<void> {
  return () => Promise.resolve()
}
