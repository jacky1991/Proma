/**
 * Channel 域 HTTP 路由
 *
 * 将 Electron IPC handler 映射为 Hono 路由。
 */

import { Hono } from 'hono'
import { CHANNEL_IPC_CHANNELS } from '@proma/shared'
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
  fetchModels,
} from '@proma/server-core/channel-manager'

const channel = new Hono()

/** POST /api/channel:list → Channel[] */
channel.post(`/${CHANNEL_IPC_CHANNELS.LIST}`, (c) => {
  return c.json(listChannels())
})

/** POST /api/channel:create → Channel */
channel.post(`/${CHANNEL_IPC_CHANNELS.CREATE}`, async (c) => {
  const input = await c.req.json()
  const ch = createChannel(input)
  return c.json(ch)
})

/** POST /api/channel:update → Channel */
channel.post(`/${CHANNEL_IPC_CHANNELS.UPDATE}`, async (c) => {
  const { id, ...input } = await c.req.json()
  const ch = updateChannel(id, input)
  return c.json(ch)
})

/** POST /api/channel:delete → { ok: true } */
channel.post(`/${CHANNEL_IPC_CHANNELS.DELETE}`, async (c) => {
  const { id } = await c.req.json()
  deleteChannel(id)
  return c.json({ ok: true })
})

/** POST /api/channel:test → { success: boolean; message?: string } */
channel.post(`/${CHANNEL_IPC_CHANNELS.TEST}`, async (c) => {
  const { channelId } = await c.req.json()
  const result = await testChannel(channelId)
  return c.json(result)
})

/** POST /api/channel:fetch-models → FetchModelsResult */
channel.post(`/${CHANNEL_IPC_CHANNELS.FETCH_MODELS}`, async (c) => {
  const input = await c.req.json()
  const result = await fetchModels(input)
  return c.json(result)
})

export { channel }
