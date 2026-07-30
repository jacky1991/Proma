/**
 * UploadSkillDialog — 技能 zip 上传弹窗
 *
 * 支持拖拽 zip 包或点击选择；说明支持的文件类型与结构要求。
 * 上传逻辑由父组件透传（onUpload → useAgentSkillsData.uploadSkill），
 * 本组件只负责交互与 loading 态。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { FileArchive, Loader2, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface UploadSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpload: (file: File) => Promise<number>
}

// 单包大小上限，与后端 uploadSkillsFromZip 一致
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export function UploadSkillDialog({ open, onOpenChange, onUpload }: UploadSkillDialogProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)

  const handleFile = React.useCallback(async (file: File): Promise<void> => {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.zip')) {
      toast.error('仅支持 .zip 格式的技能包')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('文件过大，请压缩到 50MB 以内')
      return
    }
    setIsUploading(true)
    try {
      const installed = await onUpload(file)
      // onUpload 内部已 toast；安装成功则关闭弹窗
      if (installed > 0) onOpenChange(false)
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = '' // 允许重复选择同一文件
    }
  }, [onUpload, onOpenChange])

  const handleDrop = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (isUploading) return
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }, [isUploading, handleFile])

  const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }, [handleFile])

  const triggerPick = (): void => {
    if (!isUploading) inputRef.current?.click()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isUploading) onOpenChange(v) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>上传技能</DialogTitle>
          <DialogDescription>
            将技能打包为 .zip 后上传，解压到当前工作区的用户技能目录，与内置技能同级管理。
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={handleInputChange}
          className="hidden"
        />

        {/* 拖拽 / 点击区域 */}
        <div
          role="button"
          tabIndex={0}
          aria-label="拖拽或点击选择 zip 技能包"
          onClick={triggerPick}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
              e.preventDefault()
              triggerPick()
            }
          }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isUploading) setIsDragOver(true) }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false) }}
          onDrop={handleDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            isDragOver
              ? 'border-primary bg-primary/10'
              : 'border-border/60 bg-muted/40 hover:border-primary/40 hover:bg-muted/70',
            isUploading && 'pointer-events-none opacity-60',
          )}
        >
          <div
            className={cn(
              'flex size-12 items-center justify-center rounded-full transition-colors',
              isDragOver ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.04] text-foreground/40',
            )}
          >
            {isUploading ? (
              <Loader2 className="size-6 animate-spin" />
            ) : isDragOver ? (
              <FileArchive className="size-6" />
            ) : (
              <Upload className="size-6" />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[13px] font-medium text-foreground/80">
              {isUploading ? '正在上传...' : isDragOver ? '松开以上传' : '拖拽 zip 包到此处，或点击选择'}
            </div>
            <div className="text-[12px] text-foreground/45">支持 .zip 格式，压缩包内需含 SKILL.md</div>
          </div>
        </div>

        {/* 文件类型与结构说明 */}
        <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-[12px] leading-relaxed text-foreground/55">
          <div className="mb-1 font-medium text-foreground/70">结构要求</div>
          支持三种结构：① <code className="rounded bg-background px-1 py-0.5">skill/SKILL.md</code>；
          ② 多个技能各自一个目录；③ 顶层直接 <code className="rounded bg-background px-1 py-0.5">SKILL.md</code>。
          单包 ≤ 50MB。
        </div>
      </DialogContent>
    </Dialog>
  )
}
