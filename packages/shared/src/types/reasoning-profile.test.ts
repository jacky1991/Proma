import { test, expect, describe } from 'bun:test'
import {
  inferReasoningTransport,
  normalizeReasoningCapabilityLevel,
  normalizeReasoningLevel,
  resolveReasoningCapability,
  resolveReasoningProfile,
} from './reasoning-profile'

describe('inferReasoningTransport', () => {
  test('Anthropic 兼容渠道归类为 anthropic-messages', () => {
    expect(inferReasoningTransport('anthropic')).toBe('anthropic-messages')
    expect(inferReasoningTransport('kimi-api')).toBe('anthropic-messages')
    expect(inferReasoningTransport('zhipu-coding')).toBe('anthropic-messages')
    expect(inferReasoningTransport(undefined)).toBe('anthropic-messages')
  })

  test('OpenAI 协议渠道归类为 openai-completions', () => {
    expect(inferReasoningTransport('openai')).toBe('openai-completions')
    expect(inferReasoningTransport('doubao')).toBe('openai-completions')
    expect(inferReasoningTransport('custom')).toBe('openai-completions')
  })

  test('Codex / Responses 归类为 openai-responses', () => {
    expect(inferReasoningTransport('openai-codex')).toBe('openai-responses')
    expect(inferReasoningTransport('openai-responses')).toBe('openai-responses')
  })

  test('Google 归类为 other', () => {
    expect(inferReasoningTransport('google')).toBe('other')
  })
})

describe('resolveReasoningProfile', () => {
  test('K3 家族命中 kimi-k3 专属 profile（不分渠道协议）', () => {
    expect(resolveReasoningProfile({ modelId: 'k3', transport: 'anthropic-messages' })?.id).toBe('kimi-k3')
    expect(resolveReasoningProfile({ modelId: 'kimi-k3', transport: 'anthropic-messages' })?.id).toBe('kimi-k3')
    expect(resolveReasoningProfile({ modelId: 'k3-256k', transport: 'anthropic-messages' })?.id).toBe('kimi-k3')
  })

  test('GLM-5.2 命中 glm-5.2 专属 profile（不分渠道协议）', () => {
    expect(resolveReasoningProfile({ modelId: 'glm-5.2', transport: 'anthropic-messages' })?.id).toBe('glm-5.2')
    expect(resolveReasoningProfile({ modelId: 'glm-5.2', transport: 'openai-completions' })?.id).toBe('glm-5.2')
  })

  test('GPT-5.x OpenAI 渠道命中 openai-reasoning-standard', () => {
    expect(resolveReasoningProfile({ modelId: 'gpt-5.5', transport: 'openai-responses' })?.id).toBe('openai-reasoning-standard')
    expect(resolveReasoningProfile({ modelId: 'gpt-5.4', transport: 'openai-completions' })?.id).toBe('openai-reasoning-standard')
    expect(resolveReasoningProfile({ modelId: 'o4-mini', transport: 'openai-responses' })?.id).toBe('openai-reasoning-standard')
  })

  test('GPT-5.6 系列命中 openai-reasoning-max（支持 max 档位）', () => {
    expect(resolveReasoningProfile({ modelId: 'gpt-5.6', transport: 'openai-responses' })?.id).toBe('openai-reasoning-max')
    expect(resolveReasoningProfile({ modelId: 'gpt-5.6-terra', transport: 'openai-responses' })?.id).toBe('openai-reasoning-max')
  })

  test('非 reasoning 模型 / 对话变体不命中 profile', () => {
    expect(resolveReasoningProfile({ modelId: 'gpt-4o', transport: 'openai-responses' })).toBeUndefined()
    expect(resolveReasoningProfile({ modelId: 'gpt-5-chat-latest', transport: 'openai-responses' })).toBeUndefined()
    expect(resolveReasoningProfile({ modelId: 'claude-sonnet-5', transport: 'anthropic-messages' })).toBeUndefined()
    expect(resolveReasoningProfile({ modelId: undefined, transport: 'anthropic-messages' })).toBeUndefined()
  })

  test('未验证 transport 的 profile 不返回（防止协议错配）', () => {
    // glm-5.2 只在 openai-completions 有 zai-thinking-effort；Google 协议没有已验证 encoding。
    expect(resolveReasoningProfile({ modelId: 'glm-5.2', transport: 'other' })).toBeUndefined()
    expect(resolveReasoningProfile({ modelId: 'gpt-5.5', transport: 'anthropic-messages' })).toBeUndefined()
  })
})

describe('normalizeReasoningLevel', () => {
  test('无 profile 时原样返回', () => {
    expect(normalizeReasoningLevel(undefined, 'high')).toBe('high')
    expect(normalizeReasoningLevel(undefined, undefined)).toBeUndefined()
  })

  test('K3 档位折叠到 off/low/high/max', () => {
    const k3 = resolveReasoningProfile({ modelId: 'k3', transport: 'anthropic-messages' })!
    expect(normalizeReasoningLevel(k3, 'off')).toBe('off')
    expect(normalizeReasoningLevel(k3, 'minimal')).toBe('low')
    expect(normalizeReasoningLevel(k3, 'medium')).toBe('high')
    expect(normalizeReasoningLevel(k3, 'xhigh')).toBe('max')
  })

  test('GLM-5.2 档位折叠到 off/high/max', () => {
    const glm = resolveReasoningProfile({ modelId: 'glm-5.2', transport: 'anthropic-messages' })!
    expect(normalizeReasoningLevel(glm, 'off')).toBe('off')
    expect(normalizeReasoningLevel(glm, 'low')).toBe('high')
    expect(normalizeReasoningLevel(glm, 'xhigh')).toBe('max')
  })

  test('OpenAI standard 档位折叠且 max 降级为 xhigh', () => {
    const gpt55 = resolveReasoningProfile({ modelId: 'gpt-5.5', transport: 'openai-responses' })!
    expect(normalizeReasoningLevel(gpt55, 'max')).toBe('xhigh')
    expect(normalizeReasoningLevel(gpt55, 'minimal')).toBe('low')
    expect(normalizeReasoningLevel(gpt55, undefined)).toBe('high')
  })

  test('OpenAI max profile 保留 max 档位', () => {
    const gpt56 = resolveReasoningProfile({ modelId: 'gpt-5.6', transport: 'openai-responses' })!
    expect(normalizeReasoningLevel(gpt56, 'max')).toBe('max')
  })
})

describe('resolveReasoningCapability', () => {
  test('专属 profile 优先于 Pi catalog', () => {
    const capability = resolveReasoningCapability({
      profile: resolveReasoningProfile({ modelId: 'k3', transport: 'anthropic-messages' }),
      catalog: { reasoning: false },
    })
    expect(capability?.source).toBe('profile')
    expect(capability?.levels).toEqual(['off', 'low', 'high', 'max'])
  })

  test('仅 catalog 时导出声明档位', () => {
    const capability = resolveReasoningCapability({
      catalog: { reasoning: true, thinkingLevelMap: { off: null, low: 'low', high: 'high' } },
    })
    expect(capability?.source).toBe('pi-catalog')
    expect(capability?.levels).toContain('low')
    expect(capability?.levels).toContain('high')
    expect(capability?.levels).not.toContain('xhigh')
  })

  test('catalog 无 reasoning 时不返回 capability', () => {
    expect(resolveReasoningCapability({ catalog: { reasoning: false } })).toBeUndefined()
    expect(resolveReasoningCapability({})).toBeUndefined()
  })
})

describe('normalizeReasoningCapabilityLevel', () => {
  const capability = { source: 'pi-catalog' as const, levels: ['off', 'low', 'high'] as const, defaultLevel: 'high' as const }

  test('可用档位直接返回', () => {
    expect(normalizeReasoningCapabilityLevel(capability, 'low')).toBe('low')
  })

  test('不可用档位向更高档位靠拢，再回退', () => {
    expect(normalizeReasoningCapabilityLevel(capability, 'xhigh')).toBe('high')
    expect(normalizeReasoningCapabilityLevel(capability, 'minimal')).toBe('low')
  })

  test('缺省使用 defaultLevel', () => {
    expect(normalizeReasoningCapabilityLevel(capability, undefined)).toBe('high')
  })

  test('无 capability 时原样返回', () => {
    expect(normalizeReasoningCapabilityLevel(undefined, 'medium')).toBe('medium')
  })
})
