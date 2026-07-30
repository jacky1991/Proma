/**
 * MathMarkdown — 含数学公式（KaTeX）的 Markdown 渲染器
 *
 * 从 message.tsx / reasoning.tsx 的数学渲染路径抽出，懒加载：remark-math + rehype-katex +
 * katex.min.css 只在消息内容确实含 $...$ / $$...$$ 时（由 hasMath 判断）才加载，
 * 不进入首屏 main.js。
 *
 * components 映射由调用方传入（复用 message.tsx 的 MarkdownPre / InlineCode / Link 等），
 * 保证数学版与普通版的代码块 / 链接渲染一致。
 */
import * as React from 'react'
import type { ComponentProps } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

type MarkdownComponents = ComponentProps<typeof Markdown>['components']
type MarkdownRemarkPlugins = ComponentProps<typeof Markdown>['remarkPlugins']
type MarkdownUrlTransform = ComponentProps<typeof Markdown>['urlTransform']

export interface MathMarkdownProps {
  children: string
  components?: MarkdownComponents
  remarkPlugins?: MarkdownRemarkPlugins
  urlTransform?: MarkdownUrlTransform
}

export const MathMarkdown = React.memo(
  function MathMarkdown({ children, components, remarkPlugins, urlTransform }: MathMarkdownProps): React.ReactElement {
    // remarkGfm + remarkMath 在前，调用方追加的插件在后（与原 MessageResponse 顺序一致）
    const merged = React.useMemo(
      () => (remarkPlugins ? [remarkGfm, remarkMath, ...remarkPlugins] : [remarkGfm, remarkMath]),
      [remarkPlugins],
    )

    return (
      <Markdown
        remarkPlugins={merged}
        rehypePlugins={[rehypeKatex]}
        components={components}
        urlTransform={urlTransform}
      >
        {children}
      </Markdown>
    )
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.components === next.components &&
    prev.remarkPlugins === next.remarkPlugins &&
    prev.urlTransform === next.urlTransform,
)
