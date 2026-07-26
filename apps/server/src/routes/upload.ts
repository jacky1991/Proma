/**
 * 文件上传 / 下载 / 删除路由
 *
 * 替代 Electron 端的文件对话框 + 本地文件操作：
 * - POST /api/upload — multipart/form-data 上传附件
 * - GET  /api/attachments/:conversationId/:filename — 附件下载/预览
 * - DELETE /api/attachments/:conversationId/:filename — 删除附件
 */

import { Hono } from 'hono'
import { existsSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConversationAttachmentsDir } from '@proma/server-core/config-paths'
import { getMimeType } from '@proma/server-core/attachment-service'
import { getUserScope } from '../utils/user-scope'

const upload = new Hono()

/** 最大上传大小：100MB（与 shared MAX_ATTACHMENT_SIZE 一致） */
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024

/** 允许的 MIME 类型前缀白名单 */
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats',
  'application/vnd.ms-',
  'application/zip',
  'application/json',
  'application/rtf',
  'application/vnd.oasis',
  'text/',
]

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
}

/**
 * POST /api/upload
 *
 * multipart/form-data 上传附件。
 * Body: file (binary) + conversationId (string)
 * Response: { id, filename, mediaType, localPath, size }
 */
upload.post('/upload', async (c) => {
  const scope = getUserScope(c)
  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: '需要 multipart/form-data 格式' }, 400)
  }

  let body: Record<string, string | File>
  try {
    body = await c.req.parseBody()
  } catch {
    return c.json({ error: '解析请求体失败' }, 400)
  }

  const file = body.file
  const conversationId = body.conversationId as string | undefined

  if (!file || !(file instanceof File)) {
    return c.json({ error: '缺少 file 字段' }, 400)
  }
  if (!conversationId) {
    return c.json({ error: '缺少 conversationId 字段' }, 400)
  }

  // 大小校验
  if (file.size > MAX_UPLOAD_SIZE) {
    return c.json({ error: `文件超过 ${MAX_UPLOAD_SIZE / 1024 / 1024}MB 大小限制` }, 413)
  }

  // MIME 类型校验
  const mimeType = file.type || getMimeType(extname(file.name))
  if (!isAllowedMime(mimeType)) {
    return c.json({ error: `不支持的文件类型: ${mimeType}` }, 415)
  }

  // 存储到用户私有附件目录（Web 多用户隔离）
  const dir = getConversationAttachmentsDir(conversationId, scope)
  const id = randomUUID()
  const ext = extname(file.name) || '.bin'
  const storedFilename = `${id}${ext}`
  const fullPath = join(dir, storedFilename)
  const localPath = `${conversationId}/${storedFilename}`

  // 流式写入：Bun.write 直接接受 File 对象，内部流式处理，不会将整个文件加载到内存
  await Bun.write(fullPath, file)

  console.log(`[上传] 已保存附件: ${file.name} → ${localPath} (${file.size} 字节)`)

  return c.json({
    id,
    filename: file.name,
    mediaType: mimeType,
    localPath,
    size: file.size,
  })
})

/**
 * GET /api/attachments/:conversationId/:filename
 *
 * 返回附件文件内容。图片 inline 预览，其他类型触发下载。
 */
upload.get('/attachments/:conversationId/:filename', (c) => {
  const scope = getUserScope(c)
  const { conversationId, filename } = c.req.param()

  // 安全校验：防止路径穿越
  if (conversationId.includes('..') || filename.includes('..') || filename.includes('/')) {
    return c.json({ error: '非法路径' }, 400)
  }

  const dir = getConversationAttachmentsDir(conversationId, scope)
  const fullPath = join(dir, filename)

  if (!existsSync(fullPath)) {
    return c.json({ error: '附件不存在' }, 404)
  }

  const file = Bun.file(fullPath)
  const mimeType = getMimeType(extname(filename))
  const isImage = mimeType.startsWith('image/')

  return new Response(file, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': isImage ? 'inline' : `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
})

/**
 * DELETE /api/attachments/:conversationId/:filename
 *
 * 删除指定附件文件。
 */
upload.delete('/attachments/:conversationId/:filename', (c) => {
  const scope = getUserScope(c)
  const { conversationId, filename } = c.req.param()

  if (conversationId.includes('..') || filename.includes('..') || filename.includes('/')) {
    return c.json({ error: '非法路径' }, 400)
  }

  const dir = getConversationAttachmentsDir(conversationId, scope)
  const fullPath = join(dir, filename)

  if (!existsSync(fullPath)) {
    return c.json({ error: '附件不存在' }, 404)
  }

  unlinkSync(fullPath)
  console.log(`[上传] 已删除附件: ${conversationId}/${filename}`)
  return c.json({ ok: true })
})

export { upload }
