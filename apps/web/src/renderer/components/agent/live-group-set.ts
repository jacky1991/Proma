import { getSDKCompactStatus, type SDKMessage, type SDKSystemMessage } from '@proma/shared'
import type { MessageGroup } from './SDKMessageRenderer'

interface BuildLiveGroupSetOptions {
  allGroups: MessageGroup[]
  liveMessages?: readonly SDKMessage[] | null
  streaming: boolean
}

const EMPTY_LIVE_GROUPS: ReadonlySet<MessageGroup> = new Set<MessageGroup>()

/**
 * 只有会话仍在流式输出时，liveMessages 才代表“运行中的消息”。
 * 流式结束后它只是防闪烁桥接数据，不应继续触发展开态、隐藏操作栏等 live UI。
 */
export function buildLiveGroupSet({
  allGroups,
  liveMessages,
  streaming,
}: BuildLiveGroupSetOptions): ReadonlySet<MessageGroup> {
  if (!streaming || !liveMessages || liveMessages.length === 0) return EMPTY_LIVE_GROUPS

  // 自主压缩会在同一 stream 内插入 system 压缩状态，并在完成后继续输出。
  // 这时压缩前的 assistant 消息仍属于当前运行的 liveMessages；若仍标为 live，
  // 它的 ProcessBlockGroup 会一直保持展开。以最近压缩状态为边界，仅让
  // 压缩后新产生的消息驱动 live UI，前一段随即进入完成态并自动折叠。
  const latestCompactionIndex = liveMessages.findLastIndex((message) => (
    message.type === 'system'
      && getSDKCompactStatus(message as SDKSystemMessage) != null
  ))
  const currentSegmentMessages = latestCompactionIndex >= 0
    ? liveMessages.slice(latestCompactionIndex + 1)
    : liveMessages
  const liveSet = new Set<SDKMessage>(currentSegmentMessages)
  const result = new Set<MessageGroup>()

  for (const group of allGroups) {
    if (group.type === 'user' || group.type === 'system') {
      if (liveSet.has(group.message as SDKMessage)) {
        result.add(group)
      }
      continue
    }

    // assistant-turn 可能被 mergeAdjacentSameModelTurns 合并，
    // 需检查任意一条 assistantMessage 是否来自实时流。
    if (group.assistantMessages.some((message) => liveSet.has(message as SDKMessage))) {
      result.add(group)
    }
  }

  return result
}
