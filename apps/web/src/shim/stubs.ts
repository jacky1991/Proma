/**
 * 未迁移方法的统一兜底
 *
 * - notMigrated(name)：返回 reject「暂未迁移」的函数（绝大多数 invoke 方法，见 AC-2）
 * - safeDefaults：纯展示类方法的安全默认值，避免 UI 启动期白屏（见 AC-1）
 *   仅收录启动期与关键展示路径会被调用、且 reject 会拖累渲染的方法
 */

/** 构造一个 reject「暂未迁移」的调用函数 */
export function notMigrated(name: string): (...args: unknown[]) => Promise<never> {
  return () => Promise.reject(new Error(`该能力暂未迁移到 Web 端：${name}`))
}

/**
 * 安全默认值表：列表类返回 []，标量/对象类返回空值或最小可用值
 * 键名须与 ElectronAPI 上的方法名一致
 */
export const safeDefaults: Record<string, () => Promise<unknown>> = {
  // 运行时 / 环境：Web 端不做本地检测，返回空占位
  getRuntimeStatus: () => Promise.resolve(null),
  reinitRuntime: () => Promise.resolve(null),
  getGitRepoStatus: () => Promise.resolve(null),
  checkEnvironment: () => Promise.resolve(null),

  // 设置 / 档案：最小可用默认（主题由 index.html 的 localStorage 脚本先行初始化）
  getSettings: () => Promise.resolve({ themeMode: 'dark' }),
  getUserProfile: () => Promise.resolve({ userName: '', avatar: '' }),
  getSystemTheme: () => Promise.resolve('dark'),

  // 各域列表：返回空列表让 UI 进入「空态」而非报错
  listChannels: () => Promise.resolve([]),
  getAgentWorkspaces: () => Promise.resolve([]),
  getSystemPrompts: () => Promise.resolve([]),
  listChatTools: () => Promise.resolve([]),
  listAutomations: () => Promise.resolve([]),
  getWorkspaceCapabilities: () => Promise.resolve(null),
  listWorkspaceFiles: () => Promise.resolve([]),
}
