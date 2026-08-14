/**
 * AboutSettings - 关于页面
 *
 * 显示应用版本号、开源许可与源码获取入口（AGPL-3.0 第 13 条要求）。
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

/** 开源源码仓库地址（本项目公开仓库） */
const SOURCE_REPO_URL = 'https://github.com/jacky1991/proma-web'
/** 上游项目地址（fork 来源，AGPL-3.0） */
const UPSTREAM_REPO_URL = 'https://github.com/proma-ai/Proma'

export function AboutSettings(): React.ReactElement {
  return (
    <SettingsSection
      title="关于 Proma Web"
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
      <SettingsCard>
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-foreground">开源许可与源码</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            本项目基于{' '}
            <a
              href={UPSTREAM_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              proma-ai/Proma
            </a>
            {' '}（上游）衍生，遵循{' '}
            <span className="font-mono">AGPL-3.0</span>{' '}
            开源。依据 AGPL-3.0 第 13 条，任何通过网络与本服务交互的用户均可免费获取完整源码。
          </p>
        </div>
        <SettingsRow label="完整源码">
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline font-mono"
          >
            {SOURCE_REPO_URL.replace('https://', '')}
          </a>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
