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
 * 键名须与 PromaClientAPI 上的方法名一致
 */
export const safeDefaults: Record<string, unknown> = {
  // 自动更新：Web 端不支持，返回 undefined 让 updater.ts 优雅降级
  updater: undefined,
  // 运行时 / 环境：Web 端不做本地检测，返回空占位
  getRuntimeStatus: () => Promise.resolve(null),
  reinitRuntime: () => Promise.resolve(null),
  getGitRepoStatus: () => Promise.resolve(null),
  checkEnvironment: () => Promise.resolve(null),

  // 主题：浏览器端由 matchMedia 处理，此处仅为启动期占位
  getSystemTheme: () => Promise.resolve('dark'),

  // 未迁移的列表类方法：返回空列表让 UI 进入「空态」而非报错
  // 注：已迁移到 migrated.ts 的方法（getSettings / getUserProfile / listChannels /
  //     getAgentWorkspaces / getWorkspaceCapabilities 等）由 Proxy 优先命中 migrated，
  //     不在此处重复声明。
  getSystemPrompts: () => Promise.resolve([]),
  listChatTools: () => Promise.resolve([]),
  listWorkspaceFiles: () => Promise.resolve([]),
  // 飞书绑定：Web 端尚未迁移飞书集成，定时任务表单进入空态（无可选绑定）而非报错
  listFeishuBindings: () => Promise.resolve([]),

  // Agent 状态清理：Web 端无实际状态需要清理，no-op
  clearAgentCompletionState: () => Promise.resolve(),

  // 桌面专属：用默认 App 打开文件，Web 端不支持
  getDefaultAppForFile: () => Promise.resolve(null),
}
