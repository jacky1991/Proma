/**
 * 结构化日志器
 *
 * 为服务端（apps/server）与核心引擎（server-core）提供统一日志出口：
 * - 级别过滤（PROMA_LOG_LEVEL，默认 info；低于阈值的 debug 不输出）
 * - 上下文字段注入（userId / sessionId / 任意键，便于按用户/会话聚合排障）
 * - 双输出格式：
 *   - human（默认）：`[模块] msg {ctx}`，兼容现有 console 观感
 *   - json（PROMA_LOG_FORMAT=json）：单行 JSON `{ts,level,module,msg,...ctx}`，便于采集
 * - 敏感字段脱敏（password / token / secret / apikey / authorization / masterkey 等）
 *
 * 设计取向：最小实现，不引入 pino / winston 等外部依赖，
 * 与项目「本地优先、无重型栈」一致。日志走进程 stdout/stderr，
 * 采集 / 轮转 / 集中化随部署方案演进（本迭代非目标）。
 */

/** 日志级别（权重用于阈值比较） */
type Level = 'debug' | 'info' | 'warn' | 'error'

interface LevelMeta {
  /** 阈值权重：低于 threshold 的级别不输出 */
  weight: number
  /** JSON 格式下的 level 标签 */
  label: string
  /** 实际输出通道（warn/error 走 stderr） */
  stream: (line: string) => void
}

const LEVELS: Record<Level, LevelMeta> = {
  debug: { weight: 10, label: 'DEBUG', stream: (m) => console.log(m) },
  info: { weight: 20, label: 'INFO', stream: (m) => console.log(m) },
  warn: { weight: 30, label: 'WARN', stream: (m) => console.warn(m) },
  error: { weight: 40, label: 'ERROR', stream: (m) => console.error(m) },
}

/** 上下文：任意键值，常见 userId / sessionId / error */
export interface LogContext {
  userId?: string
  sessionId?: string
  [k: string]: unknown
}

/** 日志器实例接口 */
export interface Logger {
  debug: (msg: string, ctx?: LogContext) => void
  info: (msg: string, ctx?: LogContext) => void
  warn: (msg: string, ctx?: LogContext) => void
  error: (msg: string, ctx?: LogContext) => void
}

/** 命中即脱敏的键名片段（小写包含匹配） */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'masterkey',
  'master_key',
]

const REDACTED = '[REDACTED]'

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_FRAGMENTS.some((p) => lower.includes(p))
}

/**
 * 规范化单个键值对：
 * - 敏感键 → 打码（字符串保留前 4 字符以便辨识，其余 [REDACTED]；过短则全打码）
 * - Error → 提取 message + stack（便于 JSON 序列化与排障）
 * - 其余原样
 */
function normalizeValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    if (typeof value === 'string') {
      return value.length <= 4 ? REDACTED : value.slice(0, 4) + '…' + REDACTED
    }
    return REDACTED
  }
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack }
  }
  return value
}

/** 规范化整个上下文（脱敏 + Error 提取，仅顶层） */
function normalizeContext(ctx: LogContext): LogContext {
  const out: LogContext = {}
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = normalizeValue(k, v)
  }
  return out
}

/** 读取级别阈值（惰性，便于测试与运行时切换） */
function readThreshold(): number {
  const raw = (process.env.PROMA_LOG_LEVEL ?? 'info').toLowerCase()
  const meta = LEVELS[raw as Level]
  return (meta ?? LEVELS.info).weight
}

/** 是否 JSON 输出格式（惰性） */
function isJsonFormat(): boolean {
  return (process.env.PROMA_LOG_FORMAT ?? 'human').toLowerCase() === 'json'
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 创建一个模块级日志器
 *
 * @param module 模块名，作为 human 前缀 `[模块]` 与 JSON 字段 `module`
 */
export function createLogger(module: string): Logger {
  function emit(level: Level, msg: string, ctx?: LogContext): void {
    const meta = LEVELS[level]
    if (meta.weight < readThreshold()) return

    const safeCtx = ctx ? normalizeContext(ctx) : undefined

    if (isJsonFormat()) {
      const payload: Record<string, unknown> = {
        ts: nowIso(),
        level: meta.label,
        module,
        msg,
      }
      if (safeCtx) Object.assign(payload, safeCtx)
      meta.stream(JSON.stringify(payload))
      return
    }

    // human：[模块] msg {ctx}
    const ctxStr =
      safeCtx && Object.keys(safeCtx).length > 0 ? ' ' + JSON.stringify(safeCtx) : ''
    meta.stream(`[${module}] ${msg}${ctxStr}`)
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
  }
}
