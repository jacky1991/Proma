/**
 * 定时任务（Automation）调度器（Web 服务端版）
 *
 * 从 Electron 端 main/lib/automation-scheduler.ts 迁移而来，适配 server：
 * - 用 orchestrator.sendMessage + Promise/超时包装 替代 runAgentHeadless
 * - 用 wsStreamSink.emit 替代 BrowserWindow.send 广播
 * - per-user scope：会话类操作传 scope；automation 数据保持全局共享（adminOnly 资源）
 * - 完成通知按 D4 决策 no-op + warn（飞书未迁移，通知渠道暂缺）
 * - 依赖注入：orchestrator/sink 由 startScheduler 注入，避免与 engine.ts 循环 import
 *
 * 核心设计同原版：下次触发时间戳 + 30s tick 短轮询（抗休眠漂移）；
 * 子会话按 sessionMode 决定新建/复用；强制 bypassPermissions；忙时跳过；
 * 连续失败达上限自动暂停；启动时恢复过期任务顺延一个完整间隔。
 */

import type { AgentRuntime, Automation, AutomationRun } from '@proma/shared'
import {
  AUTOMATION_DEFAULT_SESSION_MODE,
  AUTOMATION_MAX_CONSECUTIVE_FAILURES,
} from '@proma/shared'
import type { UserScope } from '@proma/server-core/config-paths'
import {
  appendRun,
  computeNextRunAt,
  getAutomation,
  listAutomations,
  setLastSessionId,
  setNextRunAt,
  updateAutomation,
} from '@proma/server-core/automation-manager'
import {
  createAgentSession,
  getAgentSessionMeta,
  updateAgentSessionMeta,
} from '@proma/server-core/agent-session-manager'
import { getSessionContextUsageRatio } from '@proma/server-core/agent-session-usage'
import type { AgentOrchestrator, SessionCallbacks } from '@proma/server-core/agent-orchestrator'
import type { WsStreamSink } from './ws'
import { createLogger } from '@proma/server-core/logger'

const logger = createLogger('定时任务')

/** tick 周期：每 30s 检查一次到期任务（短轮询，抗休眠漂移） */
const TICK_INTERVAL_MS = 30_000

/** 单次任务执行的超时上限：2 小时。超时后强制标记 error 并释放槽位 */
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** daily 模式上下文占用率切换阈值；≥ 此值时本次主动新建会话，规避 SDK 自动压缩 */
const DAILY_CONTEXT_ROLLOVER_THRESHOLD = 0.7

/** 自动调度归属 fallback：ownerUserId 缺失的老任务归 default 用户 */
const DEFAULT_TICK_USER_ID = 'default'

// 引擎实例由 startScheduler 注入（避免与 engine.ts 循环 import）
let orchestratorRef: AgentOrchestrator | null = null
let sinkRef: WsStreamSink | null = null

/** 正在执行中的 automation id 集合，防止同一任务重入 */
const runningAutomations = new Set<string>()

let tickTimer: ReturnType<typeof setInterval> | undefined

/** 判断两个时间戳是否落在同一个本地自然日 */
function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

function formatScheduleLabel(a: Automation): string {
  if (a.scheduleType === 'once') {
    const when = a.scheduledAt
      ? new Date(a.scheduledAt).toLocaleString('zh-CN', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : '指定时间'
    return `仅运行一次（${when}）`
  }
  if (a.scheduleType === 'daily') return `每天 ${a.timeOfDay ?? '09:00'}`
  if (a.scheduleType === 'weekly') {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `每${names[a.dayOfWeek ?? 1]} ${a.timeOfDay ?? '09:00'}`
  }
  if (a.scheduleType === 'monthly') return `每月 ${a.dayOfMonth ?? 1} 号 ${a.timeOfDay ?? '09:00'}`
  const min = a.intervalMinutes
  if (min < 60) return `每 ${min} 分钟`
  if (min < 1440) return `每 ${min / 60} 小时`
  return `每 ${min / 1440} 天`
}

/** 广播任务列表变更（automation:changed），触发前端刷新 */
function broadcastChanged(): void {
  sinkRef?.emit('*', { type: 'automation-changed' }, 'automation:changed')
}

/**
 * 定时任务完成通知（D4 决策：Web 端飞书未迁移，通知渠道暂缺）
 * 保留入口以便未来接入 IM；当前配置了通知目标时仅 warn 提示。
 */
function notifyAutomationRunFinished(payload: { automation: Automation; run: AutomationRun }): void {
  if ((payload.automation.notificationTargets ?? []).length > 0) {
    logger.warn(`任务「${payload.automation.name}」运行完成，但通知渠道未配置（Web 端 IM 未迁移）`, {
      automationId: payload.automation.id,
      status: payload.run.status,
    })
  }
}

/**
 * 执行一次定时任务：新建/复用子会话 + sendMessage 执行
 *
 * @returns 本次运行的子会话 ID（前端可据此跳转；跳过/异常返回 undefined）
 */
export async function runAutomation(automation: Automation, scope: UserScope): Promise<string | undefined> {
  const orchestrator = orchestratorRef
  if (!orchestrator) {
    logger.error('orchestrator 未注入，无法执行定时任务（请先 startScheduler）')
    return undefined
  }

  if (runningAutomations.has(automation.id)) {
    logger.info(`${automation.name} 上一轮尚未结束，跳过本轮`)
    appendRun(automation.id, {
      runAt: Date.now(),
      sessionId: '',
      status: 'skipped',
      skipReason: '上一轮尚未结束',
    })
    broadcastChanged()
    return undefined
  }

  runningAutomations.add(automation.id)
  const runAt = Date.now()

  try {
    // 根据 sessionMode 决定新建或复用子会话（逻辑同原版）
    const sessionMode = automation.sessionMode ?? AUTOMATION_DEFAULT_SESSION_MODE
    const agentRuntime: AgentRuntime = automation.agentRuntime ?? 'pi'

    let reuseSessionId: string | undefined
    const lastSessionMeta = automation.lastSessionId ? getAgentSessionMeta(automation.lastSessionId, scope) : undefined
    // 已被用户手动接管（毕业）的会话不再复用，强制新建，避免把定时任务消息注入用户私人会话
    if (automation.lastSessionId && lastSessionMeta && !lastSessionMeta.automationGraduated) {
      if (sessionMode === 'reuse') {
        reuseSessionId = automation.lastSessionId
      } else if (
        sessionMode === 'daily' &&
        automation.lastRunAt &&
        isSameLocalDay(automation.lastRunAt, runAt)
      ) {
        const usageRatio = getSessionContextUsageRatio(automation.lastSessionId, scope)
        if (usageRatio === undefined || usageRatio < DAILY_CONTEXT_ROLLOVER_THRESHOLD) {
          reuseSessionId = automation.lastSessionId
        } else {
          logger.info(`${automation.name} 上下文占用 ${(usageRatio * 100).toFixed(1)}% 已达阈值，本次自动开新会话`)
        }
      }
    }

    let targetSessionId: string
    if (reuseSessionId) {
      targetSessionId = reuseSessionId
    } else {
      const created = createAgentSession(automation.name, automation.channelId, automation.workspaceId, automation.modelId, agentRuntime, scope)
      updateAgentSessionMeta(created.id, { sourceAutomationId: automation.id, agentRuntime }, scope)
      targetSessionId = created.id
      setLastSessionId(automation.id, created.id)
    }

    // 切换 runtime 时清除旧 SDK resume 痕迹，避免跨 SDK resume
    const targetSessionMeta = getAgentSessionMeta(targetSessionId, scope)
    const previousAgentRuntime: AgentRuntime = targetSessionMeta?.agentRuntime ?? 'pi'
    if (targetSessionMeta && previousAgentRuntime !== agentRuntime) {
      updateAgentSessionMeta(targetSessionId, { agentRuntime, sdkSessionId: undefined }, scope)
    }

    await new Promise<void>((resolveRun) => {
      let settled = false
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined

      const finish = (status: 'success' | 'error', error?: string): void => {
        if (settled) return
        settled = true
        if (timeoutTimer) clearTimeout(timeoutTimer)
        const run: AutomationRun = {
          runAt,
          sessionId: targetSessionId,
          status,
          durationMs: Date.now() - runAt,
          error,
        }
        appendRun(automation.id, run)
        broadcastChanged()
        notifyAutomationRunFinished({ automation, run })
        // 失败退避：连续失败达上限自动暂停
        const latest = getAutomation(automation.id)
        if (
          latest &&
          latest.active &&
          (latest.consecutiveFailures ?? 0) >= AUTOMATION_MAX_CONSECUTIVE_FAILURES
        ) {
          updateAutomation({ id: automation.id, active: false })
          logger.warn(`${automation.name} 连续失败 ${latest.consecutiveFailures} 次，已自动暂停`)
          broadcastChanged()
        }
        resolveRun()
      }

      // 超时保护：sendMessage 永不回调时避免任务永久卡死
      timeoutTimer = setTimeout(() => {
        finish('error', `执行超时（超过 ${RUN_TIMEOUT_MS / 3600_000} 小时）`)
        logger.warn(`${automation.name} 执行超时，强制结束`)
      }, RUN_TIMEOUT_MS)

      // 控制事件转发到 WS：前端依赖 stream-complete 清除 running 状态。
      // 编排层 eventBus 只转发流式内容消息，run-started / stream-complete /
      // title-updated / stream-error 这些控制信号由 callbacks 手动 emit（同 agent.ts:SEND_MESSAGE）。
      const callbacks: SessionCallbacks = {
        onError: (error) => {
          sinkRef?.emit(targetSessionId, { type: 'stream-error', error }, undefined, scope.userId)
          finish('error', error)
        },
        onComplete: (messages, opts) => {
          sinkRef?.emit(targetSessionId, { type: 'stream-complete', messages, ...opts }, undefined, scope.userId)
          finish('success')
        },
        onTitleUpdated: (title) => {
          sinkRef?.emit(targetSessionId, { type: 'title-updated', title }, undefined, scope.userId)
        },
        onRunStarted: (opts) => {
          sinkRef?.emit(targetSessionId, { type: 'run-started', ...opts }, undefined, scope.userId)
        },
      }

      orchestrator.sendMessage(
        {
          sessionId: targetSessionId,
          userMessage: `${automation.prompt}\n<!--PROMA_SCHEDULED_RUN-->`,
          automationContext: `这是 Proma 定时任务「${automation.name}」的自动执行（ID: ${automation.id}，${formatScheduleLabel(automation)}）。这本身就是定时任务，不要建议用户再创建定时任务。直接执行任务即可。如发现本任务连续失败、输出价值低、频率不合适或提示词不完整，可以使用 automation 工具读取并更新当前任务。`,
          channelId: automation.channelId,
          modelId: automation.modelId,
          agentRuntime,
          workspaceId: automation.workspaceId,
          permissionModeOverride: automation.permissionMode ?? 'bypassPermissions',
          triggeredBy: 'automation',
          startedAt: runAt,
        },
        callbacks,
        scope,
      ).catch((err: unknown) => {
        finish('error', err instanceof Error ? err.message : '未知错误')
      })
    })

    return targetSessionId
  } catch (err) {
    logger.error(`${automation.name} 执行异常`, { error: err })
    const errorRun: AutomationRun = {
      runAt,
      sessionId: '',
      status: 'error',
      durationMs: Date.now() - runAt,
      error: err instanceof Error ? err.message : '未知错误',
    }
    appendRun(automation.id, errorRun)
    broadcastChanged()
    notifyAutomationRunFinished({ automation, run: errorRun })
    return undefined
  } finally {
    runningAutomations.delete(automation.id)
  }
}

/**
 * 立即运行一次（手动触发；appendRun 统一推进 nextRunAt，故不影响调度计时之外的逻辑）
 * @returns 子会话 ID（前端可据此跳转）
 */
export async function runAutomationNow(id: string, scope: UserScope): Promise<string | undefined> {
  const automation = getAutomation(id)
  if (!automation) throw new Error(`定时任务不存在: ${id}`)
  // 草稿态（缺 channelId / workspaceId）拒绝运行，兜底前端 disabled
  if (!automation.channelId || !automation.workspaceId) {
    throw new Error('请先为该任务配置模型与工作区')
  }
  return runAutomation(automation, scope)
}

/** 一个 tick：扫描所有 active 且到期的任务并触发 */
function tick(): void {
  const now = Date.now()
  for (const automation of listAutomations()) {
    if (!automation.active) continue
    // 完整度兜底：历史数据可能 active=true 但缺工作区/渠道，跳过避免运行时崩溃
    if (!automation.channelId || !automation.workspaceId) continue
    if (now < automation.nextRunAt) continue
    if (runningAutomations.has(automation.id)) continue
    // 子会话归属创建者（ownerUserId）；老数据 fallback default 用户
    const scope: UserScope = { userId: automation.ownerUserId ?? DEFAULT_TICK_USER_ID }
    // 不 await，多个任务可并行触发；各自有 runningAutomations 重入保护
    void runAutomation(automation, scope)
  }
}

/**
 * 启动调度器
 *
 * 恢复策略：把已过期的 nextRunAt 顺延到「现在 + 一个完整间隔」，
 * 避免 server 重启后一堆历史任务在同一 tick 内雪崩触发。
 */
export function startScheduler(orchestrator: AgentOrchestrator, sink: WsStreamSink): void {
  if (tickTimer) return
  orchestratorRef = orchestrator
  sinkRef = sink
  const now = Date.now()
  for (const automation of listAutomations()) {
    if (automation.active && automation.nextRunAt <= now) {
      setNextRunAt(automation.id, computeNextRunAt(automation, now))
    }
  }
  tickTimer = setInterval(tick, TICK_INTERVAL_MS)
  logger.info(`调度器已启动，tick 周期 ${TICK_INTERVAL_MS / 1000}s`)
}

/** 停止调度器 */
export function stopScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = undefined
    logger.info('调度器已停止')
  }
}
