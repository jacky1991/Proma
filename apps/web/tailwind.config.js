// 复用 electron 的 Tailwind 配置，仅覆盖 content 路径指向共享 renderer 源码
import base from '../electron/tailwind.config.js'

/** @type {import('tailwindcss').Config} */
export default {
  ...base,
  content: ['../electron/src/renderer/**/*.{js,ts,jsx,tsx}'],
}
