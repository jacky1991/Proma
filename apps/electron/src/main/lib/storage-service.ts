/**
 * 存储管理服务（Electron 端）
 *
 * 真源在 @proma/server-core/storage-service；此处 re-export 保持导入路径不变。
 * 注：server-core 版本使用 os.tmpdir() 替代 app.getPath('temp')，行为等价。
 */
export * from '@proma/server-core/storage-service'
