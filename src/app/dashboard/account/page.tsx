'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck, Monitor, Download, Copy } from 'lucide-react'
import { Section, Field, Button, Alert, inputClass, postJson, downloadJson } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

interface AccountData {
  user: { id: string; email: string; name: string; role: string; createdAt: string }
  org: { id: string; name: string }
  mfa: { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean }
  sessions: { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; current: boolean }[]
  sessionIdleHours: number
}

function device(ua: string | null) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|undici/i.test(ua) ? 'API client' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3 border border-warm-300 rounded-md p-4 bg-warm-100">
      <p className="text-[13px] text-warm-700 font-medium mb-2">Save these recovery codes now. Each works once if you lose your phone. They won&apos;t be shown again.</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[14px] text-navy-950 mb-3" aria-label="Recovery codes">
        {codes.map(c => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); setCopied(true) }}><Copy size={13} className="inline mr-1" aria-hidden="true" />{copied ? 'Copied' : 'Copy'}</Button>
        <Button variant="secondary" onClick={() => {
          const url = URL.createObjectURL(new Blob([`Planora recovery codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' }))
          const a = document.createElement('a'); a.href = url; a.download = 'planora-recovery-codes.txt'; a.click()
        }}><Download size={13} className="inline mr-1" aria-hidden="true" />Download</Button>
      </div>
    </div>
  )
}

function AccountPage() {
  const router = useRouter()
  const params = useSearchParams()
  const [data, setData] = useState<AccountData | null>(null)
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string; section: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [pw, setPw] = useState({ current: '', next: '', code: '' })
  const [enroll, setEnroll] = useState<{ secret: string; uri: string; qrSvg: string } | null>(null)
  const [enrollCode, setEnrollCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [reauth, setReauth] = useState({ password: '', code: '' })
  const [del, setDel] = useState({ password: '', code: '', confirm: '' })

  const load = useCallback(async () => {
    const res = await fetch('/api/account')
    if (res.status === 401) { router.push('/auth'); return }
    const d = await res.json()
    setData(d); setName(d.user?.name ?? '')
  }, [router])
  useEffect(() => { load() }, [load])

  const act = async (section: string, body: Record<string, unknown>, success?: string) => {
    setBusy(section); setMsg(null)
    const r = await postJson('/api/account', body)
    setBusy(null)
    if (!r.ok) { setMsg({ tone: 'error', text: String(r.data.error || 'Something went wrong.'), section }); return null }
    if (success) setMsg({ tone: 'success', text: success, section })
    return r.data
  }
  const note = (section: string) => msg?.section === section ? <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null

  if (!data) return <div className="flex items-center justify-center py-24 text-warm-400"><Loader2 className="animate-spin" size={20} aria-label="Loading" /></div>

  const mfaNeeded = data.mfa.required && !data.mfa.enabled

  return (
    <div className="px-4 md:px-6 py-6 max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-[26px] text-navy-950">Account &amp; security</h1>
        <p className="text-[13.5px] text-warm-500">{data.user.email} · {data.org.name} · <span className="capitalize">{data.user.role}</span></p>
      </div>

      {(mfaNeeded || params.get('setup') === 'mfa') && !data.mfa.enabled && (
        <Alert tone="warning">Your organization requires two-step verification. Set it up below to continue using Planora.</Alert>
      )}

      <Section title="Two-step verification" description="A code from an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, Authy…) is required after your password. This protects your firm's projects even if your password leaks." id="mfa">
        {note('mfa')}
        {data.mfa.enabled ? (
          <div className="space-y-3">
            <p className="text-[13.5px] text-warm-700 flex items-center gap-1.5"><ShieldCheck size={16} className="text-status-on-track" aria-hidden="true" /> On since {fmtDateTime(data.mfa.enabledAt!)} · {data.mfa.recoveryCodesLeft} recovery codes left</p>
            {codes && <RecoveryCodes codes={codes} />}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Password">{p => <input {...p} type="password" autoComplete="current-password" className={inputClass} value={reauth.password} onChange={e => setReauth({ ...reauth, password: e.target.value })} />}</Field>
              <Field label="Current code">{p => <input {...p} inputMode="numeric" autoComplete="one-time-code" className={inputClass} value={reauth.code} onChange={e => setReauth({ ...reauth, code: e.target.value })} />}</Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy === 'mfa'} onClick={async () => {
                const d = await act('mfa', { action: 'mfa_recovery_codes', currentPassword: reauth.password, code: reauth.code }, 'New recovery codes created. The old ones no longer work.')
                if (d) { setCodes(d.recoveryCodes as string[]); setReauth({ password: '', code: '' }); load() }
              }}>New recovery codes</Button>
              {!data.mfa.required && (
                <Button variant="secondary" disabled={busy === 'mfa'} onClick={async () => {
                  const d = await act('mfa', { action: 'mfa_disable', currentPassword: reauth.password, code: reauth.code }, 'Two-step verification is off.')
                  if (d) { setReauth({ password: '', code: '' }); load() }
                }}>Turn off</Button>
              )}
            </div>
          </div>
        ) : enroll ? (
          <div className="space-y-3">
            <ol className="list-decimal pl-5 text-[13.5px] text-warm-700 space-y-1">
              <li>Open your authenticator app and add an account.</li>
              <li>Scan this QR code, or enter the key by hand.</li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="w-44 h-44 bg-white border border-warm-200 rounded-md p-2" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: enroll.qrSvg }} />
              <div className="space-y-2 flex-1 min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500">Setup key</div>
                <code className="block break-all font-mono text-[14px] text-navy-950 bg-warm-100 border border-warm-200 rounded px-2 py-1">{enroll.secret.match(/.{1,4}/g)?.join(' ')}</code>
                <Field label="Code from the app">{p => <input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${inputClass} font-mono tracking-[0.2em] max-w-[160px]`} value={enrollCode} onChange={e => setEnrollCode(e.target.value)} />}</Field>
                <div className="flex gap-2">
                  <Button disabled={busy === 'mfa' || enrollCode.trim().length < 6} onClick={async () => {
                    const d = await act('mfa', { action: 'mfa_confirm', code: enrollCode }, 'Two-step verification is on. Your other sessions were signed out.')
                    if (d) { setCodes(d.recoveryCodes as string[]); setEnroll(null); setEnrollCode(''); await load(); if (mfaNeeded) router.refresh() }
                  }}>Turn on</Button>
                  <Button variant="secondary" onClick={() => setEnroll(null)}>Cancel</Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {codes && <RecoveryCodes codes={codes} />}
            <Button disabled={busy === 'mfa'} onClick={async () => { const d = await act('mfa', { action: 'mfa_begin' }); if (d) setEnroll(d as never) }}>Set up two-step verification</Button>
          </div>
        )}
        {codes && data.mfa.enabled && mfaNeeded === false && params.get('setup') === 'mfa' && (
          <div className="mt-3"><Button onClick={() => { window.location.href = '/dashboard/plan' }}>Continue to Planora</Button></div>
        )}
      </Section>

      <Section title="Profile">
        {note('profile')}
        <div className="flex gap-2 items-end">
          <div className="flex-1"><Field label="Name">{p => <input {...p} autoComplete="name" className={inputClass} value={name} onChange={e => setName(e.target.value)} />}</Field></div>
          <Button variant="secondary" disabled={busy === 'profile' || name === data.user.name} onClick={async () => { if (await act('profile', { action: 'update_profile', name }, 'Saved.')) load() }}>Save</Button>
        </div>
      </Section>

      <Section title="Password" description="Changing your password signs you out on every other device.">
        {note('password')}
        <form className="grid sm:grid-cols-2 gap-3" onSubmit={async e => {
          e.preventDefault()
          const d = await act('password', { action: 'change_password', currentPassword: pw.current, newPassword: pw.next, code: pw.code }, 'Password changed.')
          if (d) { setPw({ current: '', next: '', code: '' }); load() }
        }}>
          <Field label="Current password">{p => <input {...p} type="password" required autoComplete="current-password" className={inputClass} value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />}</Field>
          <Field label="New password" hint="At least 12 characters; a phrase of a few unrelated words works well.">{p => <input {...p} type="password" required minLength={12} autoComplete="new-password" className={inputClass} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />}</Field>
          {data.mfa.enabled && <Field label="Authenticator code">{p => <input {...p} inputMode="numeric" autoComplete="one-time-code" className={inputClass} value={pw.code} onChange={e => setPw({ ...pw, code: e.target.value })} />}</Field>}
          <div className="sm:col-span-2"><Button type="submit" disabled={busy === 'password'}>Change password</Button></div>
        </form>
      </Section>

      <Section title="Where you're signed in" description={`Sessions end after ${data.sessionIdleHours} hours without activity, or after 7 days.`}>
        {note('sessions')}
        <ul className="divide-y divide-warm-200 border border-warm-200 rounded-md mb-3">
          {data.sessions.map(s => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Monitor size={16} className="text-warm-400 flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[13.5px] text-navy-950 font-medium">{device(s.userAgent)}{s.current && <span className="ml-2 text-[11px] font-semibold text-status-on-track">This device</span>}</div>
                  <div className="text-[12px] text-warm-500 truncate">{s.ip || 'unknown IP'} · signed in {fmtDateTime(s.createdAt)} · last active {fmtDateTime(s.lastSeenAt)}</div>
                </div>
              </div>
              {!s.current && <Button variant="ghost" onClick={async () => { if (await act('sessions', { action: 'revoke_session', sessionId: s.id }, 'Signed out that device.')) load() }}>Sign out</Button>}
            </li>
          ))}
        </ul>
        {data.sessions.length > 1 && <Button variant="secondary" onClick={async () => { if (await act('sessions', { action: 'revoke_other_sessions' }, 'Signed out everywhere else.')) load() }}>Sign out everywhere else</Button>}
      </Section>

      <Section title="Your personal data" description="Download what Planora holds about you as a person: your account, sign-ins, activity in the audit log and your Ask AI history. Project data belongs to your organization (an admin can export it).">
        {note('export')}
        <Button variant="secondary" disabled={busy === 'export'} onClick={async () => {
          const d = await act('export', { action: 'export_my_data' }, 'Downloaded.')
          if (d) downloadJson(`planora-my-data-${new Date().toISOString().slice(0, 10)}.json`, d)
        }}><Download size={13} className="inline mr-1" aria-hidden="true" />Download my data</Button>
      </Section>

      <Section title="Delete account" tone="danger" description="Permanently deletes your account, sessions and Ask AI history. Your projects stay with your organization and are reassigned to its owner. If you're the last member, the whole organization and all its data are deleted.">
        {note('delete')}
        <form className="grid sm:grid-cols-2 gap-3" onSubmit={async e => {
          e.preventDefault()
          if (!confirm('Delete your account permanently? This cannot be undone.')) return
          const d = await act('delete', { action: 'delete_account', currentPassword: del.password, code: del.code, confirm: del.confirm })
          if (d) window.location.href = '/'
        }}>
          <Field label={`Type ${data.user.email} to confirm`}>{p => <input {...p} required className={inputClass} value={del.confirm} onChange={e => setDel({ ...del, confirm: e.target.value })} />}</Field>
          <Field label="Password">{p => <input {...p} type="password" required autoComplete="current-password" className={inputClass} value={del.password} onChange={e => setDel({ ...del, password: e.target.value })} />}</Field>
          {data.mfa.enabled && <Field label="Authenticator code">{p => <input {...p} inputMode="numeric" className={inputClass} value={del.code} onChange={e => setDel({ ...del, code: e.target.value })} />}</Field>}
          <div className="sm:col-span-2"><Button type="submit" variant="danger" disabled={busy === 'delete' || del.confirm !== data.user.email}>Delete my account</Button></div>
        </form>
      </Section>
    </div>
  )
}

export default function Page() {
  return <Suspense fallback={null}><AccountPage /></Suspense>
}
