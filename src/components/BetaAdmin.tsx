'use client'

// Private beta administration for platform operators: invite a new firm, follow invitations, and
// revoke or restore a person's beta access. The page is only rendered for operators (404 otherwise).

import { useCallback, useEffect, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { Section, Field, Button, Alert, inputClass, postJson } from '@/components/ui'
import { fmtDay } from '@/lib/format'

interface Invite {
  id: string; email: string; company: string | null; createdByEmail: string | null; createdAt: string; expiresAt: string
  acceptedAt: string | null; revokedAt: string | null; acceptedOrgName?: string | null; status: 'pending' | 'accepted' | 'revoked' | 'expired'
}
interface BetaUser {
  id: string; email: string; name: string; role: string; orgName: string; createdAt: string
  betaAccessAt: string | null; betaRevokedAt: string | null; betaAccessVia: string | null; disabled: boolean; platformAdmin: boolean; hasAccess: boolean
}
interface Data { signup: { mode: string; accessRequestEmail: string | null }; emailDelivery: boolean; inviteDays: number; invites: Invite[]; users: BetaUser[] }

const STATUS: Record<Invite['status'], { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-accent-100 text-navy-950' },
  accepted: { label: 'Accepted', cls: 'bg-status-on-track-bg text-status-on-track' },
  revoked: { label: 'Revoked', cls: 'bg-warm-200 text-warm-700' },
  expired: { label: 'Expired', cls: 'bg-status-attention-bg text-status-attention' },
}
const VIA: Record<string, string> = {
  grandfathered: 'Before the beta', bootstrap: 'First account', org_invite: 'Org invitation', beta_invite: 'Beta invitation', platform_admin: 'Operator',
  sso: 'Single sign-on', saml: 'SAML sign-on', scim: 'SCIM', open_signup: 'Open sign-up', restored: 'Restored',
}

export function BetaAdmin() {
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string; section: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', company: '' })
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/platform/beta')
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setMsg({ tone: 'error', text: d.error || 'Could not load the beta.', section: 'top' }); return }
    setData(d)
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (section: string, body: Record<string, unknown>, success?: string) => {
    setBusy(section); setMsg(null)
    const r = await postJson('/api/platform/beta', body)
    setBusy(null)
    if (!r.ok) { setMsg({ tone: 'error', text: String(r.data.error || 'Something went wrong.'), section }); return null }
    if (success) setMsg({ tone: 'success', text: success, section })
    return r.data
  }
  const note = (section: string) => msg?.section === section ? <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null

  if (!data) return <div className="flex items-center justify-center py-24 text-warm-500">{note('top') || <Loader2 className="animate-spin" size={20} aria-label="Loading" />}</div>

  const q = filter.trim().toLowerCase()
  const users = q ? data.users.filter(u => `${u.email} ${u.name} ${u.orgName}`.toLowerCase().includes(q)) : data.users
  const withAccess = data.users.filter(u => u.hasAccess || u.platformAdmin).length

  return (
    <div className="px-4 md:px-6 py-6 max-w-5xl space-y-5">
      <div>
        <h1 className="font-display text-[26px] text-navy-950">Beta access</h1>
        <p className="text-[13.5px] text-warm-600">
          {data.signup.mode === 'invite_only'
            ? 'Planora is in private beta: sign-up needs an invitation, and signing in needs beta access.'
            : 'Self sign-up is open (PLANORA_SIGNUP=open), so the beta gate is off. Invitations still work.'}
          {' '}{withAccess} of {data.users.length} accounts can sign in. Only platform operators see this page.
        </p>
      </div>

      <Section title="Invite a firm" description={`Creates a single-use link for one email address, valid for ${data.inviteDays} days. Accepting it creates a new organization owned by that person. ${data.emailDelivery ? 'The link is emailed and shown here.' : 'Email delivery is not configured: copy the link and send it yourself.'}`}>
        {note('invite')}
        <form className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end" onSubmit={async e => {
          e.preventDefault()
          const d = await act('invite', { action: 'invite', ...form }, 'Invitation created.')
          if (d) { setLink({ url: String(d.link), emailed: !!d.emailed }); setForm({ email: '', company: '' }); load() }
        }}>
          <Field label="Email">{p => <input {...p} type="email" required className={inputClass} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="lead@firm.com" />}</Field>
          <Field label="Company (optional)">{p => <input {...p} className={inputClass} maxLength={160} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Firm name" />}</Field>
          <Button type="submit" disabled={busy === 'invite'}>Create invitation</Button>
        </form>
        {link && (
          <div className="mt-3">
            <div className="flex gap-2 items-center bg-warm-100 border border-warm-200 rounded-md p-2.5">
              <code className="flex-1 text-[12px] break-all text-navy-950" aria-label="Invitation link">{link.url}</code>
              <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(link.url)}><Copy size={13} className="inline mr-1" aria-hidden="true" />Copy</Button>
            </div>
            <p className="text-[12px] text-warm-600 mt-1.5">{link.emailed ? 'Also emailed to the invitee.' : 'Not emailed: send this link yourself.'} It is shown only once.</p>
          </div>
        )}
      </Section>

      <Section title={`Invitations (${data.invites.length})`}>
        {note('invites')}
        {data.invites.length === 0 ? <p className="text-[13px] text-warm-600">No beta invitations yet.</p> : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Beta invitations</caption>
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-500 border-b border-warm-200">
                <th scope="col" className="py-2 pr-3 font-semibold">Invitee</th><th scope="col" className="py-2 pr-3 font-semibold">Status</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Sent</th><th scope="col" className="py-2 pr-3 font-semibold">Expires / accepted</th>
                <th scope="col" className="py-2 font-semibold"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {data.invites.map(i => (
                  <tr key={i.id} className="border-b border-warm-200 last:border-0 align-top">
                    <td className="py-2 pr-3"><div className="text-navy-950 font-medium">{i.email}</div><div className="text-warm-600 text-[12px]">{i.acceptedOrgName || i.company || '—'}</div></td>
                    <td className="py-2 pr-3"><span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span></td>
                    <td className="py-2 pr-3 text-warm-700">{fmtDay(i.createdAt)}<div className="text-warm-600 text-[12px]">{i.createdByEmail}</div></td>
                    <td className="py-2 pr-3 text-warm-700">{i.acceptedAt ? `Accepted ${fmtDay(i.acceptedAt)}` : i.revokedAt ? `Revoked ${fmtDay(i.revokedAt)}` : fmtDay(i.expiresAt)}</td>
                    <td className="py-2 text-right">
                      {i.status === 'pending' && (
                        <Button variant="ghost" disabled={busy === 'invites'} aria-label={`Revoke the invitation for ${i.email}`}
                          onClick={async () => { if (await act('invites', { action: 'revoke_invite', id: i.id }, `Invitation for ${i.email} revoked.`)) load() }}>Revoke</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`People (${data.users.length})`} description="Everyone with a Planora account and whether they can sign in. Revoking beta access signs the person out everywhere; their organization keeps its data.">
        {note('users')}
        <div className="mb-3 max-w-sm">
          <Field label="Filter">{p => <input {...p} type="search" className={inputClass} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Email, name or organization" />}</Field>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Accounts and their beta access</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-500 border-b border-warm-200">
              <th scope="col" className="py-2 pr-3 font-semibold">Person</th><th scope="col" className="py-2 pr-3 font-semibold">Organization</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Beta access</th><th scope="col" className="py-2 font-semibold"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-warm-200 last:border-0 align-top">
                  <td className="py-2 pr-3"><div className="text-navy-950 font-medium">{u.name}</div><div className="text-warm-600 text-[12px]">{u.email}{u.disabled ? ' · removed from organization' : ''}</div></td>
                  <td className="py-2 pr-3 text-warm-700">{u.orgName}<div className="text-warm-600 text-[12px] capitalize">{u.role}</div></td>
                  <td className="py-2 pr-3 text-warm-700">
                    {u.platformAdmin ? 'Operator (always)' : u.hasAccess ? `Yes · ${VIA[u.betaAccessVia || ''] || 'Granted'}` : u.betaRevokedAt ? `Revoked ${fmtDay(u.betaRevokedAt)}` : 'No'}
                    {u.betaAccessAt && !u.platformAdmin && u.hasAccess && <div className="text-warm-600 text-[12px]">since {fmtDay(u.betaAccessAt)}</div>}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {!u.platformAdmin && (u.hasAccess ? (
                      <Button variant="ghost" disabled={busy === 'users'} aria-label={`Revoke beta access for ${u.email}`} onClick={async () => {
                        if (!window.confirm(`Revoke beta access for ${u.email}? They will be signed out everywhere.`)) return
                        if (await act('users', { action: 'revoke_access', userId: u.id }, `Beta access revoked for ${u.email}.`)) load()
                      }}>Revoke access</Button>
                    ) : (
                      <Button variant="ghost" disabled={busy === 'users'} aria-label={`Restore beta access for ${u.email}`}
                        onClick={async () => { if (await act('users', { action: 'restore_access', userId: u.id }, `Beta access restored for ${u.email}.`)) load() }}>Restore access</Button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
