/**
 * 文件预览路由
 *
 * 将 Electron 主进程的 Office 内联预览能力（DOCX/XLSX/PPTX → HTML）迁到 Web 服务端，
 * 保住 Web 端 Office 预览（M4 迭代 11 步骤 4）。
 *
 * - POST /api/file:office-preview — DOCX/XLSX/PPTX 转内联 HTML 预览
 * - POST /api/file:resolve-and-read — 读取文本内容（纯文本 / 代码预览）
 * - POST /api/file:read-binary — 读取二进制 base64（图片 / PDF 预览）
 * - POST /api/file:write-text — 写入文本（Markdown 内联编辑写回）
 *
 * Web 端图片 / PDF / 纯文本预览改用 base64 方案，不再依赖桌面 proma-file:// 协议。
 *
 * scope 安全红线：先用 candidateBasePaths 解析出绝对路径，再用
 * assertAttachedPathAllowed 收紧到当前用户已授权目录（会话/工作区挂载），
 * 保证多用户隔离，防止跨用户读取。
 */

import { Hono } from 'hono'
import type { FileAccessOptions } from '@proma/shared'
import {
  resolveTargetPath,
  convertDocxToHtml,
  convertOfficeToHtml,
  resolveAndReadFile,
  readBinaryBase64,
  writeTextFile,
} from '@proma/server-core/office-preview-service'
import { getUserScope } from '../utils/user-scope'
import { assertAttachedPathAllowed } from './agent'

const file = new Hono()

/** 预览类型：docx 走 mammoth，office 走 OOXML 结构化解析（XLSX/PPTX） */
type OfficePreviewKind = 'docx' | 'office'

interface OfficePreviewInput {
  filePath: string
  /** 文件访问上下文：sessionId/workspaceSlug/candidateBasePaths，用于路径解析与 scope 收紧 */
  access?: FileAccessOptions
  kind: OfficePreviewKind
}

/**
 * POST /api/file:office-preview
 *
 * kind=docx   → 返回 { resolvedPath, html }（对齐 client-api.docxToHtml）
 * kind=office → 返回 OfficePreviewResult（对齐 client-api.officeToHtml）
 *
 * 普通用户即可预览自己 scope 内的文件：走登录鉴权（全局 authMiddleware）+
 * assertAttachedPathAllowed scope 收紧，而非 adminOnly。
 */
file.post('/file:office-preview', async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<OfficePreviewInput>()

  if (!input.filePath || typeof input.filePath !== 'string') {
    return c.json({ error: '无效的文件路径' }, 400)
  }
  if (input.kind !== 'docx' && input.kind !== 'office') {
    return c.json({ error: '无效的预览类型' }, 400)
  }

  // 先用候选目录解析出绝对路径，再收紧到用户已授权目录后才允许读取
  const resolved = resolveTargetPath(input.filePath, input.access?.candidateBasePaths)
  assertAttachedPathAllowed(resolved, input.access, scope)

  if (input.kind === 'docx') {
    const result = await convertDocxToHtml(resolved)
    if (!result) return c.json({ error: '无法加载 DOCX 预览' }, 400)
    return c.json(result)
  }

  const result = await convertOfficeToHtml(resolved)
  if (!result) return c.json({ error: '无法加载 Office 预览' }, 400)
  return c.json(result)
})

/**
 * POST /api/file:resolve-and-read
 *
 * 读取文本文件内容（对齐 client-api.resolveAndReadFile），供内联文本 / 代码预览。
 */
file.post('/file:resolve-and-read', async (c) => {
  const scope = getUserScope(c)
  const { filePath, access } = await c.req.json<{ filePath: string; access?: FileAccessOptions }>()
  if (!filePath || typeof filePath !== 'string') {
    return c.json({ error: '无效的文件路径' }, 400)
  }
  const resolved = resolveTargetPath(filePath, access?.candidateBasePaths)
  assertAttachedPathAllowed(resolved, access, scope)
  const result = resolveAndReadFile(resolved)
  if (!result) return c.json({ error: '无法读取文件预览' }, 400)
  return c.json(result)
})

/**
 * POST /api/file:read-binary
 *
 * 读取二进制文件为 base64 + mediaType（对齐 client-api.readBinaryBase64），
 * 图片 / PDF 内联预览统一走此路由。
 */
file.post('/file:read-binary', async (c) => {
  const scope = getUserScope(c)
  const { filePath, access, maxSize } = await c.req.json<{ filePath: string; access?: FileAccessOptions; maxSize?: number }>()
  if (!filePath || typeof filePath !== 'string') {
    return c.json({ error: '无效的文件路径' }, 400)
  }
  const resolved = resolveTargetPath(filePath, access?.candidateBasePaths)
  assertAttachedPathAllowed(resolved, access, scope)
  const result = readBinaryBase64(resolved, undefined, maxSize)
  if (!result) return c.json({ error: '无法读取文件预览' }, 400)
  return c.json(result)
})

/**
 * POST /api/file:write-text
 *
 * 写入文本文件（对齐 client-api.writeTextFile），供 Markdown 内联编辑写回。
 */
file.post('/file:write-text', async (c) => {
  const scope = getUserScope(c)
  const { filePath, content, access } = await c.req.json<{ filePath: string; content: string; access?: FileAccessOptions }>()
  if (!filePath || typeof filePath !== 'string') {
    return c.json({ error: '无效的文件路径' }, 400)
  }
  const resolved = resolveTargetPath(filePath, access?.candidateBasePaths)
  assertAttachedPathAllowed(resolved, access, scope)
  const ok = writeTextFile(resolved, content)
  if (!ok) return c.json({ error: '写入文件失败' }, 400)
  return c.json({ ok: true })
})

export { file }
