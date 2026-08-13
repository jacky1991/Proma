/**
 * 修复模型常见的一类畸形加粗标记：`**标签:**值` 以及富文本编辑后残留的
 * 转义形式 `\*\*标签: \*\*值`。
 *
 * CommonMark 规定闭合标记后紧跟字母或数字时视为无效。修复仅限于标签或句末
 * 标点，以免影响字面星号的原始含义。
 */

const DIRECT_STRONG_RE = /(?<!\\)\*\*([^*\r\n]*?[,:;!?\u3002\uFF01\uFF1F\uFF1A\uFF1B\u3001\uFF09)\]\u3011}])\s*\*\*(?=[\p{L}\p{N}])/gu
const ESCAPED_STRONG_RE = /\\\*\\\*([^*\r\n]*?[,:;!?\u3002\uFF01\uFF1F\uFF1A\uFF1B\u3001\uFF09)\]\u3011}])\s*\\\*\\\*(?=[\p{L}\p{N}])/gu

function normalizeText(text: string): string {
  return text
    .replace(ESCAPED_STRONG_RE, (_match, content: string) => `**${content}** `)
    .replace(DIRECT_STRONG_RE, (_match, content: string) => `**${content}** `)
}

function normalizeInlineText(line: string): string {
  let normalized = ''
  let cursor = 0
  // 保护代码、原始 HTML 标签和 Markdown 链接/图片目标地址。
  // 可见的链接标签仍可被修正，只有目标地址需保持逐字节语义。
  const protectedInline = /(`+)(.*?)\1|<\/?[A-Za-z][^>\r\n]*>|(!?\[[^\]\r\n]*\]\()((?:\\.|[^)\r\n])*)(\))/g

  for (const match of line.matchAll(protectedInline)) {
    const start = match.index ?? 0
    normalized += normalizeText(line.slice(cursor, start))

    if (match[3] !== undefined) {
      normalized += normalizeText(match[3]) + (match[4] ?? '') + (match[5] ?? '')
    } else {
      normalized += match[0]
    }

    cursor = start + match[0].length
  }

  return normalized + normalizeText(line.slice(cursor))
}

/**
 * 在围栏代码块、缩进代码块和内联代码之外归一化高置信度的畸形 `**...**` 序列。
 * Markdown 预览和聊天消息在解析前使用此函数。
 */
export function normalizeMalformedStrongDelimiters(markdown: string): string {
  if (!markdown.includes('**') && !markdown.includes('\\*')) return markdown

  let inFence: { marker: '`' | '~'; length: number } | null = null

  return markdown.split('\n').map((line) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    const isCode = Boolean(inFence || fenceMatch || /^(?: {4}|\t)/.test(line))

    if (fenceMatch) {
      const markerText = fenceMatch[1] ?? ''
      const marker = markerText[0] as '`' | '~'
      if (!inFence) {
        inFence = { marker, length: markerText.length }
      } else if (marker === inFence.marker && markerText.length >= inFence.length) {
        inFence = null
      }
    }

    return isCode ? line : normalizeInlineText(line)
  }).join('\n')
}
