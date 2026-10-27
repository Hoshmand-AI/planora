'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Robot } from '@/components/Robot'

/** Target of the emailed "Reset your RunF9 password" link: /auth/reset?token=… */
function ResetForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(token ? '' : 'This reset link is incomplete. Open the link from the email again, or request a new one.')
  const [errorCode, setErrorCode] = useState(token ? '' : 'reset_invalid')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setErrorCode('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset_password', token, password }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Something went wrong.'); setErrorCode(data.code || ''); return }
      setPassword('')
      setDone(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const linkDead = errorCode === 'reset_invalid'
  const mood = done ? 'done' : linkDead ? 'worried' : 'waiting'

  return (
    <div className="min-h-screen bg-warm-50 flex flex-col">
      <nav className="bg-navy-900 h-14 flex items-center px-6">
        <Link href="/">
          <Logo variant="light" size="text-[18px]" />
        </Link>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <Link href="/auth" className="inline-flex items-center gap-1.5 text-warm-400 text-[13px] font-medium hover:text-warm-700 transition-colors mb-8">
            <ArrowLeft size={14} /> Back to sign in
          </Link>

          <div className="mood-tile grain flex w-fit items-center border rounded-[24px] px-4 pt-3 pb-2 mb-5" data-mood={mood}>
            <Robot mood={mood} size={64} />
          </div>
          <h1 className="font-display text-[32px] text-navy-950 mb-2">{done ? 'Password reset' : linkDead ? 'This link can’t be used' : 'Choose a new password'}</h1>
          <p className="text-warm-500 text-[15px] mb-8">
            {done
              ? 'You’ve been signed out on every device. Sign in with your new password.'
              : linkDead
                ? 'Reset links work once and expire after 30 minutes.'
                : 'Pick a password you don’t use anywhere else. Resetting it signs you out on every device.'}
          </p>

          <div role="status" aria-live="polite">
            {done && (
              <div className="bg-status-on-track-bg border-l-2 border-status-on-track text-warm-700 text-[13.5px] px-4 py-3 rounded-md mb-5">
                Your password has been reset.
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="bg-status-at-risk-bg border border-status-at-risk/20 text-status-at-risk text-[13.5px] px-4 py-3 rounded-md mb-5 border-l-2 border-l-status-at-risk">
              {error}
              {linkDead && <> <Link href="/auth?forgot=1" className="font-semibold underline">Request a new link</Link></>}
            </div>
          )}

          {done ? (
            <Link href="/auth" className="block w-full text-center bg-accent-500 text-navy-950 py-3 rounded-md text-[15px] font-semibold hover:bg-accent-400 transition-colors">
              Sign in
            </Link>
          ) : token && !linkDead ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">New password</label>
                <div className="relative">
                  <input
                    id="new-password" autoComplete="new-password" aria-describedby="password-hint" autoFocus
                    type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128}
                    placeholder="At least 12 characters"
                    className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400 pr-10"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-warm-400 hover:text-warm-600">
                    {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
                <p id="password-hint" className="text-[11.5px] text-warm-400 mt-1.5">At least 12 characters. A short phrase of a few unrelated words is strong and easy to remember.</p>
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-accent-500 text-navy-950 py-3 rounded-md text-[15px] font-semibold hover:bg-accent-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Please wait…' : 'Reset password'}
              </button>
            </form>
          ) : null}
        </div>
      </main>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-warm-50 flex items-center justify-center text-warm-400">Loading...</div>}>
      <ResetForm />
    </Suspense>
  )
}
