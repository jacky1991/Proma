import { describe, expect, test } from 'bun:test'
import { mentionUrlTransform } from './message'

/**
 * 2.7 (74bef915)：Markdown 里的本地文件绝对路径链接应渲染为 FilePathChip。
 *
 * react-markdown 默认 urlTransform 只放行 http/https/mailto 等，其余会被清洗掉，
 * 导致 MarkdownLink 拿不到原始 href。mentionUrlTransform 是放行 mention:// 与
 * 本地绝对路径的闸门——这是 2.7 的行为核心（MarkdownLink 的 chip 分支依赖它先放行）。
 */
describe('mentionUrlTransform 本地文件链接放行', () => {
  test('mention:// 协议原样放行', () => {
    expect(mentionUrlTransform('mention://file/%2Ftmp%2Fexample.ts')).toBe('mention://file/%2Ftmp%2Fexample.ts')
  })

  test('带行号后缀的 Unix 绝对路径放行（解码后为绝对路径）', () => {
    const href = '/Users/bigmouth/Workspace/Proma/apps/web/src/renderer/components/agent/ContextUsageBadge.tsx:247'
    expect(mentionUrlTransform(encodeURIComponent(href))).toBe(encodeURIComponent(href))
  })

  test('Windows 盘符绝对路径放行', () => {
    const href = 'C:/Workspace/Proma/apps/web/src/message.tsx:247'
    expect(mentionUrlTransform(href)).toBe(href)
  })

  test('http 链接交由默认清洗（仍放行 http）', () => {
    expect(mentionUrlTransform('https://proma.ai')).toBe('https://proma.ai')
  })

  test('既非 mention 也非绝对路径的字符串走默认清洗（不原样返回裸文本）', () => {
    // defaultUrlTransform 会把未识别协议（如 javascript:）清洗为空串
    expect(mentionUrlTransform('javascript:alert(1)')).toBe('')
  })
})
