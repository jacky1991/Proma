/**
 * Storage 管理域 HTTP 路由
 *
 * 提供磁盘用量统计、孤儿数据清理和临时文件清理。
 */

import { Hono } from 'hono'
import {
  calculateStorageStats,
  cleanupStorage,
  cleanupTempFiles,
  type CleanupOptions,
} from '@proma/server-core/storage-service'

const storage = new Hono()

/** POST /api/storage:get-stats → StorageStats */
storage.post('/storage:get-stats', async (c) => {
  const stats = await calculateStorageStats()
  return c.json(stats)
})

/** POST /api/storage:cleanup → CleanupResult */
storage.post('/storage:cleanup', async (c) => {
  const options = await c.req.json<CleanupOptions>()
  const result = await cleanupStorage(options)
  return c.json(result)
})

/** POST /api/storage:cleanup-temp → CleanupResult */
storage.post('/storage:cleanup-temp', async (c) => {
  const result = await cleanupTempFiles()
  return c.json(result)
})

export { storage }
