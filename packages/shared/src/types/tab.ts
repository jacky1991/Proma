/**
 * 标签页共享类型
 *
 * Tab 数据会持久化到 AppSettings.tabState，属于客户端契约的一部分，
 * 由 @proma/shared 单源定义，renderer 与设置服务共同复用。
 */

/** 标签页类型（Settings 不作为 Tab，保留独立视图） */
export type TabType = 'chat' | 'agent' | 'scratch' | 'preview'

/** 标签页数据 */
export interface TabItem {
  /** 唯一标签 ID（直接使用 sessionId） */
  id: string
  /** 标签页类型 */
  type: TabType
  /** Chat conversationId 或 Agent sessionId */
  sessionId: string
  /** 标签页显示标题 */
  title: string
}
