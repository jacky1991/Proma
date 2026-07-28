/**
 * 审计日志
 *
 * 敏感操作（登录、用户管理、管理员改全局配置）的结构化持久化留痕。
 * 沿用项目「JSON 配置 + JSONL 追加、无数据库」哲学：append 到 {dataRoot}/audit.jsonl。
 *
 * 与 logger 的关系：审计是独立持久化通道（要留痕、要含 actor、要可查询），
 * 不复用 console logger；但审计写入失败应 logger.error 告警（不阻塞业务流程）。
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getDataRoot } from './config-paths.ts'
import { createLogger } from './logger.ts'

const logger = createLogger('审计')

/** 单条审计记录 */
export interface AuditEntry {
  /** ISO 时间戳 */
  ts: string
  /** 操作者 userId（系统动作为 'system'；登录失败仅有用户名时用用户名） */
  actor: string
  /** 操作者用户名（便于人类阅读） */
  actorName?: string
  /** 动作标识，如 'auth:login' / 'user:delete' / 'channel:create' */
  action: string
  /** 受影响对象（被删 userId / 渠道 id 等） */
  target?: string
  /** 结果 */
  result: 'success' | 'failure'
  /** 补充说明（失败原因等，已脱敏） */
  detail?: string
}

/** 审计日志文件路径：{dataRoot}/audit.jsonl */
function getAuditPath(): string {
  return join(getDataRoot(), 'audit.jsonl')
}

/**
 * 追加一条审计记录
 *
 * 同步追加（appendFileSync）：高并发下序列化写入，保证顺序一致；
 * 轮转 / 集中采集随部署方案演进，本迭代不做。
 *
 * 写入失败不抛错（不阻塞业务），仅 logger.error 告警。
 */
export function recordAudit(entry: Omit<AuditEntry, 'ts'>): void {
  const full: AuditEntry = { ts: new Date().toISOString(), ...entry }
  try {
    const path = getAuditPath()
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path, JSON.stringify(full) + '\n', 'utf-8')
  } catch (err) {
    logger.error('审计记录写入失败', { action: entry.action, error: err })
  }
}

/** 读取全部审计记录（按时间顺序）；文件不存在时返回空数组。供查询 / 测试使用。 */
export function readAuditLog(): AuditEntry[] {
  const path = getAuditPath()
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, 'utf-8')
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEntry)
  } catch {
    return []
  }
}
