import { describe, expect, test } from 'bun:test'
import { buildQueuedMessageSendPayload, createAgentQueuedMessage, parseQueuedMessageMentions } from './agent-message-queue'

describe('queued message @file mention path decoding (Agent 侧真实路径)', () => {
  test('decodes percent-encoded @file path back to the real path with spaces', () => {
    const text = '请查看 @file:%2FUsers%2Fme%2FMy%20report.pdf 这份报告'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('请查看 @file:/Users/me/My report.pdf 这份报告')
  })

  test('keeps legacy unencoded @file paths unchanged', () => {
    const text = '参考 @file:notes/brief.md 内容'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('参考 @file:notes/brief.md 内容')
  })

  test('decode does not affect skill / mcp / session mentions removal', () => {
    const text = '@file:%2FUsers%2Fme%2FMy%20report.pdf /skill:brainstorming #mcp:playwright &session:session-123'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('@file:/Users/me/My report.pdf')
    expect(result.mentionedSkills).toEqual(['brainstorming'])
    expect(result.mentionedMcpServers).toEqual(['playwright'])
    expect(result.mentionedSessionIds).toEqual(['session-123'])
  })

  test('buildQueuedMessageSendPayload sdkText contains the real (decoded) file path, rawText keeps encoded', () => {
    const message = createAgentQueuedMessage('看下 @file:%2FUsers%2Fme%2FMy%20report.pdf', 'msg-1', 1234567890)
    const payload = buildQueuedMessageSendPayload(message)
    // Agent 侧 sdkText 还原为真实路径
    expect(payload.sdkText).toContain('@file:/Users/me/My report.pdf')
    // 展示/持久化 rawText 保留编码原文，避免 @file:(\S+) 正则在空格处截断
    expect(payload.rawText).toContain('@file:%2FUsers%2Fme%2FMy%20report.pdf')
  })
})
