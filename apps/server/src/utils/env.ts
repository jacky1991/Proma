/**
 * 运行环境工具：生产态判定与生产敏感配置校验。
 *
 * 生产态语义：PROMA_DEV !== '1' 即视为生产态（默认生产，开发需显式声明）。
 * 生产态下 PROMA_JWT_SECRET 与 PROMA_SERVER_MASTER_KEY 必须显式设置，
 * 由 index.ts 启动期调用 validateProductionEnv 强制校验，缺失即退出，
 * 避免 JWT 回落公开默认密钥（可伪造 admin token）与渠道 API Key 明文落盘两类静默降级。
 */

/** 环境变量键值视图（便于单测注入） */
type EnvVars = Record<string, string | undefined>

/** 校验通过 */
interface ProductionEnvOk {
  ok: true
}

/** 校验失败（携带缺失的环境变量名列表） */
interface ProductionEnvFailure {
  ok: false
  missing: string[]
}

/** 生产敏感配置校验结果 */
export type ProductionEnvValidation = ProductionEnvOk | ProductionEnvFailure

/** 生产态必需的环境变量名（JWT 签名密钥 + 渠道 API Key AES-256-GCM 主密钥） */
const PRODUCTION_REQUIRED_VARS = ['PROMA_JWT_SECRET', 'PROMA_SERVER_MASTER_KEY']

/**
 * 是否为生产模式。
 *
 * 判定：PROMA_DEV !== '1' 即生产态（默认生产，开发模式需显式设 PROMA_DEV=1）。
 */
export function isProduction(): boolean {
  return process.env.PROMA_DEV !== '1'
}

/**
 * 校验生产敏感配置（纯函数，支持注入 env 对象以便单测）。
 *
 * 生产态（PROMA_DEV !== '1'）下逐一检查必需环境变量；
 * 开发态（PROMA_DEV=1）跳过校验直接通过（保留迭代 8 降级语义：
 * 主密钥缺失降级明文、JWT 使用 dev 默认密钥）。
 *
 * @param env 注入的环境变量视图，默认取 process.env
 * @returns ok 为 true 表示通过；否则 missing 列出缺失的环境变量名
 */
export function validateProductionEnv(env: EnvVars = process.env): ProductionEnvValidation {
  // 开发态跳过校验
  if (env.PROMA_DEV === '1') {
    return { ok: true }
  }
  const missing = PRODUCTION_REQUIRED_VARS.filter((name) => !env[name])
  if (missing.length > 0) {
    return { ok: false, missing }
  }
  return { ok: true }
}
