/**
 * Proma Chat Widget 嵌入脚本（第三方站点用）
 *
 * 用法（在宿主页面 HTML 中）：
 *   <script src="https://your-proma-server/embed.js" defer></script>
 *
 * 工作原理：
 * 1. 从自身 <script src> 推导 Proma server 根地址
 * 2. 创建 fixed 定位、透明背景的 iframe 指向 {server}/widget.html
 * 3. 监听 iframe 内发出的 postMessage({ source: 'proma-widget', open: bool })
 *    按开合状态扩缩 iframe（关闭时仅按钮大小，打开时展开为面板大小）
 *
 * 安全：仅处理 source === 'proma-widget' 的消息，且在预期 iframe 范围内，
 *       不做跨域凭证交换（认证走 iframe 内同 origin 的 localStorage）。
 */
(function () {
  // 防止重复注入
  if (window.__PROMA_WIDGET_EMBEDDED__) return
  window.__PROMA_WIDGET_EMBEDDED__ = true

  // ===== 1. 推导 server 根地址 =====
  // 兼容：<script src="/embed.js">（同源部署）或 <script src="https://host/embed.js">
  var currentScript = document.currentScript
  var scriptSrc = currentScript && currentScript.src
  if (!scriptSrc) {
    console.error('[proma-embed] 无法定位 embed.js 的 <script src>，跳过注入')
    return
  }
  var serverBase = scriptSrc.replace(/\/embed\.js.*$/, '')

  // ===== 2. 尺寸配置 =====
  var CLOSED_SIZE = 76      // 关闭态：仅悬浮按钮（按钮 56 + 周边余量）
  var OPEN_WIDTH = 420      // 打开态宽度
  var OPEN_HEIGHT = 660     // 打开态高度（移动端会按视口约束收窄）

  // ===== 3. 创建 iframe =====
  var iframe = document.createElement('iframe')
  iframe.src = serverBase + '/widget.html'
  iframe.title = 'Proma 快速对话'
  iframe.setAttribute('aria-label', 'Proma 快速对话')
  iframe.style.cssText = [
    'position:fixed',
    'bottom:16px',
    'right:16px',
    'width:' + CLOSED_SIZE + 'px',
    'height:' + CLOSED_SIZE + 'px',
    'border:0',
    'background:transparent',
    'color-scheme:normal',
    'z-index:2147483000',
    'box-shadow:none',
    'transition:width .25s ease, height .25s ease',
  ].join(';')
  iframe.allow = 'clipboard-write'
  document.body.appendChild(iframe)

  // ===== 4. 监听 iframe 开合消息，扩缩容器 =====
  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.source !== 'proma-widget') return

    if (data.open) {
      // 移动端按视口宽度收窄，避免横向溢出
      var maxW = Math.min(OPEN_WIDTH, window.innerWidth - 32)
      var maxH = Math.min(OPEN_HEIGHT, window.innerHeight - 32)
      iframe.style.width = maxW + 'px'
      iframe.style.height = maxH + 'px'
    } else {
      iframe.style.width = CLOSED_SIZE + 'px'
      iframe.style.height = CLOSED_SIZE + 'px'
    }
  })
})()
