/**
 * 数据迁移模块导出入口
 */

export { needsMigration, migrateToMultiUser } from './migrate-to-multi-user.ts'
export type { MigrationResult } from './migrate-to-multi-user.ts'

export { needsSdkConfigMigration, migrateSdkConfigToUsers } from './migrate-sdk-config-to-users.ts'
export type { SdkConfigMigrationResult } from './migrate-sdk-config-to-users.ts'
