/**
 * MarkdownPre — react-markdown 的 pre 渲染器，处理代码块高亮（shiki）与 Mermaid。
 *
 * 从 message.tsx 抽出并懒加载：把 shiki 引擎（@proma/ui CodeBlock + @proma/core
 * detectLanguage）切到独立 chunk，不进入首屏 main.js。MermaidBlock 内部已是动态 import，
 * 其壳随本模块一同进入此 chunk（极小）。语言级 grammar 文件由 shiki 按需分包，无需处理。
 */
import * as React from 'react'
import { CodeBlock, MermaidBlock } from '@proma/ui'
import { detectLanguage } from '@proma/core'
import { shouldInspectMermaidCodeBlock, shouldRenderMermaidCodeBlock } from '@/lib/mermaid-detection'

/** 从 ReactNode 提取纯文本（用于 Mermaid 源码识别与语言检测） */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

export interface MarkdownPreProps {
  children?: React.ReactNode
}

/** 代码块 / Mermaid 渲染器 */
export const MarkdownPre = React.memo(function MarkdownPre({
  children: preChildren,
}: MarkdownPreProps): React.ReactElement {
  // react-markdown v10 把 <code> 替换成自定义组件后，type 不再是字符串 'code'，
  // 但 pre 的 code child 要么是原生 'code'（v9 及之前），要么是自定义函数/对象组件（v10+）。
  // 通过 type 形态过滤掉意外混入的其他原生 HTML 元素（如 span/div），降低未来 react-markdown
  // 行为变化导致静默误识别的风险
  const codeChild = React.Children.toArray(preChildren).find(
    (child): child is React.ReactElement => {
      if (!React.isValidElement(child)) return false
      const t = (child as React.ReactElement).type
      return t === 'code' || typeof t === 'function' || typeof t === 'object'
    },
  ) as React.ReactElement | undefined

  if (codeChild) {
    const codeProps = codeChild.props as { className?: string; children?: React.ReactNode }
    const className = codeProps.className ?? ''
    const hasExplicitLang = /\blanguage-\S+/.test(className)

    // 先用共享 mermaid 识别（覆盖 language-mermaid/mmd 以及未标语言但内容像 Mermaid 的情况）
    if (shouldInspectMermaidCodeBlock(className)) {
      // normalize Windows/legacy-Mac line endings before feeding to Mermaid parser
      const mermaidCode = extractText(codeProps.children).replace(/\r\n?/g, '\n').replace(/\n$/, '')
      if (shouldRenderMermaidCodeBlock(className, mermaidCode)) {
        return <MermaidBlock code={mermaidCode} />
      }
    }

    // 未标注语言且非 Mermaid 时：highlight.js 自动检测，命中后注入 language-xxx 喂给 CodeBlock 高亮
    if (!hasExplicitLang) {
      const rawCode = extractText(codeProps.children).replace(/\n$/, '')
      const detected = detectLanguage(rawCode)
      if (detected !== 'text') {
        const patchedCode = React.cloneElement(codeChild, {
          className: `${className} language-${detected}`.trim(),
        } as Partial<React.HTMLAttributes<HTMLElement>>)
        return <CodeBlock>{patchedCode}</CodeBlock>
      }
    }
  }

  return <CodeBlock>{preChildren}</CodeBlock>
})
