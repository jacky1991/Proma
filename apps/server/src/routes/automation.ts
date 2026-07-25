/**
 * Automation（定时任务）域 HTTP 路由
 *
 * M2.5 迭代 6：迁移 CRUD 配置管理路由。
 * run-now 返回"即将推出"（执行逻辑推迟到 M3 后）。
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

const automation = new Hono()

/** 广播 automation:changed 事件到所有 WS 连接 */
function broadcastChanged(): void {
  wsStreamSink.emit('*', { type: 'automation-changed' }, 'automation:changed')
}

/** POST /api/automation:list → Automation[] */
automation.post('/automation:list', (c) => {
  return c.json(listAutomations())
})

/** POST /api/automation:create → Automation */
automation.post('/automation:create', async (c) => {
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
  const a = createAutomation(input)
  broadcastChanged()
  return c.json(a)
})

/** POST /api/automation:update → Automation | undefined */
automation.post('/automation:update', async (c) => {
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

/** POST /api/automation:delete → boolean */
automation.post('/automation:delete', async (c) => {
  const { id } = await c.req.json<{ id: string }>()
  if (!id?.trim()) {
    return c.json({ error: 'id 必填' }, 400)
  }
  const ok = deleteAutomation(id)
  broadcastChanged()
  return c.json(ok)
})

/** POST /api/automation:toggle → Automation | undefined */
automation.post('/automation:toggle', async (c) => {
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
 * POST /api/automation:run-now
 *
 * M2.5 阶段：执行逻辑推迟到 M3 后，返回"即将推出"提示。
 */
automation.post('/automation:run-now', async (c) => {
  const { id } = await c.req.json<{ id: string }>()
  if (!id?.trim()) {
    return c.json({ error: 'id 必填' }, 400)
  }
  return c.json({
    error: '即将推出',
    message: '定时任务的立即执行功能将在后续版本中支持',
  })
})

export { automation }
