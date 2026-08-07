/**
 * Shared type definitions for proma
 */

// Placeholder types - will be expanded as needed
export interface Workspace {
  id: string
  name: string
  path: string
}

// 运行时相关类型
export * from './runtime'

// 渠道（AI 供应商）相关类型
export * from './channel'

// 代理配置相关类型
export * from './proxy'

// 品牌定制相关类型（产品名称 + Logo）
export * from './branding'

// Chat 相关类型
export * from './chat'

// Agent 相关类型
export * from './agent'
export * from './reasoning-profile'

// Agent Provider 适配器接口
export * from './agent-provider'

// 环境检测相关类型
export * from './environment'

// 第三方安装包（Git、Node.js 等）相关类型
export * from './installer'

// GitHub Release 相关类型
export * from './github'

// 系统提示词相关类型
export * from './system-prompt'

// Chat 工具（function calling）相关类型
export * from './chat-tool'

// 飞书集成相关类型
export * from './feishu'

// 钉钉集成相关类型
export * from './dingtalk'

// 微信集成相关类型
export * from './wechat'

// 定时任务（Automation）相关类型
export * from './automation'

// Web 端认证与用户管理相关类型
export * from './auth'

// 标签页共享类型（Tab 持久化数据）
export * from './tab'

// 用户档案类型
export * from './user-profile'

// 应用设置类型（主题、语音输入、通知音等）
export * from './settings'

// 客户端 API 契约（PromaClientAPI + window.electronAPI 全局声明）
export * from './client-api'
