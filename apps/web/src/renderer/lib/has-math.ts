/**
 * 检测归一化后的 markdown 文本是否含数学公式定界符。
 *
 * 用于决定是否加载 KaTeX 渲染栈（remark-math + rehype-katex）：仅当内容确实含数学时，
 * 才懒加载 MathMarkdown chunk，避免 KaTeX 进入首屏 main.js。
 *
 * 【必须留在主包】这是纯字符串函数、无依赖，供同步调用判断；真正的 KaTeX 栈在
 * MathMarkdown 懒加载 chunk 里。若把本函数放进 lazy chunk，判断前就得先加载 chunk，违背初衷。
 *
 * 【保守优先】宁可误判（多加载一次 KaTeX，渲染结果不变）也不漏检（数学公式不渲染）。
 * 配合 normalize-latex.ts，归一化后只会有 $...$ / $$...$$ 两种 dollar 形式。
 */
export function hasMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(text)
}
