/**
 * 加密端口
 *
 * 抽象渠道 API Key 等敏感串的加解密，去耦 Electron safeStorage。
 * - Electron 侧：SafeStorageCryptoProvider（包装 OS 级 safeStorage，行为不变）
 * - Server 侧：NodeAesGcmCryptoProvider（AES-256-GCM，主密钥来自环境变量）
 *
 * M1 可先注入降级实现（明文 + 警告），正式信封加密在 M3 迭代 4 落地。
 */
export interface CryptoPort {
  /** 加密明文字符串，返回可持久化的密文（通常 base64）。 */
  encryptString(plain: string): string
  /** 解密 encryptString 产出的密文，还原明文；失败抛错。 */
  decryptString(enc: string): string
  /** 当前实现是否真正可用（safeStorage.isEncryptionAvailable 的等价物）。 */
  isAvailable(): boolean
}
