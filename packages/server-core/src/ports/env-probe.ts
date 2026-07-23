/**
 * 环境探针端口
 *
 * 抽象 Electron app / shell 的运行时环境信息，去耦 `require('electron')` 与 `shell.openExternal`。
 * 由消费者在启动时注入（Electron 传 app.isPackaged；Server 侧固定或读 env）。
 */
export interface EnvProbe {
  /** 是否为打包产物（对应 Electron app.isPackaged；区分 dev/packed 与 .asar 路径转换）。 */
  isPackaged: boolean
  /** 应用版本号，用于构造 HTTP User-Agent（对应根 package.json 的 version）。 */
  version: string
  /** 打开外部 URL（对应 Electron shell.openExternal；Codex OAuth 等浏览器跳转用）。Server 侧可返回 URL 由前端打开。 */
  openExternal?(url: string): Promise<void> | void
  /** 打包资源目录（对应 process.resourcesPath；仅 Electron 打包态有意义）。 */
  resourcesPath?: string
}
