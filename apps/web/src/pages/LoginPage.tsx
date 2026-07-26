/**
 * 登录 / 注册页面
 *
 * 独立于 renderer React 树渲染（不依赖 Jotai store），
 * 由 shim-entry.ts 在未登录时挂载到全屏遮罩层。
 *
 * 接口：
 *   登录  POST /api/auth:login    { username, password } → { accessToken, refreshToken }
 *   注册  POST /api/auth:register { username, password } → { accessToken, refreshToken }
 */

import { useState } from 'react'
import type { AuthUser } from '@proma/shared'
import { setTokens, setStoredUser } from '../shim/auth-store.ts'

/** 认证接口响应格式 */
interface AuthResponse {
  user: AuthUser
  accessToken: string
  refreshToken: string
}

/** 登录 / 注册模式 */
type AuthMode = 'login' | 'register'

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }

    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/api/auth:login' : '/api/auth:register'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(
          body?.error ?? (mode === 'login' ? '登录失败，请检查用户名和密码' : '注册失败，请重试'),
        )
      }

      const data = (await res.json()) as AuthResponse
      // 写入 token 与当前用户（含角色），并跳转主页（整页刷新，重新初始化 shim 和 WS 连接）
      setTokens(data.accessToken, data.refreshToken)
      setStoredUser(data.user)
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'))
    setError(null)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-950 via-slate-900 to-indigo-950 px-4">
      <div className="w-full max-w-sm p-8 rounded-2xl bg-slate-800/80 backdrop-blur-sm shadow-2xl shadow-violet-950/50 border border-slate-700/50">
        {/* Logo & 名称 */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-700/40">
            <span className="text-white text-xl font-bold select-none">P</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Proma</h1>
          <p className="text-slate-400 text-sm mt-1">
            {mode === 'login' ? '登录您的账号' : '创建新账号'}
          </p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div
            role="alert"
            className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
          >
            {error}
          </div>
        )}

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="proma-username" className="block text-sm font-medium text-slate-300 mb-1.5">
              用户名
            </label>
            <input
              id="proma-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
              className="w-full px-4 py-2.5 rounded-lg bg-slate-900/70 border border-slate-600/60 text-white placeholder-slate-500 text-sm
                         focus:outline-none focus:ring-2 focus:ring-violet-500/60 focus:border-transparent transition"
            />
          </div>

          <div>
            <label htmlFor="proma-password" className="block text-sm font-medium text-slate-300 mb-1.5">
              密码
            </label>
            <input
              id="proma-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-900/70 border border-slate-600/60 text-white placeholder-slate-500 text-sm
                         focus:outline-none focus:ring-2 focus:ring-violet-500/60 focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg font-medium text-white text-sm
                       bg-gradient-to-r from-violet-600 to-indigo-600
                       hover:from-violet-500 hover:to-indigo-500
                       focus:outline-none focus:ring-2 focus:ring-violet-500/60
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition shadow-lg shadow-violet-800/30"
          >
            {loading
              ? mode === 'login'
                ? '登录中…'
                : '注册中…'
              : mode === 'login'
                ? '登录'
                : '注册'}
          </button>
        </form>

        {/* 切换登录 / 注册 */}
        <p className="mt-6 text-center text-sm text-slate-400">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            type="button"
            onClick={switchMode}
            className="ml-1 text-violet-400 hover:text-violet-300 font-medium focus:outline-none transition"
          >
            {mode === 'login' ? '立即注册' : '返回登录'}
          </button>
        </p>
      </div>
    </div>
  )
}
