/**
 * System Prompt 域 HTTP 路由
 *
 * 将 Electron IPC handler 映射为 Hono 路由。
 */

import { Hono } from 'hono'
import { SYSTEM_PROMPT_IPC_CHANNELS } from '@proma/shared'
import type { SystemPromptCreateInput, SystemPromptUpdateInput } from '@proma/shared'
import {
  getSystemPromptConfig,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  updateAppendSetting,
  setDefaultPrompt,
} from '@proma/server-core/system-prompt-manager'
import { adminOnly } from '../middleware/role.ts'

const systemPrompt = new Hono()

/** POST /api/system-prompt:get-config → SystemPromptConfig */
systemPrompt.post(`/${SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG}`, (c) => {
  return c.json(getSystemPromptConfig())
})

/** POST /api/system-prompt:create → SystemPrompt（仅管理员） */
systemPrompt.post(`/${SYSTEM_PROMPT_IPC_CHANNELS.CREATE}`, adminOnly, async (c) => {
  const input = await c.req.json<SystemPromptCreateInput>()
  return c.json(createSystemPrompt(input))
})

/** POST /api/system-prompt:update → SystemPrompt（仅管理员） */
systemPrompt.post(`/${SYSTEM_PROMPT_IPC_CHANNELS.UPDATE}`, adminOnly, async (c) => {
  const { id, input } = await c.req.json<{ id: string; input: SystemPromptUpdateInput }>()
  return c.json(updateSystemPrompt(id, input))
})

/** POST /api/system-prompt:delete → { ok: true }（仅管理员） */
systemPrompt.post(`/${SYSTEM_PROMPT_IPC_CHANNELS.DELETE}`, adminOnly, async (c) => {
  const { id } = await c.req.json()
  deleteSystemPrompt(id)
  return c.json({ ok: true })
})

/** POST /api/system-prompt:update-append-setting → { ok: true }（仅管理员） */
systemPrompt.post(`/${SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING}`, adminOnly, async (c) => {
  const { enabled } = await c.req.json()
  updateAppendSetting(enabled)
  return c.json({ ok: true })
})

/** POST /api/system-prompt:set-default → { ok: true }（仅管理员） */
systemPrompt.post(`/${SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT}`, adminOnly, async (c) => {
  const { id } = await c.req.json()
  setDefaultPrompt(id)
  return c.json({ ok: true })
})

export { systemPrompt }
