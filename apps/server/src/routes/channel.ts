/**
 * Channel 域 HTTP 路由
 *
 * 将 Electron IPC handler 映射为 Hono 路由。
 * 迭代 5：新增 decrypt-key / test-direct / plan-quota / codex-oauth。
 */

import { Hono } from 'hono'
import { CHANNEL_IPC_CHANNELS, serializeCodexCredentials } from '@proma/shared'
import type { ChannelDirectTestInput, CodexOAuthLoginResult } from '@proma/shared'
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
  fetchModels,
  decryptApiKey,
  testChannelDirect,
  getChannelPlanQuota,
} from '@proma/server-core/channel-manager'
import { loginCodexOAuth, cancelCodexOAuthLogin } from '@proma/server-core/codex-oauth-service'
import { streamSink } from '../engine'

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

// ===== 迭代 5 扩展 =====

/** POST /api/channel:decrypt-key → string（解密后的 API Key） */
channel.post(`/${CHANNEL_IPC_CHANNELS.DECRYPT_KEY}`, async (c) => {
  const { channelId } = await c.req.json<{ channelId: string }>()
  return c.json(decryptApiKey(channelId))
})

/** POST /api/channel:test-direct → ChannelTestResult */
channel.post(`/${CHANNEL_IPC_CHANNELS.TEST_DIRECT}`, async (c) => {
  const input = await c.req.json<ChannelDirectTestInput>()
  const result = await testChannelDirect(input)
  return c.json(result)
})

/** POST /api/channel:get-plan-quota → ChannelPlanQuotaResult */
channel.post(`/${CHANNEL_IPC_CHANNELS.GET_PLAN_QUOTA}`, async (c) => {
  const { channelId } = await c.req.json<{ channelId: string }>()
  const result = await getChannelPlanQuota(channelId)
  return c.json(result)
})

/**
 * POST /api/channel:codex-oauth-login → CodexOAuthLoginResult
 *
 * Web 端 OAuth 流程：
 * 1. 服务端调用 loginCodexOAuth，通过 onAuthUrl 回调捕获授权 URL
 * 2. 等待授权 URL 就绪后返回给客户端（客户端在新窗口打开）
 * 3. 用户授权后 SDK 本地 :1455 回调服务接收 code，loginCodexOAuth 完成
 * 4. 服务端通过 WS 广播 channel:codex-oauth-complete 通知客户端
 */
channel.post(`/${CHANNEL_IPC_CHANNELS.CODEX_OAUTH_LOGIN}`, async (c) => {
  try {
    // 等待授权 URL 就绪（最多 10 秒）
    const authUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('等待授权 URL 超时')), 10_000)
      loginCodexOAuth({
        onAuthUrl: (url) => {
          clearTimeout(timeout)
          resolve(url)
        },
      })
        .then((credentials) => {
          // 登录成功：WS 广播完成事件
          streamSink.emit('*', {
            success: true,
            credentials: serializeCodexCredentials(credentials),
            ...(credentials.accountId ? { accountId: credentials.accountId } : {}),
          } satisfies CodexOAuthLoginResult, 'channel:codex-oauth-complete')
        })
        .catch((error) => {
          // 登录失败：WS 广播错误事件
          streamSink.emit('*', {
            success: false,
            message: error instanceof Error ? error.message : String(error),
          } satisfies CodexOAuthLoginResult, 'channel:codex-oauth-complete')
        })
    })

    // 返回授权 URL，客户端在新窗口打开
    return c.json({ success: true, authUrl })
  } catch (error) {
    return c.json({
      success: false,
      message: error instanceof Error ? error.message : String(error),
    } satisfies CodexOAuthLoginResult)
  }
})

/** POST /api/channel:codex-oauth-cancel → { ok: true } */
channel.post(`/${CHANNEL_IPC_CHANNELS.CODEX_OAUTH_CANCEL}`, (c) => {
  cancelCodexOAuthLogin()
  return c.json({ ok: true })
})

export { channel }
