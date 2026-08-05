/**
 * Mention popup 工具函数：Esc 抑制 + 并发请求守卫回归测试
 *
 * 钉住 #1370 的修复语义：
 * 1. 按 Esc 关闭弹窗后，同一触发片段（位置未后移且文本延续）继续输入不应再次弹窗；
 *    用户重新输入触发符（位置后移）或片段内容变化时恢复正常。
 * 2. TipTap 并发 await items() 时，旧请求即使最后返回也不能覆盖最新弹窗。
 */
import { describe, expect, test } from 'bun:test'
import type { Editor } from '@tiptap/react'
import {
  createLatestSuggestionRequestGuard,
  shouldClearEscSuppressionOnExit,
  shouldSuppressEscTrigger,
} from './mention-popup-utils'

describe('shouldSuppressEscTrigger — Esc 后同一片段抑制再次弹窗', () => {
  test('无抑制记录或无触发文本时不抑制', () => {
    expect(shouldSuppressEscTrigger(null, { from: 5, text: '@x' })).toBe(false)
    expect(shouldSuppressEscTrigger({ from: 5, text: '@x' }, { from: 5, text: null })).toBe(false)
    expect(shouldSuppressEscTrigger({ from: 5, text: '@x' }, { from: 5, text: undefined })).toBe(false)
  })

  test('触发符位置后移 = 用户重新触发，不抑制', () => {
    expect(shouldSuppressEscTrigger({ from: 5, text: '@' }, { from: 8, text: '@' })).toBe(false)
  })

  test('位置相同且文本延续（继续输入）= 同一片段，抑制', () => {
    expect(shouldSuppressEscTrigger({ from: 5, text: '@q' }, { from: 5, text: '@qx' })).toBe(true)
  })

  test('位置前移但片段延续（删除触发符前字符）= 同一片段，抑制', () => {
    // `abc@qq` 删除前导 `a` → `bc@qq`，from 前移 1、文本开头仍是 `@qq` 的超集
    expect(shouldSuppressEscTrigger({ from: 4, text: '@qq' }, { from: 3, text: 'bc@qq' })).toBe(false)
    // 但触发文本本身是 `@qq`，前移后新片段若仍以 `@qq` 开头则延续
    expect(shouldSuppressEscTrigger({ from: 4, text: '@qq' }, { from: 3, text: '@qq' })).toBe(true)
  })

  test('片段内容已变化（不再以旧文本开头）= 新触发，不抑制', () => {
    expect(shouldSuppressEscTrigger({ from: 5, text: '@qq' }, { from: 5, text: '@ww' })).toBe(false)
  })
})

describe('shouldClearEscSuppressionOnExit — 触发符删除后清除抑制', () => {
  // 构造最小 Editor 桩：仅满足 textBetween / content.size 访问。
  function editorWith(text: string, docSize?: number): Editor {
    return {
      state: { doc: { content: { size: docSize ?? text.length }, textBetween: () => text } },
    } as unknown as Editor
  }

  test('无抑制记录不清除', () => {
    expect(shouldClearEscSuppressionOnExit(null, editorWith('@x'), { from: 0, to: 2 }, '@')).toBe(false)
  })

  test('range 越界（触发符已删除）= 清除抑制', () => {
    const editor = editorWith('@x', 10)
    expect(shouldClearEscSuppressionOnExit({ from: 0, text: '@x' }, editor, { from: -1, to: 2 }, '@')).toBe(true)
    expect(shouldClearEscSuppressionOnExit({ from: 0, text: '@x' }, editor, { from: 5, to: 5 }, '@')).toBe(true)
    expect(shouldClearEscSuppressionOnExit({ from: 0, text: '@x' }, editor, { from: 5, to: 99 }, '@')).toBe(true)
  })

  test('触发符仍在文档中 = 不清除（继续抑制）', () => {
    const editor = editorWith('@query')
    expect(shouldClearEscSuppressionOnExit({ from: 0, text: '@q' }, editor, { from: 0, to: 6 }, '@')).toBe(false)
  })

  test('range 处字符已不是触发符 = 清除抑制', () => {
    const editor = editorWith('query')
    expect(shouldClearEscSuppressionOnExit({ from: 0, text: '@q' }, editor, { from: 0, to: 5 }, '@')).toBe(true)
  })
})

describe('createLatestSuggestionRequestGuard — 过期异步请求不覆盖最新弹窗', () => {
  test('最新请求的 items 视为 latest，旧请求视为 stale', () => {
    const guard = createLatestSuggestionRequestGuard<string>()
    const old = guard.attachResult(guard.startRequest(), ['old'])
    const latest = guard.attachResult(guard.startRequest(), ['latest'])

    expect(guard.isLatest(latest)).toBe(true)
    expect(guard.isStale(latest)).toBe(false)
    expect(guard.isLatest(old)).toBe(false)
    expect(guard.isStale(old)).toBe(true)
  })

  test('未登记 requestId 的 items 既非 latest 也非 stale', () => {
    const guard = createLatestSuggestionRequestGuard<string>()
    guard.startRequest()
    const foreign = ['foreign']
    expect(guard.isLatest(foreign)).toBe(false)
    expect(guard.isStale(foreign)).toBe(false)
  })
})
