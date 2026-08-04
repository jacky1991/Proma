/**
 * BrandingSettings - 品牌设置页（产品名称 + Logo）
 *
 * 仅 Web 端管理员可用（tab 已 adminOnly 过滤；组件内 isWebRuntime + isAdminAtom 兜底防深链）。
 * 保存后直接写入 brandingConfigAtom，侧边栏顶部品牌区即时更新。
 * 状态语义： productName / logoDataUrl 的空串统一表示「清除 / 使用默认」，与服务端校验一致。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Upload, RotateCcw, Loader2 } from 'lucide-react'
import { SettingsSection, SettingsCard } from './primitives'
import { Button } from '../ui/button'
import { isAdminAtom } from '@/atoms/auth'
import { isWebRuntime } from '@/lib/web-runtime'
import {
  brandingConfigAtom,
  DEFAULT_PRODUCT_NAME,
  DEFAULT_LOGO_URL,
} from '@/atoms/branding-atoms'

/** 前端 Logo 大小上限（与服务端 branding-service 一致，用于即时反馈） */
const MAX_LOGO_BYTES = 512 * 1024

export function BrandingSettings(): React.ReactElement | null {
  const isAdmin = useAtomValue(isAdminAtom)
  const config = useAtomValue(brandingConfigAtom)
  const setBrandingConfig = useSetAtom(brandingConfigAtom)

  const [nameInput, setNameInput] = React.useState(config?.productName ?? '')
  const [logoPreview, setLogoPreview] = React.useState(config?.logoDataUrl ?? '')
  const [saving, setSaving] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // 外部配置变更（如初次加载完成）时同步到本地编辑态
  React.useEffect(() => {
    setNameInput(config?.productName ?? '')
    setLogoPreview(config?.logoDataUrl ?? '')
  }, [config])

  // 仅 Web 管理员可访问（tab 过滤已挡，此处兜底防深链）
  if (!isWebRuntime() || !isAdmin) return null

  /** 选择图片 → 读为 base64 data URL 本地预览（先做大小 / 类型校验给即时反馈） */
  const handleLogoPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Logo 必须是图片文件')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(`Logo 过大：${Math.round(file.size / 1024)}KB 超过 ${MAX_LOGO_BYTES / 1024}KB 限制`)
      return
    }

    const reader = new FileReader()
    reader.onload = () => setLogoPreview(reader.result as string)
    reader.onerror = () => toast.error('读取图片失败')
    reader.readAsDataURL(file)
  }

  /** 保存品牌配置（产品名 + Logo） */
  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const updated = await window.electronAPI.updateBrandingConfig!({
        productName: nameInput,
        logoDataUrl: logoPreview,
      })
      setBrandingConfig(updated)
      toast.success('品牌配置已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 恢复内置默认（清空自定义配置） */
  const handleReset = async (): Promise<void> => {
    setSaving(true)
    try {
      const updated = await window.electronAPI.updateBrandingConfig!({
        productName: '',
        logoDataUrl: '',
      })
      setBrandingConfig(updated)
      toast.success('已恢复默认品牌')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setSaving(false)
    }
  }

  const savedName = config?.productName?.trim() ?? ''
  const savedLogo = config?.logoDataUrl ?? ''
  const hasChange = nameInput.trim() !== savedName || logoPreview !== savedLogo
  const hasCustom = savedName !== '' || savedLogo !== ''

  // 预览回退：编辑态 → 已保存 → 内置默认
  const previewLogo = logoPreview || savedLogo || DEFAULT_LOGO_URL
  const previewName = nameInput.trim() || DEFAULT_PRODUCT_NAME

  return (
    <div className="space-y-6">
      <SettingsSection
        title="品牌设置"
        description="自定义产品名称与 Logo，显示在左侧导航栏顶部。所有用户可见，仅管理员可修改。"
      >
        <SettingsCard divided={false}>
          <div className="px-4 py-4 flex items-center gap-3">
            <img
              src={previewLogo}
              alt={previewName}
              className="size-10 rounded-lg object-contain flex-shrink-0"
              draggable={false}
            />
            <div className="flex-1 min-w-0 text-[15px] font-semibold text-foreground truncate">{previewName}</div>
            <div className="text-[12px] text-muted-foreground flex-shrink-0">侧边栏顶部效果预览</div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="产品名称" description={`留空则显示默认值「${DEFAULT_PRODUCT_NAME}」`}>
        <SettingsCard divided={false}>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={30}
            placeholder={DEFAULT_PRODUCT_NAME}
            className="w-full h-9 px-3 rounded-md border border-border bg-background text-[13px] text-foreground outline-none focus:border-primary transition-colors"
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="产品 Logo" description="支持 PNG / JPG / WebP，≤ 512KB；留空使用内置默认 Logo。">
        <SettingsCard divided={false}>
          <div className="flex items-center gap-3 px-4 py-3">
            <img
              src={previewLogo}
              alt={previewName}
              className="size-12 rounded-lg object-contain border border-border/50 flex-shrink-0"
              draggable={false}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 ml-auto"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              选择图片
            </Button>
            {logoPreview && (
              <button
                type="button"
                onClick={() => setLogoPreview('')}
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                清除自定义 Logo
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleLogoPick}
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <div className="flex items-center justify-end gap-2">
        <Button onClick={handleSave} disabled={!hasChange || saving} className="gap-1.5">
          {saving && <Loader2 size={14} className="animate-spin" />}
          保存
        </Button>
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={saving || !hasCustom}
          className="gap-1.5"
        >
          <RotateCcw size={14} />
          恢复默认
        </Button>
      </div>
    </div>
  )
}
