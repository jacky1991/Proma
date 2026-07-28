/**
 * Office 内联预览服务单测（DOCX/XLSX/PPTX → HTML）
 *
 * 用 adm-zip 现场构造最小可用的 OOXML 包（XLSX/PPTX/DOCX），
 * 实打实验证结构化解析与 mammoth 转 HTML 的产出。
 */
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import {
  resolveTargetPath,
  convertDocxToHtml,
  convertOfficeToHtml,
} from '../src/office-preview-service'

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'office-preview-test-'))
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** 构造一个最小可用 XLSX（单 sheet，两个内联字符串单元格） */
function buildXlsx(path: string): void {
  const zip = new AdmZip()
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '</Types>',
    ),
  )
  zip.addFile(
    'xl/workbook.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="数据表" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>',
    ),
  )
  zip.addFile(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
    ),
  )
  zip.addFile(
    'xl/worksheets/sheet1.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>你好</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>世界</t></is></c>' +
      '</row>' +
      '</sheetData>' +
      '</worksheet>',
    ),
  )
  zip.writeZip(path)
}

/** 构造一个最小可用 PPTX（单页，标题 + 一个要点） */
function buildPptx(path: string): void {
  const zip = new AdmZip()
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '</Types>',
    ),
  )
  zip.addFile(
    'ppt/presentation.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<presentation xmlns="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sldIdLst><sldId id="256" r:id="rId1"/></sldIdLst>' +
      '</presentation>',
    ),
  )
  zip.addFile(
    'ppt/_rels/presentation.xml.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
      '</Relationships>',
    ),
  )
  zip.addFile(
    'ppt/slides/slide1.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<sld xmlns="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<cSld><spTree><sp><txBody>' +
      '<a:p><a:r><a:t>标题文本</a:t></a:r></a:p>' +
      '<a:p><a:r><a:t>要点一</a:t></a:r></a:p>' +
      '</txBody></sp></spTree></cSld>' +
      '</sld>',
    ),
  )
  zip.writeZip(path)
}

/** 构造一个最小可用 DOCX（单段落） */
function buildDocx(path: string): void {
  const zip = new AdmZip()
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    ),
  )
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    ),
  )
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>你好文档</w:t></w:r></w:p></w:body>' +
      '</w:document>',
    ),
  )
  zip.writeZip(path)
}

test('convertOfficeToHtml：XLSX 结构化为表格 HTML', async () => {
  const xlsxPath = join(tmpDir, 'demo.xlsx')
  buildXlsx(xlsxPath)

  const result = await convertOfficeToHtml(xlsxPath)
  expect(result).not.toBeNull()
  expect(result!.kind).toBe('spreadsheet')
  expect(result!.resolvedPath).toBe(xlsxPath)
  expect(result!.html).toContain('office-preview-spreadsheet')
  expect(result!.html).toContain('你好')
  expect(result!.html).toContain('世界')
  expect(result!.html).toContain('数据表')
  // 纯文本副本用制表符分隔单元格
  expect(result!.text).toContain('你好\t世界')
})

test('convertOfficeToHtml：PPTX 结构化为幻灯片 HTML', async () => {
  const pptxPath = join(tmpDir, 'demo.pptx')
  buildPptx(pptxPath)

  const result = await convertOfficeToHtml(pptxPath)
  expect(result).not.toBeNull()
  expect(result!.kind).toBe('presentation')
  expect(result!.resolvedPath).toBe(pptxPath)
  expect(result!.html).toContain('office-preview-presentation')
  expect(result!.html).toContain('标题文本')
  expect(result!.html).toContain('要点一')
  expect(result!.text).toContain('标题文本')
})

test('convertDocxToHtml：DOCX 经 mammoth 转 HTML', async () => {
  const docxPath = join(tmpDir, 'demo.docx')
  buildDocx(docxPath)

  const result = await convertDocxToHtml(docxPath)
  expect(result).not.toBeNull()
  expect(result!.resolvedPath).toBe(docxPath)
  expect(result!.html).toContain('你好文档')
})

test('resolveTargetPath：绝对路径直接解析为自身', () => {
  const xlsxPath = join(tmpDir, 'resolve.xlsx')
  buildXlsx(xlsxPath)
  expect(resolveTargetPath(xlsxPath)).toBe(xlsxPath)
})

test('resolveTargetPath：相对路径在 basePaths 内解析', () => {
  const xlsxPath = join(tmpDir, 'rel.xlsx')
  buildXlsx(xlsxPath)
  expect(resolveTargetPath('rel.xlsx', [tmpDir])).toBe(xlsxPath)
})

test('convertOfficeToHtml：文件不存在返回 null', async () => {
  const result = await convertOfficeToHtml(join(tmpDir, 'no-such.xlsx'))
  expect(result).toBeNull()
})

test('convertDocxToHtml：文件不存在返回 null', async () => {
  const result = await convertDocxToHtml(join(tmpDir, 'no-such.docx'))
  expect(result).toBeNull()
})

test('convertOfficeToHtml：非 XLSX/PPTX 扩展名返回 null', async () => {
  // 造一个 .txt，结构化分支不处理，返回 null（不进 officeparser 兜底，因为没抛错）
  const txtPath = join(tmpDir, 'plain.txt')
  buildXlsx(txtPath)
  const result = await convertOfficeToHtml(txtPath)
  expect(result).toBeNull()
})
