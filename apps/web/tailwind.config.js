// 复用 electron 的 Tailwind 配置，content 路径包含共享 renderer 源码和 web 端自有页面
import base from '../electron/tailwind.config.js'

/** @type {import('tailwindcss').Config} */
export default {
  ...base,
  content: [
    '../electron/src/renderer/**/*.{js,ts,jsx,tsx}',
    // web 端自有页面（LoginPage 等）也需扫描，否则其 Tailwind 类不会被生成
    './src/**/*.{js,ts,jsx,tsx}',
  ],
}
