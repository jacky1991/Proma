/**
 * 附件存储服务
 *
 * 负责文件附件的本地存储、读取和删除。
 * 存储路径：~/.proma/attachments/{conversationId}/{uuid}.ext
 *
 * - 保存：base64 解码 → 写入文件
 * - 读取：文件 → base64 编码（用于 API 发送）
 * - 删除：单个文件或整个对话附件目录
 * - 文件选择对话框：Electron dialog → 小文件读取为 base64，大文件返回本地路径引用
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
import { extname, join, isAbsolute, normalize } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  getConfigDir,
  getUserDataDir,
  getConversationAttachmentsDir,
  resolveAttachmentPath,
} from './config-paths'
import type { UserScope } from './config-paths'
import type {
  FileAttachment,
  AttachmentSaveInput,
  AttachmentSaveResult,
} from '@proma/shared'
import { MAX_ATTACHMENT_SIZE } from '@proma/shared'

/** 支持的图片 MIME 类型 */
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/** 扩展名 → MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.dot': 'application/msword',
  '.wps': 'application/vnd.ms-works',
  '.wpt': 'application/vnd.ms-works',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
  '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  '.dotm': 'application/vnd.ms-word.template.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.xlt': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  '.xltm': 'application/vnd.ms-excel.template.macroEnabled.12',
  '.et': 'application/vnd.ms-excel',
  '.ett': 'application/vnd.ms-excel',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pot': 'application/vnd.ms-powerpoint',
  '.pps': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  '.potx': 'application/vnd.openxmlformats-officedocument.presentationml.template',
  '.potm': 'application/vnd.ms-powerpoint.template.macroEnabled.12',
  '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  '.ppsm': 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
  '.dps': 'application/vnd.ms-powerpoint',
  '.dpt': 'application/vnd.ms-powerpoint',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
}

// 注：文件选择对话框（FILE_FILTERS + openFileDialog，依赖 Electron dialog/BrowserWindow）
// 属桌面专属，由 Electron 端 lib/attachment-service.ts 在 re-export 纯 fs 函数之外本地保留。

/**
 * 判断是否为图片附件
 */
export function isImageAttachment(mediaType: string): boolean {
  return IMAGE_MIME_TYPES.has(mediaType)
}

/**
 * 根据扩展名获取 MIME 类型
 */
export function getMimeType(ext: string): string {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  return MIME_MAP[normalized] || 'application/octet-stream'
}

/**
 * 保存附件到本地
 *
 * 将 base64 编码的文件数据解码后写入
 * ~/.proma/attachments/{conversationId}/{uuid}.ext
 *
 * @param input 保存附件参数
 * @returns 保存结果，包含附件元信息
 */
export function saveAttachment(input: AttachmentSaveInput, scope?: UserScope): AttachmentSaveResult {
  const { conversationId, filename, mediaType, data } = input

  // 防御性检查：base64 数据量不应超过 100MB 限制
  // base64 字符串长度 × 0.75 ≈ 原始字节数
  if (data.length * 0.75 > MAX_ATTACHMENT_SIZE) {
    throw new Error(`文件 ${filename} 超过 100MB 大小限制，无法保存`)
  }

  // 确保目录存在
  const dir = getConversationAttachmentsDir(conversationId, scope)

  // 生成唯一文件名
  const ext = extname(filename) || '.bin'
  const id = randomUUID()
  const storedFilename = `${id}${ext}`
  const localPath = `${conversationId}/${storedFilename}`
  const fullPath = join(dir, storedFilename)

  // base64 解码并写入
  const buffer = Buffer.from(data, 'base64')
  writeFileSync(fullPath, buffer)

  const attachment: FileAttachment = {
    id,
    filename,
    mediaType,
    localPath,
    size: buffer.length,
  }

  console.log(`[附件服务] 已保存附件: ${filename} → ${localPath} (${buffer.length} 字节)`)
  return { attachment }
}

/**
 * 读取附件并返回 base64 编码
 *
 * 支持两种路径格式：
 * 1. 相对路径 {conversationId}/{uuid}.ext → 解析到 ~/.proma/attachments/
 * 2. 绝对路径（Agent 工作区附件）→ 需在 ~/.proma/ 目录下，直接读取
 *
 * @param localPath 相对路径或绝对路径
 * @returns base64 编码的文件数据
 */
export function readAttachmentAsBase64(localPath: string, scope?: UserScope): string {
  let fullPath: string

  if (isAbsolute(localPath)) {
    // 绝对路径：验证在数据根目录下，防止路径穿越
    const baseDir = scope ? getUserDataDir(scope) : getConfigDir()
    const normalized = normalize(localPath)
    if (!normalized.startsWith(baseDir)) {
      throw new Error(`附件路径不在安全目录内: ${localPath}`)
    }
    fullPath = normalized
  } else {
    fullPath = resolveAttachmentPath(localPath, scope)
  }

  if (!existsSync(fullPath)) {
    throw new Error(`附件文件不存在: ${localPath}`)
  }

  const buffer = readFileSync(fullPath)
  return buffer.toString('base64')
}

/**
 * 删除单个附件
 *
 * @param localPath 相对路径 {conversationId}/{uuid}.ext
 */
export function deleteAttachment(localPath: string, scope?: UserScope): void {
  const fullPath = resolveAttachmentPath(localPath, scope)

  if (existsSync(fullPath)) {
    try {
      unlinkSync(fullPath)
      console.log(`[附件服务] 已删除附件: ${localPath}`)
    } catch (error) {
      console.warn(`[附件服务] 删除附件失败: ${localPath}`, error)
    }
  }
}

/**
 * 删除对话的全部附件
 *
 * 删除整个 ~/.proma/attachments/{conversationId}/ 目录。
 *
 * @param conversationId 对话 ID
 */
export function deleteConversationAttachments(conversationId: string, scope?: UserScope): void {
  const dir = join(resolveAttachmentPath('', scope), conversationId)

  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true })
      console.log(`[附件服务] 已删除对话附件目录: ${conversationId}`)
    } catch (error) {
      console.warn(`[附件服务] 删除对话附件目录失败: ${conversationId}`, error)
    }
  }
}

// openFileDialog（Electron dialog 文件选择）已移至 Electron 端 lib/attachment-service.ts 本地保留。
