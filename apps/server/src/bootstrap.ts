/**
 * 服务端启动引导（必须最先导入）
 *
 * 在任何业务模块加载前设置 Web 独立数据根，
 * 确保 config-paths 的 getDataRoot() 返回 ~/.proma-web/ 而非 ~/.proma/。
 *
 * 用法：index.ts 第一行 import './bootstrap'
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { setDataRoot } from '@proma/server-core/config-paths'

const dataRoot = process.env.PROMA_DATA_ROOT || join(homedir(), '.proma-web')
setDataRoot(dataRoot)
