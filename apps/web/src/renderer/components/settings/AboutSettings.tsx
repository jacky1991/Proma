/**
 * AboutSettings - 关于页面
 *
 * 显示应用版本号等基本信息。
 * 注：Web 端不做本地环境检测（Node/Git/Shell 在服务端），原环境检测卡片已移除。
 */

import * as React from 'react'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from './primitives'

/** 从 package.json 构建时由 Vite define 注入 */
declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__

export function AboutSettings(): React.ReactElement {
  return (
    <SettingsSection
      title="关于 Proma"
      description="集成通用 AI Agent 的下一代人工智能软件"
    >
      <SettingsCard>
        <SettingsRow label="版本">
          <span className="text-sm text-muted-foreground font-mono">{APP_VERSION}</span>
        </SettingsRow>
        <SettingsRow label="运行时">
          <span className="text-sm text-muted-foreground">Bun + React</span>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
