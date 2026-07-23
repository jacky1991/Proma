/**
 * 附件存储服务（Electron 端）
 *
 * 纯 fs 操作（保存/读取/删除）的真源在 @proma/server-core/attachment-service；此处本地保留
 * 依赖 Electron dialog / BrowserWindow 的文件选择对话框。
 */

export * from '@proma/server-core/attachment-service'

import { dialog, BrowserWindow } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { extname, basename } from 'node:path'
import { getMimeType } from '@proma/server-core/attachment-service'
import type {
  FileDialogResult,
  FileDialogFile,
  FileDialogLargeFile,
  FileDialogSkippedFile,
} from '@proma/shared'
import { MAX_ATTACHMENT_SIZE } from '@proma/shared'

/** 文件选择对话框支持的过滤器 */
const FILE_FILTERS = [
  {
    name: '支持的文件',
    extensions: [
      'png', 'jpg', 'jpeg', 'gif', 'webp',
      'pdf', 'txt', 'md', 'json', 'csv', 'xml', 'html',
      'doc', 'dot', 'docx', 'docm', 'dotx', 'dotm', 'wps', 'wpt', 'rtf',
      'xls', 'xlt', 'xlsx', 'xlsm', 'xltx', 'xltm', 'et', 'ett',
      'ppt', 'pot', 'pps', 'pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm', 'dps', 'dpt',
      'odt', 'odp', 'ods',
    ],
  },
  {
    name: '所有文件',
    extensions: ['*'],
  },
]

/**
 * 打开文件选择对话框
 *
 * 弹出 Electron 文件选择对话框，支持多选，
 * 读取选中的小文件并返回 base64 编码数据；超过内存导入上限的大文件仅返回路径。
 */
export async function openFileDialog(): Promise<FileDialogResult> {
  // macOS 上必须传入父窗口，否则对话框可能出现在应用窗口后面
  const parentWindow = BrowserWindow.getFocusedWindow()
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: FILE_FILTERS,
  }

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return { files: [] }
  }

  const files: FileDialogFile[] = []
  const largeFiles: FileDialogLargeFile[] = []
  const skippedFiles: FileDialogSkippedFile[] = []

  for (const filePath of result.filePaths) {
    const filename = basename(filePath)
    const ext = extname(filePath)
    const mediaType = getMimeType(ext)

    let fileSize: number
    try {
      const fileStat = statSync(filePath)
      if (!fileStat.isFile()) {
        skippedFiles.push({
          filename,
          mediaType,
          path: filePath,
          reason: 'unreadable',
          message: '不是普通文件',
        })
        continue
      }
      fileSize = fileStat.size
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法获取文件大小'
      console.warn(`[附件服务] 无法获取文件大小，跳过: ${filePath}`, error)
      skippedFiles.push({ filename, mediaType, path: filePath, reason: 'unreadable', message })
      continue
    }

    if (fileSize > MAX_ATTACHMENT_SIZE) {
      largeFiles.push({
        filename,
        mediaType,
        size: fileSize,
        path: filePath,
      })
      continue
    }

    try {
      const buffer = readFileSync(filePath)
      files.push({
        filename,
        mediaType,
        data: buffer.toString('base64'),
        size: buffer.length,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取文件失败'
      console.warn(`[附件服务] 读取文件失败，跳过: ${filePath}`, error)
      skippedFiles.push({ filename, mediaType, size: fileSize, path: filePath, reason: 'unreadable', message })
    }
  }

  console.log(`[附件服务] 文件对话框选择了 ${files.length} 个内存附件，${largeFiles.length} 个大文件引用，${skippedFiles.length} 个跳过`)
  return {
    files,
    ...(largeFiles.length > 0 && { largeFiles }),
    ...(skippedFiles.length > 0 && { skippedFiles }),
  }
}
