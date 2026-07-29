/**
 * Automation（定时任务）域 HTTP 路由
 *
 * 全部端点 adminOnly（定时任务完全管理员专属）。
 * run-now 调 automation-scheduler 立即执行（新建/复用子会话 + 发送 prompt）。
 * 配置变化通过 WS 广播 automation:changed 事件。
 */

import { Hono } from 'hono'
import {
  listAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
} from '@proma/server-core/automation-manager'
import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@proma/shared'
import { wsStreamSink } from '../ws'
import { adminOnly } from '../middleware/role.ts'
import { getUserScope } from '../utils/user-scope'
import { runAutomationNow } from '../automation-scheduler'

const automation = new Hono()

/** 广播 automation:changed 事件到所有 WS 连接 */
function broadcastChanged(): void {
  wsStreamSink.emit('*', { type: 'automation-changed' }, 'automation:changed')
}

/** POST /api/automation:list → Automation[]（仅管理员：定时任务完全管理员专属） */
automation.post('/automation:list', adminOnly, (c) => {
  return c.json(listAutomations())
})

/** POST /api/automation:create → Automation（仅管理员：全局共享资源写操作） */
automation.post('/automation:create', adminOnly, async (c) => {
  const scope = getUserScope(c)
  const input = await c.req.json<CreateAutomationInput>()
  if (!input || typeof input !== 'object') {
    return c.json({ error: 'input 必须是对象' }, 400)
  }
  if (!input.name?.trim()) {
    return c.json({ error: 'name 必填' }, 400)
  }
  if (!input.prompt?.trim()) {
    return c.json({ error: 'prompt 必填' }, 400)
  }
  const a = createAutomation({ ...input, ownerUserId: scope.userId })
  broadcastChanged()
  return c.json(a)
})

/** POST /api/automation:update → Automation | undefined（仅管理员：全局共享资源写操作） */
automation.post('/automation:update', adminOnly, async (c) => {
  const input = await c.req.json<UpdateAutomationInput>()
  if (!input || typeof input !== 'object') {
    return c.json({ error: 'input 必须是对象' }, 400)
  }
  if (!input.id?.trim()) {
    return c.json({ error: 'id 必填' }, 400)
  }
  const existing = getAutomation(input.id)
  if (!existing) {
    return c.json(undefined)
  }
  try {
    const a = updateAutomation(input)
    broadcastChanged()
    return c.json(a)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '更新失败' }, 400)
  }
})

/** POST /api/automation:delete → boolean（仅管理员：全局共享资源写操作） */
automation.post('/automation:delete', adminOnly, async (c) => {
  const { id } = await c.req.json<{ id: string }>()
  if (!id?.trim()) {
    return c.json({ error: 'id 必填' }, 400)
  }
  const ok = deleteAutomation(id)
  broadcastChanged()
  return c.json(ok)
})

/** POST /api/automation:toggle → Automation | undefined（仅管理员：全局共享资源写操作） */
automation.post('/automation:toggle', adminOnly, async (c) => {
  const { id, active } = await c.req.json<{ id: string; active: boolean }>()
  if (!id?.trim()) {
    return c.json({ error: 'id 必填' }, 400)
  }
  if (typeof active !== 'boolean') {
    return c.json({ error: 'active 必须是 boolean' }, 400)
  }
  try {
    const a = updateAutomation({ id, active })
    broadcastChanged()
    return c.json(a)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '切换失败' }, 400)
  }
})

/**
 * POST /api/automation:run-now（仅管理员）
 *
 * 立即执行一次：新建/复用子会话并经 orchestrator 发送 prompt。
 * 返回 { ok, sessionId }，sessionId 供前端跳转到本次运行的子会话。
 */
automation.post('/automation:run-now', adminOnly, async (c) => {
  const { id } = await c.req.json<{ id: string }>()
  if (!id?.trim()) {
    return c.json({ error: 'id 必填' }, 400)
  }
  const scope = getUserScope(c)
  try {
    const sessionId = await runAutomationNow(id, scope)
    return c.json({ ok: true, sessionId })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '运行失败' }, 400)
  }
})

export { automation }
