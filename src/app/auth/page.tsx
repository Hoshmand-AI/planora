'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'

function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>(searchParams.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode === 'signin' ? 'signin' : 'signup',
          email, password,
          name: mode === 'signup' ? name : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return }
      router.push('/dashboard')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-warm-50 flex flex-col">
      <nav className="bg-navy-900 h-14 flex items-center px-6">
        <Link href="/">
          <Logo variant="light" size="text-[18px]" />
        </Link>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="inline-flex items-center gap-1.5 text-warm-400 text-[13px] font-medium hover:text-warm-700 transition-colors mb-8">
            <ArrowLeft size={14} /> Back to home
          </Link>

          <h1 className="font-display text-[32px] text-navy-950 mb-2">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="text-warm-500 text-[15px] mb-8">
            {mode === 'signin'
              ? 'Sign in to access your schedule analysis.'
              : 'Start analyzing construction schedules with Planora.'}
          </p>

          {error && (
            <div className="bg-status-at-risk-bg border border-status-at-risk/20 text-status-at-risk text-[13.5px] px-4 py-3 rounded-md mb-5 border-l-2 border-l-status-at-risk">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Name</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder="Your name"
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400"
                />
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@company.com"
                className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                  placeholder={mode === 'signup' ? 'Min 6 characters' : 'Your password'}
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400 pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600">
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-gold-500 text-navy-950 py-3 rounded-md text-[15px] font-semibold hover:bg-gold-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-[13.5px] text-warm-500 mt-6">
            {mode === 'signin' ? (
              <>Don&apos;t have an account? <button onClick={() => { setMode('signup'); setError('') }} className="text-gold-600 font-medium hover:underline">Sign up</button></>
            ) : (
              <>Already have an account? <button onClick={() => { setMode('signin'); setError('') }} className="text-gold-600 font-medium hover:underline">Sign in</button></>
            )}
          </p>

          <p className="text-center text-[12px] text-warm-400 mt-8">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="underline hover:text-warm-600">Terms</Link> and{' '}
            <Link href="/privacy" className="underline hover:text-warm-600">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-warm-50 flex items-center justify-center text-warm-400">Loading...</div>}>
      <AuthForm />
    </Suspense>
  )
}
