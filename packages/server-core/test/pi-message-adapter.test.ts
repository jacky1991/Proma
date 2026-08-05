/**
 * Pi 消息适配器：terminal error 正文保留回归测试
 *
 * 钉住 #1268 的修复语义：Pi 流式在传输/服务错误前可能已生成正文，该正文应作为正常
 * assistant 输出保留，错误另作 errorSDKMsg 单独展示，而非连同 error 整条丢弃。
 */
import { describe, expect, test } from 'bun:test'
import type { AssistantMessage } from '@earendil-works/pi-ai/compat'
import type { SDKAssistantMessage } from '@proma/shared'
import {
  convertPiMessage,
  getPiAssistantErrorDetails,
  hasPiAssistantTextContent,
  stripPiAssistantError,
} from '../src/adapters/pi-message-adapter'

describe('convertPiMessage — terminal error 正文保留', () => {
  test('流失败前已生成的正文与传输错误分离保留', () => {
    const body = 'Generated assistant output must not appear inside the error card.'
    const transportError = 'peer closed connection without sending complete message body (incomplete chunked read)'
    const terminalError = convertPiMessage({
      role: 'assistant',
      content: [{ type: 'text', text: body }],
      stopReason: 'error',
      errorMessage: transportError,
    } as unknown as AssistantMessage, 'session-1') as SDKAssistantMessage

    // 错误详情取自 error.message，而非 content-first 提取（避免正文被误当 error detail）
    expect(getPiAssistantErrorDetails(terminalError)).toEqual({
      detailedMessage: transportError,
      originalError: transportError,
    })
    // 存在可保留正文
    expect(hasPiAssistantTextContent(terminalError)).toBe(true)
    // 剥离 error 后的副本不再携带错误
    expect(stripPiAssistantError(terminalError).error).toBeUndefined()
    // 正文仍在原消息里
    expect(terminalError.message.content).toEqual([{ type: 'text', text: body }])
    // 错误仍挂载（本分支 convertPiMessage 统一归类为 provider_error）
    expect(terminalError.error).toEqual({ message: transportError, errorType: 'provider_error' })
  })

  test('纯空白正文不误判为可保留内容', () => {
    const terminalError = convertPiMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '   ' }],
      stopReason: 'error',
      errorMessage: 'stream failed',
    } as unknown as AssistantMessage, 'session-1') as SDKAssistantMessage

    expect(hasPiAssistantTextContent(terminalError)).toBe(false)
  })
})
