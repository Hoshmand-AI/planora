'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowLeft, ShieldCheck } from 'lucide-react'
import { Logo } from '@/components/Logo'

function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>(searchParams.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const invite = searchParams.get('invite')
  const betaToken = searchParams.get('beta')
  const [cuiWarning, setCuiWarning] = useState('')
  const [invitation, setInvitation] = useState<{ email?: string; role?: string; orgName?: string; invalid?: boolean } | null>(null)
  const [betaInvitation, setBetaInvitation] = useState<{ email?: string; company?: string | null; invalid?: boolean } | null>(null)
  // Private beta: invite-only unless the instance re-opened self sign-up (PLANORA_SIGNUP=open).
  const [inviteOnly, setInviteOnly] = useState(false)
  const [requestEmail, setRequestEmail] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState('')
  // Second step when two-step verification is on
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [ssoMode, setSsoMode] = useState(false)
  useEffect(() => { const e = searchParams.get('sso_error'); if (e) { setError(e); setSsoMode(true) } }, [searchParams])
  useEffect(() => { if (searchParams.get('verified') === '0') setError('That confirmation link is invalid or has expired. Sign in and resend it from Account → Profile.') }, [searchParams])

  const handleSso = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const r = await fetch('/api/auth/sso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const ok = r.ok, data = await r.json().catch(() => ({}))
      if (!ok) { setError(data.error || 'Single sign-on is not available.'); return }
      window.location.href = data.url
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const qs = invite ? `?invite=${encodeURIComponent(invite)}` : betaToken ? `?beta=${encodeURIComponent(betaToken)}` : ''
    fetch(`/api/auth${qs}`).then(r => r.json()).then(d => {
      if (typeof d.service?.cuiWarning === 'string') setCuiWarning(d.service.cuiWarning)
      setInviteOnly(d.signup?.mode === 'invite_only')
      setRequestEmail(typeof d.signup?.accessRequestEmail === 'string' ? d.signup.accessRequestEmail : null)
      if (invite) {
        setInvitation(d.invitation ?? { invalid: true })
        if (d.invitation?.email) { setEmail(d.invitation.email); setMode('signup') }
      } else if (betaToken) {
        setBetaInvitation(d.betaInvitation ?? { invalid: true })
        if (d.betaInvitation?.email) { setEmail(d.betaInvitation.email); setCompany(d.betaInvitation.company || ''); setMode('signup') }
      }
    }).catch(() => {})
  }, [invite, betaToken])

  const requestHref = requestEmail ? `mailto:${requestEmail}?subject=${encodeURIComponent('Planora private beta: access request')}` : null
  const betaInvited = !!betaInvitation?.email

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { ok: res.ok, data: await res.json().catch(() => ({})) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setErrorCode('')
    setLoading(true)
    try {
      const { ok, data } = await post({
        action: mode === 'signin' ? 'signin' : 'signup',
        email, password,
        name: mode === 'signup' ? name : undefined,
        company: mode === 'signup' && !invitation?.orgName ? company : undefined,
        invite: mode === 'signup' && invite ? invite : undefined,
        betaInvite: mode === 'signup' && !invite && betaToken ? betaToken : undefined,
      })
      if (!ok) { setError(data.error || 'Something went wrong.'); setErrorCode(data.code || ''); if (data.code === 'sso_required') setSsoMode(true); return }
      if (data.mfaRequired) { setChallenge(data.challenge); setCode(''); return }
      router.push('/dashboard')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { ok, data } = await post({ action: 'mfa', challenge, code })
      if (!ok) {
        setErrorCode(data.code || '')
        if (data.code === 'mfa_expired') { setChallenge(null); setPassword('') }
        setError(data.error || 'Something went wrong.')
        return
      }
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
            {challenge ? 'Two-step verification' : mode === 'signin' ? 'Welcome back' : invitation?.orgName ? `Join ${invitation.orgName}` : betaInvited ? 'Welcome to the Planora beta' : 'Create your account'}
          </h1>
          <p className="text-warm-500 text-[15px] mb-8">
            {challenge
              ? 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.'
              : mode === 'signin'
                ? 'Sign in to access your schedule analysis.'
                : invitation?.orgName
                  ? `You've been invited as ${invitation.role === 'admin' ? 'an' : 'a'} ${invitation.role}. Create your account with ${invitation.email}.`
                  : betaInvited
                    ? `You're invited to the private beta. Create your firm's account with ${betaInvitation?.email}; you'll be its owner and can invite colleagues.`
                    : 'Start analyzing construction schedules with Planora.'}
          </p>

          {inviteOnly && !challenge && !ssoMode && !invitation?.orgName && !betaInvited && (
            <div role="note" aria-label="Private beta" className="bg-warm-100 border border-warm-200 border-l-2 border-l-accent-500 text-warm-700 text-[13.5px] px-4 py-3 rounded-md mb-5">
              <strong className="font-semibold text-navy-950">Planora is in private beta</strong> — sign up with your invitation link.
              {mode === 'signup' && ' No link yet? Ask your organization admin to invite you.'}
              {requestHref && <> <a href={requestHref} className="text-accent-600 font-medium underline hover:text-navy-950">Request access</a></>}
            </div>
          )}

          {cuiWarning && mode === 'signup' && !challenge && (
            <div role="note" aria-label="Controlled information warning" className="bg-status-attention-bg border-l-2 border-status-attention text-warm-700 text-[13.5px] px-4 py-3 rounded-md mb-5">
              <strong className="font-semibold text-navy-950">No CUI or classified information.</strong> {cuiWarning}
            </div>
          )}

          {invitation?.invalid && !challenge && (
            <div role="alert" className="bg-status-attention-bg border-l-2 border-status-attention text-warm-700 text-[13.5px] px-4 py-3 rounded-md mb-5">
              This invitation link has expired or was already used. Ask your admin for a new one.
            </div>
          )}

          {betaInvitation?.invalid && !challenge && (
            <div role="alert" className="bg-status-attention-bg border-l-2 border-status-attention text-warm-700 text-[13.5px] px-4 py-3 rounded-md mb-5">
              This beta invitation link has expired, was revoked or was already used. Ask for a new one.
              {requestHref && <> <a href={requestHref} className="text-navy-950 font-medium underline">Request access</a></>}
            </div>
          )}

          {error && (
            <div role="alert" className="bg-status-at-risk-bg border border-status-at-risk/20 text-status-at-risk text-[13.5px] px-4 py-3 rounded-md mb-5 border-l-2 border-l-status-at-risk">
              {error}
              {requestHref && (errorCode === 'invite_only' || errorCode === 'beta_access_required') && (
                <> <a href={requestHref} className="font-semibold underline">Request access</a></>
              )}
            </div>
          )}

          {ssoMode && !challenge ? (
            <form onSubmit={handleSso} className="space-y-4">
              <div>
                <label htmlFor="sso-email" className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Work email</label>
                <input id="sso-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-accent-500 text-navy-950 py-3 rounded-md text-[15px] font-semibold hover:bg-accent-400 transition-colors disabled:opacity-50">
                {loading ? 'Redirecting…' : 'Continue with single sign-on'}
              </button>
              <button type="button" onClick={() => { setSsoMode(false); setError('') }} className="w-full text-[13px] text-warm-500 hover:text-warm-700">Use email and password instead</button>
            </form>
          ) : challenge ? (
            <form onSubmit={handleCode} className="space-y-4">
              <div>
                <label htmlFor="mfa-code" className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Verification code</label>
                <input
                  id="mfa-code" value={code} onChange={e => setCode(e.target.value)} required autoFocus
                  inputMode="text" autoComplete="one-time-code" placeholder="123456" maxLength={20}
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[18px] tracking-[0.2em] text-warm-700 placeholder:text-warm-400 font-mono"
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-accent-500 text-navy-950 py-3 rounded-md text-[15px] font-semibold hover:bg-accent-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <ShieldCheck size={16} aria-hidden="true" /> {loading ? 'Checking…' : 'Verify and sign in'}
              </button>
              <button type="button" onClick={() => { setChallenge(null); setError(''); setPassword('') }} className="w-full text-[13px] text-warm-500 hover:text-warm-700">
                Use a different account
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="name" className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Name</label>
                <input
                  id="name" autoComplete="name" type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder="Your name"
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400"
                />
              </div>
            )}
            {mode === 'signup' && !invitation?.orgName && (
              <div>
                <label htmlFor="company" className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Firm</label>
                <input
                  id="company" type="text" value={company} onChange={e => setCompany(e.target.value)}
                  placeholder="Your company (private workspace)"
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400"
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Email</label>
              <input
                id="email" autoComplete="email" readOnly={(!!invitation?.email || betaInvited) && mode === 'signup'}
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@company.com"
                className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  id="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} aria-describedby={mode === 'signup' ? 'password-hint' : undefined}
                  type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'signup' ? 12 : 1}
                  placeholder={mode === 'signup' ? 'At least 12 characters' : 'Your password'}
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400 pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-warm-400 hover:text-warm-600">
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>
              {mode === 'signup' && <p id="password-hint" className="text-[11.5px] text-warm-400 mt-1.5">At least 12 characters. A short phrase of a few unrelated words is strong and easy to remember.</p>}
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-accent-500 text-navy-950 py-3 rounded-md text-[15px] font-semibold hover:bg-accent-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : invitation?.orgName ? 'Join organization' : betaInvited ? 'Create firm account' : 'Create Account'}
            </button>
          </form>
          )}

          {!challenge && !ssoMode && mode === 'signin' && (
            <button type="button" onClick={() => { setSsoMode(true); setError('') }} className="w-full mt-3 border border-warm-300 text-navy-950 py-2.5 rounded-md text-[14px] font-medium hover:bg-warm-100 transition-colors">
              Sign in with SSO
            </button>
          )}
          {!challenge && !ssoMode && (
          <p className="text-center text-[13.5px] text-warm-500 mt-6">
            {mode === 'signin' && inviteOnly ? (
              <>Have an invitation? <button onClick={() => { setMode('signup'); setError('') }} className="text-accent-600 font-medium hover:underline">Sign up</button>
                {requestHref && <> · <a href={requestHref} className="text-accent-600 font-medium hover:underline">Request access</a></>}</>
            ) : mode === 'signin' ? (
              <>Don&apos;t have an account? <button onClick={() => { setMode('signup'); setError('') }} className="text-accent-600 font-medium hover:underline">Sign up</button></>
            ) : (
              <>Already have an account? <button onClick={() => { setMode('signin'); setError('') }} className="text-accent-600 font-medium hover:underline">Sign in</button></>
            )}
          </p>
          )}

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
