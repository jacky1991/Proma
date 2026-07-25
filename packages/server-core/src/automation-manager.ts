/**
 * 定时任务（Automation）管理器
 *
 * 负责定时任务的 CRUD 与运行历史持久化。
 * - 索引文件：~/.proma/automations.json
 *
 * 零 Electron 依赖，Electron 端与 Web 服务端共用。
 * 调度逻辑见各端的 automation-scheduler，本文件只管数据。
 */

import { randomUUID } from 'node:crypto'
import { writeJsonFileAtomic, readJsonFileSafe } from './safe-file'
import { getAutomationsPath } from './config-paths'
import {
  AUTOMATION_MAX_HISTORY,
  AUTOMATION_DEFAULT_PERMISSION_MODE,
  type Automation,
  type AutomationRun,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '@proma/shared'

/** 索引文件格式 */
interface AutomationsIndex {
  version: number
  automations: Automation[]
}

const INDEX_VERSION = 2

/**
 * 兼容历史字段：
 * - sessionMode：v1 用过的 'new' 值统一改为 'daily'。
 * - permissionMode：已移除的 'auto' 统一改为默认完全自动模式。
 */
function migrateLegacyFields(data: AutomationsIndex): boolean {
  let changed = false
  for (const a of data.automations) {
    if ((a.sessionMode as string | undefined) === 'new') {
      a.sessionMode = 'daily'
      changed = true
    }
    const permissionMode = a.permissionMode as string | undefined
    if (permissionMode && permissionMode !== AUTOMATION_DEFAULT_PERMISSION_MODE) {
      a.permissionMode = AUTOMATION_DEFAULT_PERMISSION_MODE
      changed = true
    }
  }
  if (data.version < INDEX_VERSION) {
    data.version = INDEX_VERSION
    changed = true
  }
  return changed
}

/**
 * 内存缓存：避免每次操作都从磁盘读取完整索引。
 * 所有写入操作同时更新缓存和磁盘（write-through），保证一致性。
 */
let cachedIndex: AutomationsIndex | null = null

function readIndex(): AutomationsIndex {
  if (cachedIndex) return cachedIndex

  const data = readJsonFileSafe<AutomationsIndex>(getAutomationsPath())
  if (!data) {
    cachedIndex = { version: INDEX_VERSION, automations: [] }
    return cachedIndex
  }
  if (typeof data.version !== 'number') {
    console.warn(`[定时任务] 索引文件缺少有效 version 字段，将忽略其内容`)
    cachedIndex = { version: INDEX_VERSION, automations: [] }
    return cachedIndex
  }
  if (data.version > INDEX_VERSION) {
    console.warn(
      `[定时任务] 索引文件版本 ${data.version} 高于当前构建（${INDEX_VERSION}），将以原数据加载，` +
        `可能存在不识别的字段；请尽量升级到最新版本。`,
    )
    if (!Array.isArray(data.automations)) {
      cachedIndex = { version: INDEX_VERSION, automations: [] }
      return cachedIndex
    }
    cachedIndex = data
    return cachedIndex
  }
  if (!Array.isArray(data.automations)) {
    cachedIndex = { version: INDEX_VERSION, automations: [] }
    return cachedIndex
  }
  const migrated = migrateLegacyFields(data)
  cachedIndex = data
  if (migrated) {
    writeIndex(data)
    console.log('[定时任务] 索引已迁移至最新版本')
  }
  return cachedIndex
}

function writeIndex(index: AutomationsIndex): void {
  try {
    cachedIndex = index
    writeJsonFileAtomic(getAutomationsPath(), index)
  } catch (error) {
    cachedIndex = null
    console.error('[定时任务] 写入索引文件失败:', error)
    throw new Error('写入定时任务索引失败')
  }
}

/**
 * 计算下次触发时间戳（从基准时刻 from 起算）
 */
export function computeNextRunAt(
  a: { scheduleType: Automation['scheduleType'] } & Partial<
    Pick<Automation, 'intervalMinutes' | 'timeOfDay' | 'dayOfWeek' | 'dayOfMonth' | 'scheduledAt'>
  >,
  from: number = Date.now(),
): number {
  const FALLBACK_INTERVAL_MS = 10 * 60_000

  let result: number

  if (a.scheduleType === 'once') {
    result = Number.isFinite(a.scheduledAt) && a.scheduledAt! > 0
      ? a.scheduledAt!
      : from + FALLBACK_INTERVAL_MS
    if (!Number.isFinite(a.scheduledAt) || a.scheduledAt! <= 0) {
      console.warn(`[定时任务] computeNextRunAt: once 缺少有效 scheduledAt (${a.scheduledAt})，回退到 10 分钟后`)
    }
  } else if (a.scheduleType === 'interval') {
    const minutes = Number(a.intervalMinutes)
    if (!Number.isFinite(minutes) || minutes < 1) {
      console.warn(`[定时任务] computeNextRunAt: intervalMinutes 非法 (${a.intervalMinutes})，回退到 10 分钟`)
      result = from + FALLBACK_INTERVAL_MS
    } else {
      result = from + Math.max(1, minutes) * 60_000
    }
  } else {
    const timeOfDay = a.timeOfDay ?? '09:00'
    const parts = timeOfDay.split(':').map(Number)
    const hh = Number.isFinite(parts[0]) ? parts[0]! : 9
    const mm = Number.isFinite(parts[1]) ? parts[1]! : 0
    const next = new Date(from)
    next.setSeconds(0, 0)
    next.setHours(hh, mm, 0, 0)

    if (a.scheduleType === 'daily') {
      if (next.getTime() <= from) next.setDate(next.getDate() + 1)
      result = next.getTime()
    } else if (a.scheduleType === 'monthly') {
      const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
      const targetDom = Number.isFinite(a.dayOfMonth) && a.dayOfMonth! >= 1 && a.dayOfMonth! <= 31
        ? a.dayOfMonth!
        : 1
      next.setDate(1)
      next.setDate(Math.min(targetDom, daysInMonth(next.getFullYear(), next.getMonth())))
      if (next.getTime() <= from) {
        next.setDate(1)
        next.setMonth(next.getMonth() + 1)
        next.setDate(Math.min(targetDom, daysInMonth(next.getFullYear(), next.getMonth())))
      }
      result = next.getTime()
    } else {
      // weekly
      const targetDow = Number.isFinite(a.dayOfWeek) ? a.dayOfWeek! : 1
      let dayDiff = (targetDow - next.getDay() + 7) % 7
      if (dayDiff === 0 && next.getTime() <= from) dayDiff = 7
      next.setDate(next.getDate() + dayDiff)
      result = next.getTime()
    }
  }

  if (!Number.isFinite(result) || result <= 0) {
    console.warn(`[定时任务] computeNextRunAt: 计算结果非法 (${result})，回退到 10 分钟后`)
    return from + FALLBACK_INTERVAL_MS
  }

  return result
}

/** 获取全部定时任务（按 createdAt 升序） */
export function listAutomations(): Automation[] {
  return readIndex().automations.sort((a, b) => a.createdAt - b.createdAt)
}

/** 按 ID 获取单个定时任务 */
export function getAutomation(id: string): Automation | undefined {
  return readIndex().automations.find((a) => a.id === id)
}

/** 任务是否具备运行所需的最小完整度 */
function isAutomationRunnable(a: Pick<Automation, 'channelId' | 'workspaceId'>): boolean {
  return !!a.channelId && !!a.workspaceId
}

/**
 * 规范化 maxRuns：只接受 ≥1 的有限整数，其余一律按「不限次」处理返回 undefined。
 */
function normalizeMaxRuns(v: number | undefined): number | undefined {
  if (v === undefined) return undefined
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) return undefined
  return v
}

/**
 * 应用 maxRuns 变更。运行配额发生变化时重置已执行计数/完成标记。
 */
export function applyMaxRunsUpdate(
  target: Pick<Automation, 'maxRuns' | 'runCount' | 'completedAt'>,
  nextMaxRuns: number | undefined,
): void {
  const normalizedMaxRuns = normalizeMaxRuns(nextMaxRuns)
  if (normalizedMaxRuns !== target.maxRuns) {
    target.runCount = 0
    target.completedAt = undefined
  }
  target.maxRuns = normalizedMaxRuns
}

/**
 * 判断任务是否已达成「自动完成」条件
 */
function shouldAutoComplete(a: Pick<Automation, 'scheduleType' | 'maxRuns' | 'runCount'>): boolean {
  const count = a.runCount ?? 0
  if (a.scheduleType === 'once') return count >= 1
  const max = normalizeMaxRuns(a.maxRuns)
  return max !== undefined && count >= max
}

/** 创建定时任务 */
export function createAutomation(input: CreateAutomationInput): Automation {
  const index = readIndex()
  const now = Date.now()
  const requestedActive = input.active ?? true
  const active = requestedActive && isAutomationRunnable(input)

  const automation: Automation = {
    id: randomUUID(),
    name: input.name,
    prompt: input.prompt,
    active,
    scheduleType: input.scheduleType,
    intervalMinutes: input.intervalMinutes,
    timeOfDay: input.timeOfDay,
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
    scheduledAt: input.scheduledAt,
    maxRuns: normalizeMaxRuns(input.maxRuns),
    agentRuntime: input.agentRuntime ?? 'pi',
    channelId: input.channelId,
    modelId: input.modelId,
    workspaceId: input.workspaceId,
    permissionMode: input.permissionMode ?? AUTOMATION_DEFAULT_PERMISSION_MODE,
    sessionMode: input.sessionMode,
    notificationTargets: input.notificationTargets,
    sourceSessionId: input.sourceSessionId,
    createdAt: now,
    updatedAt: now,
    nextRunAt: computeNextRunAt(input, now),
    runCount: 0,
    runHistory: [],
  }

  index.automations.push(automation)
  writeIndex(index)
  console.log(`[定时任务] 已创建: ${automation.name} (${automation.id}), 模式 ${automation.scheduleType}`)
  return automation
}

/** 更新定时任务（部分字段） */
export function updateAutomation(input: UpdateAutomationInput): Automation | undefined {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === input.id)
  if (!target) return undefined

  const now = Date.now()
  if (input.name !== undefined) target.name = input.name
  if (input.prompt !== undefined) target.prompt = input.prompt
  if (input.agentRuntime !== undefined) target.agentRuntime = input.agentRuntime
  if (input.channelId !== undefined) target.channelId = input.channelId
  if (input.modelId !== undefined) target.modelId = input.modelId
  if (input.workspaceId !== undefined) {
    target.workspaceId = input.workspaceId || undefined
  }
  if (input.permissionMode !== undefined) target.permissionMode = input.permissionMode
  if (input.sessionMode !== undefined) target.sessionMode = input.sessionMode
  if (input.notificationTargets !== undefined) target.notificationTargets = input.notificationTargets
  if (input.maxRuns !== undefined) applyMaxRunsUpdate(target, input.maxRuns)

  // 调度参数变化：重算下次运行时间
  const scheduleChanged =
    (input.scheduleType !== undefined && input.scheduleType !== target.scheduleType) ||
    (input.intervalMinutes !== undefined && input.intervalMinutes !== target.intervalMinutes) ||
    (input.timeOfDay !== undefined && input.timeOfDay !== target.timeOfDay) ||
    (input.dayOfWeek !== undefined && input.dayOfWeek !== target.dayOfWeek) ||
    (input.dayOfMonth !== undefined && input.dayOfMonth !== target.dayOfMonth) ||
    (input.scheduledAt !== undefined && input.scheduledAt !== target.scheduledAt)
  if (input.scheduleType !== undefined) target.scheduleType = input.scheduleType
  if (input.intervalMinutes !== undefined) target.intervalMinutes = input.intervalMinutes
  if (input.timeOfDay !== undefined) target.timeOfDay = input.timeOfDay
  if (input.dayOfWeek !== undefined) target.dayOfWeek = input.dayOfWeek
  if (input.dayOfMonth !== undefined) target.dayOfMonth = input.dayOfMonth
  if (input.scheduledAt !== undefined) target.scheduledAt = input.scheduledAt
  if (scheduleChanged) {
    target.nextRunAt = computeNextRunAt(target, now)
  }

  // 启用状态变化
  if (input.active !== undefined && input.active !== target.active) {
    if (input.active && !isAutomationRunnable(target)) {
      throw new Error('启用定时任务前必须配置模型与工作区')
    }
    target.active = input.active
    if (input.active) {
      target.nextRunAt = computeNextRunAt(target, now)
      target.consecutiveFailures = 0
      target.runCount = 0
      target.completedAt = undefined
    }
  }

  // 调度配置被改成不完整时自动暂停
  if (target.active && !isAutomationRunnable(target)) {
    target.active = false
  }

  target.updatedAt = now
  writeIndex(index)
  return target
}

/** 删除定时任务 */
export function deleteAutomation(id: string): boolean {
  const index = readIndex()
  const before = index.automations.length
  index.automations = index.automations.filter((a) => a.id !== id)
  if (index.automations.length === before) return false
  writeIndex(index)
  console.log(`[定时任务] 已删除: ${id}`)
  return true
}

/**
 * 记录一次运行结果并推进下次触发时间
 */
export function appendRun(id: string, run: AutomationRun): Automation | undefined {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === id)
  if (!target) return undefined

  const now = Date.now()
  target.runHistory.unshift(run)
  if (target.runHistory.length > AUTOMATION_MAX_HISTORY) {
    target.runHistory = target.runHistory.slice(0, AUTOMATION_MAX_HISTORY)
  }

  if (run.status !== 'skipped') {
    target.lastRunAt = run.runAt
    target.runCount = (target.runCount ?? 0) + 1
    target.nextRunAt = computeNextRunAt(target, now)
  }

  if (run.status === 'error') {
    target.consecutiveFailures = (target.consecutiveFailures ?? 0) + 1
  } else {
    target.consecutiveFailures = 0
  }

  if (run.status !== 'skipped' && shouldAutoComplete(target)) {
    target.active = false
    target.completedAt = now
    console.log(`[定时任务] ${target.name} 已达成运行上限（${target.runCount} 次），自动完成停用`)
  }

  target.updatedAt = now
  writeIndex(index)
  return target
}

/** 设置 nextRunAt */
export function setNextRunAt(id: string, nextRunAt: number): void {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === id)
  if (!target) return
  target.nextRunAt = nextRunAt
  writeIndex(index)
}

/** 记录本任务最近一次运行创建的会话 ID */
export function setLastSessionId(id: string, sessionId: string): void {
  const index = readIndex()
  const target = index.automations.find((a) => a.id === id)
  if (!target) return
  target.lastSessionId = sessionId
  writeIndex(index)
}
