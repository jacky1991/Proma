/**
 * FileMentionSuggestion — TipTap Mention Suggestion 配置
 *
 * 工厂函数，创建用于 @ 引用文件的 TipTap Suggestion 配置。
 * 输入 @ 后异步搜索工作区文件，弹出 FileMentionList 浮动列表。
 * 弹窗底部锚定在光标上方，展开文件夹时向上生长。
 */

import type React from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { toast } from 'sonner'
import { FileMentionList } from './FileMentionList'
import type { FileMentionRef } from './FileMentionList'
import type { FileIndexEntry } from '@proma/shared'
import { createDebouncedSuggestionLoader, createLatestSuggestionRequestGuard, createMentionPopup, positionPopup, isSuggestionTriggerPresent, shouldSuppressEscTrigger, shouldClearEscSuppressionOnExit, type EscSuppressedTrigger } from '@/components/agent/mention-popup-utils'

export function createFileMentionSuggestion(
  workspacePathRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  attachedDirsRef?: React.RefObject<string[]>,
  mentionItemCountRef?: React.MutableRefObject<number>,
  sessionAttachedDirsRef?: React.RefObject<string[]>,
): Omit<SuggestionOptions<FileIndexEntry>, 'editor'> {
  let missingWorkspaceToastShown = false
  // Esc 抑制：记录被 Esc 关闭的触发片段文本。
  // TipTap suggestion 按 Esc 后会 dispatchExit 置 inactive，但触发符仍在文档中，
  // 继续输入会再次 onStart 弹窗；这里在 onStart 时对同一片段跳过建弹窗，
  // 直到用户重新触发（片段结束或内容变化）才恢复正常。
  // 用文本而非位置判断：删除触发符前的字符导致位置移动时，片段仍延续，继续抑制。
  let suppressedTrigger: EscSuppressedTrigger | null = null
  const requestGuard = createLatestSuggestionRequestGuard<FileIndexEntry>()
  const queryLoader = createDebouncedSuggestionLoader<FileIndexEntry>(requestGuard)

  return {
    char: '@',
    allowSpaces: false,
    allowedPrefixes: null,

    items: ({ query }): Promise<FileIndexEntry[]> => queryLoader.load(async () => {
      const wsPath = workspacePathRef.current
      if (!wsPath) {
        console.warn('[FileMention] workspacePath is null, mention disabled')
        if (!missingWorkspaceToastShown) {
          toast.warning('暂时无法引用文件', {
            description: '当前 Agent 会话没有可用的工作区路径。请在顶部选择工作区，或新建 Agent 会话后重试。',
          })
          missingWorkspaceToastShown = true
        }
        return []
      }
      missingWorkspaceToastShown = false

      try {
        const additionalPaths = attachedDirsRef?.current ?? []
        const sessionPaths = sessionAttachedDirsRef?.current ?? []

        const result = await window.electronAPI.searchWorkspaceFiles(
          wsPath,
          query ?? '',
          200,
          additionalPaths.length > 0 ? additionalPaths : undefined,
          sessionPaths.length > 0 ? sessionPaths : undefined,
        )
        return result.entries
      } catch (error) {
        console.error('[FileMention] search failed:', error)
        return []
      }
    }),

    render: () => {
      let renderer: ReactRenderer<FileMentionRef> | null = null
      let popup: HTMLDivElement | null = null
      let resizeObserver: ResizeObserver | null = null
      let latestClientRect: (() => DOMRect | null) | null | undefined = null
      let blurHandler: (() => void) | null = null
      let editorRef: SuggestionProps<FileIndexEntry>['editor'] | null = null

      // 用本次查询的 props.items 按 source 分组渲染弹窗，
      // 避免共享闭包 lastResult 被并发 view.update（第一个 @ 片段延续的慢搜索）
      // 覆盖，导致第二个 @ 弹窗显示旧/空结果（"无匹配文件"）。
      function splitEntries(items: FileIndexEntry[]) {
        return {
          sessionEntries: items.filter((item) => item.source === 'session'),
          workspaceEntries: items.filter((item) => item.source === 'workspace'),
        }
      }

      function createRenderer(props: SuggestionProps<FileIndexEntry>) {
        const { sessionEntries, workspaceEntries } = splitEntries(props.items)
        renderer = new ReactRenderer(FileMentionList, {
          props: {
            sessionEntries,
            workspaceEntries,
            onSelect: (item: { name: string; path: string; type: 'file' | 'dir' }) => {
              props.command({ id: item.path, label: item.name })
            },
          },
          editor: props.editor,
        })
      }

      function anchorPopup() {
        if (!popup) return
        positionPopup(popup, latestClientRect?.(), { anchorBottom: true })
      }

      function cleanup() {
        queryLoader.cancel()
        if (blurHandler && editorRef) {
          editorRef.view.dom.removeEventListener('blur', blurHandler, true)
          blurHandler = null
        }
        editorRef = null
        mentionActiveRef.current = false
        if (mentionItemCountRef) mentionItemCountRef.current = 0
        latestClientRect = null
        resizeObserver?.disconnect()
        resizeObserver = null
        popup?.remove()
        popup = null
        renderer?.destroy()
        renderer = null
      }

      return {
        onStart(props) {
          // TipTap 3.29+ 重构：onStart 在 fetch 前同步调用，props.items 为空初始数组，
          // 不能用 requestGuard.isLatest 判定（空数组未过 attachResult，恒为 stale）。
          // 真正的 fetched items 经 onUpdate 到达，其上的 isLatest 守卫仍有效。
          if (popup || renderer) {
            cleanup()
          }

          // 防御异步竞态：@ 触发符可能已被删除导致 suggestion 退出，
          // 插件仍会用过期 props 调用 onStart；过期则跳过建弹窗，避免残留幽灵弹窗。
          if (!isSuggestionTriggerPresent(props.editor, props.range, '@')) {
            return
          }

          // Esc 抑制：同一触发片段（位置未后移且文本延续）不再弹窗，保持抑制；
          // 用户重新输入触发符（位置后移）、片段已结束或内容变化时清除抑制并正常弹窗。
          if (shouldSuppressEscTrigger(suppressedTrigger, { from: props.range.from, text: props.text })) {
            return
          }
          suppressedTrigger = null

          mentionActiveRef.current = true
          if (mentionItemCountRef) mentionItemCountRef.current = props.items.length
          editorRef = props.editor

          try {
            latestClientRect = props.clientRect
            createRenderer(props)
            popup = createMentionPopup(renderer!.element)
            anchorPopup()

            resizeObserver = new ResizeObserver(() => {
              anchorPopup()
            })
            resizeObserver.observe(popup!)

            // 编辑器失焦时强制关闭弹窗（点击页面其他区域等场景）
            blurHandler = () => {
              // 延迟检查：点击弹窗本身不应关闭（焦点会回到编辑器）
              setTimeout(() => {
                if (!editorRef?.view.hasFocus() && popup) {
                  cleanup()
                }
              }, 100)
            }
            props.editor.view.dom.addEventListener('blur', blurHandler, true)
          } catch (e) {
            console.error('[FileMention] render popup failed:', e)
            cleanup()
          }
        },

        onUpdate(props) {
          if (!requestGuard.isLatest(props.items)) {
            return
          }
          if (mentionItemCountRef) mentionItemCountRef.current = props.items.length
          latestClientRect = props.clientRect

          const { sessionEntries, workspaceEntries } = splitEntries(props.items)
          renderer?.updateProps({
            sessionEntries,
            workspaceEntries,
            onSelect: (item: { name: string; path: string; type: 'file' | 'dir' }) => {
              props.command({ id: item.path, label: item.name })
            },
          })
          anchorPopup()
        },

        onKeyDown(props) {
          // 记录 Esc 关闭时的触发片段文本与位置，onStart/onExit 据此判断同一片段
          if (props.event.key === 'Escape') {
            suppressedTrigger = {
              from: props.range.from,
              text: props.view.state.doc.textBetween(props.range.from, props.range.to, '', ''),
            }
          }
          if (renderer?.ref) {
            return renderer.ref.onKeyDown({ event: props.event })
          }
          return false
        },

        onExit(props) {
          // TipTap 会在 await items() 后才调用 onExit；旧请求不能清理新弹窗。
          if (requestGuard.isStale(props.items)) {
            return
          }
          // 被抑制的触发符已从文档中删除 → 清除抑制，让用户重新输入触发符时恢复正常弹窗
          if (suppressedTrigger && shouldClearEscSuppressionOnExit(suppressedTrigger, props.editor, props.range, '@')) {
            suppressedTrigger = null
          }
          cleanup()
        },
      }
    },
  }
}
