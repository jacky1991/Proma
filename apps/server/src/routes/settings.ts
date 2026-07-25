/**
 * Settings / UserProfile 域 HTTP 路由
 */

import { Hono } from 'hono'
import { getSettings, updateSettings } from '@proma/server-core/settings-service'
import { getUserProfile, updateUserProfile } from '@proma/server-core/user-profile-service'

const settings = new Hono()

/** POST /api/settings:get → AppSettings */
settings.post('/settings:get', (c) => {
  return c.json(getSettings())
})

/** POST /api/settings:update → AppSettings */
settings.post('/settings:update', async (c) => {
  const updates = await c.req.json()
  const updated = updateSettings(updates)
  return c.json(updated)
})

/** POST /api/user-profile:get → UserProfile */
settings.post('/user-profile:get', (c) => {
  return c.json(getUserProfile())
})

/** POST /api/user-profile:update → UserProfile */
settings.post('/user-profile:update', async (c) => {
  const updates = await c.req.json()
  const updated = updateUserProfile(updates)
  return c.json(updated)
})

export { settings }
