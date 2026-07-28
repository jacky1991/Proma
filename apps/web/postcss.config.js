/**
 * Web 端 PostCSS 配置（自包含）
 *
 * M4 迭代 11 步骤 3：不再 re-export apps/electron/postcss.config.js，内联与其一致的
 * tailwind + autoprefixer 插件配置，使 Web 构建脱离 apps/electron 目录（AC-5）。
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
