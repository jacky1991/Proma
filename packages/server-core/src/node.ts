/**
 * @proma/server-core/node — Node 侧便捷入口。
 *
 * 提供端口的 Node 默认实现，并在导入时注册为降级默认依赖，
 * 供服务端实例化与冒烟测试兜底（显式 configureServerCore 仍优先）。
 *
 * 仅 Node 侧（服务端 / Electron 主进程 / CLI）使用；不要从浏览器渲染层导入。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { CryptoPort, EnvProbe, StreamSink } from './ports'
import { setDefaultDepsFactory, type ServerCoreDeps } from './config'

/** 降级密文前缀：标记未加密的明文（主密钥缺失时使用）。 */
const PLAINTEXT_FALLBACK_PREFIX = 'plain:'

/**
 * 基于 AES-256-GCM 的加密端口实现（服务端）。
 *
 * 主密钥来源：环境变量 PROMA_SERVER_MASTER_KEY（hex 或 base64 编码的 32 字节）。
 * - 提供合法主密钥：执行 AES-256-GCM 加解密（IV 随机，密文 = base64(iv(12) + ciphertext + tag(16))）。
 * - 缺失主密钥：降级为明文存储 + 警告日志（isAvailable 返回 false）。
 *   仅适用于 M1 冒烟；正式信封加密在 M3 迭代 4 落地（密钥管理 + 轮换）。
 */
export class NodeAesGcmCryptoProvider implements CryptoPort {
  private readonly key: Buffer | null

  constructor() {
    const raw = process.env.PROMA_SERVER_MASTER_KEY
    if (raw) {
      const key = Buffer.from(raw, 'hex')
      if (key.length === 32) {
        this.key = key
      } else {
        // 尝试 base64
        const key64 = Buffer.from(raw, 'base64')
        if (key64.length === 32) {
          this.key = key64
        } else {
          console.warn('[server-core] PROMA_SERVER_MASTER_KEY 长度非 32 字节，加密降级为明文')
          this.key = null
        }
      }
    } else {
      this.key = null
    }
  }

  isAvailable(): boolean {
    return this.key !== null
  }

  encryptString(plain: string): string {
    if (this.key === null) {
      // 降级：明文加前缀，保证 decryptString 可识别并还原
      return PLAINTEXT_FALLBACK_PREFIX + plain
    }
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, ciphertext, tag]).toString('base64')
  }

  decryptString(enc: string): string {
    if (enc.startsWith(PLAINTEXT_FALLBACK_PREFIX)) {
      return enc.slice(PLAINTEXT_FALLBACK_PREFIX.length)
    }
    if (this.key === null) {
      // 无主密钥但收到非降级密文：无法解密，原样返回（兼容历史明文）
      return enc
    }
    const buf = Buffer.from(enc, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ciphertext = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
  }
}

/** 空操作事件流下沉：丢弃所有事件（测试 / 未启用推送时使用）。 */
export class NoopStreamSink implements StreamSink {
  emit(): void {
    /* no-op */
  }
}

/**
 * 构造 Node 环境的默认 EnvProbe。
 * - isPackaged: true（服务端视为正式态，使用 ~/.proma）
 * - version: 读 PROMA_SERVER_VERSION env，否则 '0.0.0-server'
 * - openExternal: 服务端无浏览器语义，仅记录日志（真实 OAuth 应由 configure 注入回调）
 */
export function createNodeEnvProbe(): EnvProbe {
  return {
    isPackaged: true,
    version: process.env.PROMA_SERVER_VERSION ?? '0.0.0-server',
    openExternal: (url: string) => {
      console.log('[server-core] openExternal（服务端默认 no-op）:', url)
    },
  }
}

/** 构造降级默认依赖组合（AES-GCM 或明文降级 + Node EnvProbe + Noop StreamSink）。 */
export function createDefaultDeps(): ServerCoreDeps {
  return {
    crypto: new NodeAesGcmCryptoProvider(),
    envProbe: createNodeEnvProbe(),
    streamSink: new NoopStreamSink(),
  }
}

// 导入本入口即注册降级默认依赖工厂
setDefaultDepsFactory(createDefaultDeps)
