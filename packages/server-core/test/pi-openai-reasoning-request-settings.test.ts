/**
 * Pi OpenAI Responses reasoning 请求注入测试
 *
 * 钉住 #1303 的语义：会话级推理深度必须显式写入 Responses request body 的
 * reasoning.effort（off → none，max 仅 GPT-5.6 系列），并剥离上游 reasoning.mode。
 */
import { describe, expect, test } from 'bun:test'
import { injectOpenAIReasoningLevel } from '../src/adapters/pi-openai-reasoning-request-settings'

describe('injectOpenAIReasoningLevel', () => {
  test('非对象 payload 原样返回', () => {
    expect(injectOpenAIReasoningLevel('nope', { thinkingLevel: 'high' })).toBe('nope')
  })

  test('非 OpenAI reasoning 模型不注入', () => {
    const payload = { model: 'gpt-4o', reasoning: { effort: 'high' } }
    expect(injectOpenAIReasoningLevel(payload, { thinkingLevel: 'off' })).toBe(payload)
  })

  test('关闭思考时显式写入 effort=none', () => {
    expect(injectOpenAIReasoningLevel({ model: 'gpt-5.5' }, { thinkingLevel: 'off' })).toEqual({
      model: 'gpt-5.5',
      reasoning: { effort: 'none' },
    })
  })

  test('直接 Codex provider stream 补全选定的非 off effort', () => {
    expect(injectOpenAIReasoningLevel({ model: 'gpt-5.5' }, { thinkingLevel: 'high' })).toEqual({
      model: 'gpt-5.5',
      reasoning: { effort: 'high' },
    })
  })

  test('GPT-5.6 max 档位保留 max effort', () => {
    expect(injectOpenAIReasoningLevel({ model: 'gpt-5.6-terra' }, { thinkingLevel: 'max' })).toEqual({
      model: 'gpt-5.6-terra',
      reasoning: { effort: 'max' },
    })
  })

  test('上游 reasoning.mode 从请求中剥离', () => {
    expect(injectOpenAIReasoningLevel({
      model: 'gpt-5.6',
      reasoning: { effort: 'high', mode: 'pro', summary: 'auto' },
    }, { thinkingLevel: 'high' })).toEqual({
      model: 'gpt-5.6',
      reasoning: { effort: 'high', summary: 'auto' },
    })
  })

  test('已有 provider effort 值优先（不覆盖 catalog 映射）', () => {
    expect(injectOpenAIReasoningLevel({
      model: 'gpt-5.5',
      reasoning: { effort: 'medium' },
    }, { thinkingLevel: 'low' })).toEqual({
      model: 'gpt-5.5',
      reasoning: { effort: 'medium' },
    })
  })

  test('GLM-5.2 在 openai-completions 传输下不触发（仅 Responses 生效）', () => {
    const payload = { model: 'glm-5.2' }
    expect(injectOpenAIReasoningLevel(payload, { thinkingLevel: 'high' })).toBe(payload)
  })
})
