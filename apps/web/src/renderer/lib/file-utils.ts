/**
 * 文件处理工具函数
 */

import { MAX_ATTACHMENT_SIZE } from '@proma/shared'
import type { FileAccessOptions } from '@proma/shared'

export function formatFileNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join('、')
  return `${names.slice(0, max).join('、')} 等 ${names.length} 个文件`
}

export function getFileParentPath(filePath: string): string | null {
  const slashIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (slashIndex < 0) return null
  if (slashIndex === 0) return filePath.slice(0, 1)
  if (/^[A-Za-z]:[\\/]/.test(filePath) && slashIndex === 2) {
    return filePath.slice(0, 3)
  }
  return filePath.slice(0, slashIndex)
}

/** 将 File 对象转为 base64 字符串 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      reject(new Error(`文件 ${file.name} 超过 100MB 大小限制`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]!
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 触发浏览器下载一个 Blob（创建临时 <a> 点击后释放） */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * 下载服务端文件：经 file:read-binary 读取 base64 后触发浏览器下载。
 * 路径由服务端 assertAttachedPathAllowed 校验；文件夹不支持下载。
 */
export async function downloadAttachedFile(
  filePath: string,
  name: string,
  access?: FileAccessOptions,
): Promise<void> {
  const base64 = await window.electronAPI.readBinaryBase64(filePath, access)
  if (!base64) {
    throw new Error(`无法读取文件：${name}`)
  }
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  // 用通用二进制类型，强制浏览器走下载而非预览；扩展名由文件名决定
  triggerBlobDownload(new Blob([bytes], { type: 'application/octet-stream' }), name)
}
