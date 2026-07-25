/**
 * Agent runtime 适配器（简化版）
 *
 * M2 迭代 3：Claude runtime 已移除，Pi 为唯一 Agent runtime。
 * 保留此模块仅为兼容 Electron 端 re-export 链（避免 import 路径断裂）。
 * 直接 re-export PiAgentAdapter。
 */

export { PiAgentAdapter } from './pi-agent-adapter'

/** @deprecated 使用 PiAgentAdapter 替代。保留仅为兼容旧 import 路径。 */
export { PiAgentAdapter as RuntimeRoutingAgentAdapter } from './pi-agent-adapter'
