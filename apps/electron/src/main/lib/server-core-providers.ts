/**
 * Electron 端 server-core 端口实现
 *
 * 把 Electron 专属能力（safeStorage 加密 / app.isPackaged / shell.openExternal）
 * 适配为 server-core 的 CryptoPort / EnvProbe，在主进程 bootstrap 时注入。
 *
 * 行为与迁移前 channel-manager / config-paths 内联的 safeStorage / app 用法完全一致，
 * 确保桌面端渠道加解密、配置目录判定零回归。
 */

import { app, safeStorage, shell } from 'electron'
import type { CryptoPort, EnvProbe } from '@proma/server-core'

/**
 * 包装 Electron safeStorage 的加密端口。
 *
 * 还原原 channel-manager 的 encryptApiKey / decryptKey 语义：
 * - isEncryptionAvailable() 为 false 时明文存取（与历史行为一致）；
 * - 否则 encryptString → base64，decryptString ← base64。
 */
export class SafeStorageCryptoProvider implements CryptoPort {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encryptString(plain: string): string {
    if (!safeStorage.isEncryptionAvailable()) return plain
    return safeStorage.encryptString(plain).toString('base64')
  }

  decryptString(enc: string): string {
    if (!safeStorage.isEncryptionAvailable()) return enc
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  }
}

/**
 * Electron 环境探针。
 *
 * - isPackaged: app.isPackaged（区分 dev/packed 配置目录、.asar 路径转换）；
 * - version: app.getVersion()（构造 User-Agent，与 setPromaVersion 同源）；
 * - openExternal: shell.openExternal（Codex OAuth 浏览器跳转）；
 * - resourcesPath: process.resourcesPath（打包资源定位）。
 */
export function createElectronEnvProbe(): EnvProbe {
  return {
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    openExternal: (url: string) => {
      shell.openExternal(url)
    },
    resourcesPath: process.resourcesPath,
  }
}
