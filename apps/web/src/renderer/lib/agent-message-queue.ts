import type { QuotedSelection } from '@/atoms/preview-atoms'

export type QueueDropPlacement = 'before' | 'after'

export interface AgentQueuedAttachment {
  filename: string
  mediaType: string
  size: number
  targetPath: string
}

export interface AgentQueuedMessage {
  id: string
  text: string
  createdAt: number
  quotedSelection?: QuotedSelection
  fileReferenceBlock?: string
  attachments?: AgentQueuedAttachment[]
  additionalDirectories?: string[]
}

/**
 * 队列的自动消费必须由常驻调度器执行，不能依赖某个 AgentView 是否仍挂载。
 * 保留停止、后台等待和交互阻塞状态，避免在不安全的时机意外开启新一轮 run。
 */
export function shouldAutoDispatchQueuedMessage(options: {
  queueLength: number
  running: boolean
  backgroundWaiting: boolean
  stoppedByUser: boolean
  hasBlockingRequests: boolean
  hasChannel: boolean
  hasAvailableModel: boolean
}): boolean {
  return options.queueLength > 0 &&
    !options.running &&
    !options.backgroundWaiting &&
    !options.stoppedByUser &&
    !options.hasBlockingRequests &&
    options.hasChannel &&
    options.hasAvailableModel
}

export function createAgentQueuedMessage(
  text: string,
  id: string,
  createdAt: number,
  quotedSelection?: QuotedSelection | null,
  options?: {
    fileReferenceBlock?: string
    attachments?: AgentQueuedAttachment[]
    additionalDirectories?: string[]
  },
): AgentQueuedMessage {
  const message: AgentQueuedMessage = {
    id,
    text: text.trim(),
    createdAt,
  }
  if (quotedSelection) message.quotedSelection = quotedSelection
  if (options?.fileReferenceBlock) message.fileReferenceBlock = options.fileReferenceBlock
  if (options?.attachments && options.attachments.length > 0) message.attachments = options.attachments
  if (options?.additionalDirectories && options.additionalDirectories.length > 0) message.additionalDirectories = options.additionalDirectories
  return message
}

export function removeQueuedMessage(
  queue: AgentQueuedMessage[],
  messageId: string,
): AgentQueuedMessage[] {
  return queue.filter((item) => item.id !== messageId)
}

export function restoreQueuedMessageToFront(
  queue: AgentQueuedMessage[],
  message: AgentQueuedMessage,
): AgentQueuedMessage[] {
  if (queue.some((item) => item.id === message.id)) return queue
  return [message, ...queue]
}

export function moveQueuedMessage(
  queue: AgentQueuedMessage[],
  sourceId: string,
  targetId: string,
  placement: QueueDropPlacement,
): AgentQueuedMessage[] {
  if (sourceId === targetId) return queue

  const source = queue.find((item) => item.id === sourceId)
  if (!source) return queue

  const withoutSource = queue.filter((item) => item.id !== sourceId)
  const targetIndex = withoutSource.findIndex((item) => item.id === targetId)
  if (targetIndex === -1) return queue

  const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex
  return [
    ...withoutSource.slice(0, insertIndex),
    source,
    ...withoutSource.slice(insertIndex),
  ]
}

export interface ParsedQueuedMessageMentions {
  cleanedText: string
  mentionedSkills: string[]
  mentionedMcpServers: string[]
  mentionedSessionIds: string[]
}

export interface QueuedMessageSendPayload {
  rawText: string
  sdkText: string
  mentions: ParsedQueuedMessageMentions
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 把纯文本队列消息转成与 RichTextInput 段落渲染一致的 HTML：
 * 双换行分段落，单换行转 <br>，并转义 HTML 特殊字符避免破坏结构。
 * 用于撤回时保留已有草稿的富文本节点（mention 等），同时让队列文本按正常段落显示。
 */
export function queuedTextToParagraphHtml(text: string): string {
  const normalized = text.trim()
  if (!normalized) return ''
  return normalized
    .split(/\n\n+/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}


const REF_PATTERN = /\/skill:(?<skill>\S+)|#mcp:(?<mcp>\S+)|&session:(?<session>\S+)/g

/** 解码 @file 路径的百分号编码（含空格等），失败时原样返回 */
function decodeReferenceLabel(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseQueuedMessageMentions(text: string): ParsedQueuedMessageMentions {
  const mentionedSkills: string[] = []
  const mentionedMcpServers: string[] = []
  const mentionedSessionIds: string[] = []

  for (const match of text.matchAll(REF_PATTERN)) {
    const { skill, mcp, session } = match.groups ?? {}
    if (skill) mentionedSkills.push(skill)
    else if (mcp) mentionedMcpServers.push(mcp)
    else if (session) mentionedSessionIds.push(session)
  }

  return {
    cleanedText: text
      .replace(REF_PATTERN, '')
      // @file: 路径在 htmlToMarkdown 序列化时已 encodeURIComponent（路径可能含空格），
      // 这里还原为真实路径，保证 Agent 侧读取的是可访问的完整路径；
      // 仅当含百分号编码时解码，避免破坏旧的未编码路径。
      .replace(/@file:([^\s]+)/g, (full, encodedPath: string) =>
        /%[0-9A-Fa-f]{2}/.test(encodedPath)
          ? `@file:${decodeReferenceLabel(encodedPath)}`
          : full
      )
      .trim(),
    mentionedSkills,
    mentionedMcpServers,
    mentionedSessionIds,
  }
}

export function buildQueuedMessageSendPayload(
  message: AgentQueuedMessage,
  quotedSelectionBlock = '',
): QueuedMessageSendPayload {
  const text = message.text.trim()
  const mentions = parseQueuedMessageMentions(text)
  const contextBlocks = [
    message.fileReferenceBlock?.trim(),
    quotedSelectionBlock.trim(),
  ].filter((block): block is string => Boolean(block))
  const prefix = contextBlocks.length > 0
    ? `${contextBlocks.join('\n\n')}\n\n`
    : ''

  return {
    rawText: `${prefix}${text}`.trim(),
    sdkText: `${prefix}${mentions.cleanedText}`.trim(),
    mentions,
  }
}
