'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, ShieldAlert, Copy, Download, Lock, CheckCircle2, XCircle } from 'lucide-react'
import { Section, Field, Button, Alert, inputClass, postJson } from '@/components/ui'
import { Integrations } from '@/components/Integrations'
import { fmtDate, fmtDates, fmtDateTime } from '@/lib/format'

interface Member { id: string; name: string; email: string; role: string; createdAt: string; mfaEnabled?: boolean; lockedUntil?: string | null }
interface Invitation { id: string; email: string; role: string; expiresAt: string; createdAt: string }
interface Settings {
  requireMfa: boolean; requireIndependentReview: boolean; requireApprovalToPublish: boolean
  aiEnabled: boolean; aiDailyLimit: number; sessionIdleHours: number; chatRetentionDays: number; projectRetentionDays: number
  quality: { maxPct: number; minFsPct: number; highFloatDays: number; highDurationDays: number; indexTarget: number }
}
interface OrgData {
  org: { id: string; name: string; createdAt: string }
  you: { id: string; role: string; permissions: string[] }
  roles: { id: string; label: string; description: string }[]
  members: Member[]
  invitations?: Invitation[]
  settings?: Settings
  aiUsageToday?: number
  plan: { id: string; label: string; maxUploadedSchedules: number | null; aiPerDay: number; reports: string[]; exports: string[]; sso: boolean; uploadedSchedules: number }
  service?: { deployment: string; cuiWarning?: string }
  sso?: { enabled: boolean; issuer: string; clientId: string; hasSecret: boolean; domains: string[]; defaultRole: string; enforce: boolean; verification: { host: string; value: string } | null }
}
interface AuditEvent { seq: number; at: string; actorEmail: string | null; action: string; targetType: string | null; targetId: string | null; detail: Record<string, unknown>; ip: string | null; hash: string }

const ACTION_LABELS: Record<string, string> = {
  'auth.signin': 'Signed in', 'auth.signout': 'Signed out', 'auth.signin_failed': 'Failed sign-in', 'auth.locked': 'Account locked', 'auth.mfa_failed': 'Failed verification code',
  'org.created': 'Organization created', 'org.settings_changed': 'Changed policies', 'org.renamed': 'Renamed organization', 'org.ownership_transferred': 'Transferred ownership',
  'member.invited': 'Invited a member', 'member.joined': 'Joined', 'member.role_changed': 'Changed a role', 'member.removed': 'Removed a member', 'member.invite_revoked': 'Revoked an invitation', 'member.unlocked': 'Unlocked a member',
  'plan.created': 'Created plan', 'plan.deleted': 'Deleted plan', 'plan.answer': 'Answered', 'plan.note': 'Added a note', 'plan.generate': 'Generated schedule', 'plan.generate_fresh': 'Rebuilt schedule',
  'plan.review': 'Reviewed', 'plan.publish': 'Published baseline', 'plan.decision': 'Quality decision', 'plan.recovery': 'Applied recovery option', 'plan.export': 'Exported', 'plan.ai_suggest': 'AI follow-up questions',
  'schedule.upload': 'Uploaded schedule', 'schedule.upload_duplicate': 'Uploaded a duplicate file', 'schedule.delete': 'Deleted schedule', 'schedule.tag': 'Tagged schedule', 'schedule.data_question': 'Answered data question', 'schedule.dcma_decision': 'Quality decision',
  'account.password_changed': 'Changed password', 'account.mfa_enabled': 'Turned on 2-step', 'account.mfa_disabled': 'Turned off 2-step', 'account.sessions_revoked': 'Signed out other devices', 'account.session_revoked': 'Signed out a device',
  'ai.request': 'AI request', 'audit.verified': 'Verified audit log', 'audit.chain_broken': 'Audit log verification FAILED', 'apikey.created': 'Created API key', 'apikey.revoked': 'Revoked API key', 'webhook.created': 'Added webhook', 'webhook.deleted': 'Removed webhook', 'webhook.enabled': 'Re-enabled webhook', 'webhook.tested': 'Sent webhook test', 'account.email_verified': 'Verified email address', 'org.quality_rules_changed': 'Changed quality rules', 'audit.exported': 'Exported audit log', 'privacy.organization_exported': 'Exported organization data', 'privacy.personal_data_exported': 'Exported personal data', 'privacy.account_deleted': 'Deleted account', 'retention.purge': 'Retention clean-up',
}
// Download links come from this fixed table, never from page text.
const AUDIT_FILTERS = ['', 'auth.', 'plan.', 'schedule.', 'member.', 'org.', 'ai.', 'privacy.'] as const
const AUDIT_CSV: Record<string, string> = Object.fromEntries(AUDIT_FILTERS.map(f => [f, f ? `/api/audit?format=csv&action=${f}` : '/api/audit?format=csv']))

const actionLabel = (a: string) => ACTION_LABELS[a] || (a.startsWith('plan.override') ? 'Override' : a)

function summarize(e: AuditEvent): string {
  const d = e.detail as Record<string, unknown>
  const bits = [d.plan, d.name, d.email, d.detail, d.format, d.role && `role ${d.role}`, d.before !== undefined && d.after !== undefined && typeof d.before !== 'object' ? `${d.before} → ${d.after}` : null, d.purpose && `${d.purpose} · ${d.model ?? ''}`]
  return fmtDates(bits.filter(Boolean).map(String).join(' · ').slice(0, 160))
}

export default function OrgPage() {
  const router = useRouter()
  const [data, setData] = useState<OrgData | null>(null)
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string; section: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [invite, setInvite] = useState({ email: '', role: 'scheduler' })
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [actionFilter, setActionFilter] = useState('')
  const [verify, setVerify] = useState<{ ok: boolean; count: number; brokenAt?: { seq: number; reason: string } } | null>(null)
  const [owner, setOwner] = useState({ userId: '', password: '', code: '', confirm: '' })
  const [sso, setSso] = useState({ enabled: false, issuer: '', clientId: '', clientSecret: '', domains: '', defaultRole: 'viewer', enforce: false })
  const [ssoHelp, setSsoHelp] = useState<{ value: string; hosts: string[] } | null>(null)

  const can = (p: string) => !!data?.you.permissions.includes(p)

  const load = useCallback(async () => {
    const res = await fetch('/api/org')
    if (res.status === 401) { router.push('/auth'); return }
    const d = await res.json()
    if (!res.ok) { setMsg({ tone: 'error', text: d.error, section: 'top' }); return }
    setData(d); if (d.settings) setSettings(d.settings)
    if (d.sso) setSso({ enabled: d.sso.enabled, issuer: d.sso.issuer, clientId: d.sso.clientId, clientSecret: '', domains: d.sso.domains.join(', '), defaultRole: d.sso.defaultRole, enforce: d.sso.enforce })
  }, [router])
  const loadAudit = useCallback(async (before?: number) => {
    const q = new URLSearchParams({ limit: '50', ...(actionFilter ? { action: actionFilter } : {}), ...(before ? { before: String(before) } : {}) })
    const res = await fetch(`/api/audit?${q}`)
    if (!res.ok) return
    const d = await res.json()
    setEvents(prev => before && prev ? [...prev, ...d.events] : d.events)
  }, [actionFilter])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (data?.you.permissions.includes('audit.read')) loadAudit() }, [data?.you.permissions, loadAudit])

  const act = async (section: string, body: Record<string, unknown>, success?: string) => {
    setBusy(section); setMsg(null)
    const r = await postJson('/api/org', body)
    setBusy(null)
    if (!r.ok) { setMsg({ tone: 'error', text: String(r.data.error || 'Something went wrong.'), section }); return null }
    if (success) setMsg({ tone: 'success', text: success, section })
    return r.data
  }
  const note = (section: string) => msg?.section === section ? <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null

  if (!data) return <div className="flex items-center justify-center py-24 text-warm-400">{note('top') || <Loader2 className="animate-spin" size={20} aria-label="Loading" />}</div>

  const manage = can('org.manage')
  const isOwner = data.you.role === 'owner'
  const assignable = data.roles.filter(r => isOwner || !['owner', 'admin'].includes(r.id))

  return (
    <div className="px-4 md:px-6 py-6 max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-[26px] text-navy-950">{data.org.name}</h1>
        <p className="text-[13.5px] text-warm-500">Organization since {fmtDate(data.org.createdAt)} · you are <span className="capitalize">{data.you.role}</span>. Your firm&apos;s data is private to this organization.</p>
      </div>

      <Section title={`Plan: ${data.plan.label}`} description="What your organization's plan includes. To change plans, contact sales@hoshmand.ai.">
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
          <div className="flex justify-between border-b border-warm-200 py-1"><dt className="text-warm-600">Uploaded schedules</dt><dd className="text-navy-950 font-medium">{data.plan.uploadedSchedules}{data.plan.maxUploadedSchedules != null ? ` of ${data.plan.maxUploadedSchedules}` : ' (unlimited)'}</dd></div>
          <div className="flex justify-between border-b border-warm-200 py-1"><dt className="text-warm-600">AI requests per day</dt><dd className="text-navy-950 font-medium">up to {data.plan.aiPerDay.toLocaleString()}</dd></div>
          <div className="flex justify-between border-b border-warm-200 py-1"><dt className="text-warm-600">Reports</dt><dd className="text-navy-950 font-medium">{data.plan.reports.length === 4 ? 'All four' : 'Executive summary'}</dd></div>
          <div className="flex justify-between border-b border-warm-200 py-1"><dt className="text-warm-600">Exports</dt><dd className="text-navy-950 font-medium">{data.plan.exports.includes('pdf') ? 'P6, MS Project, PDF, Excel, CSV' : 'P6, MS Project, CSV'}</dd></div>
          <div className="flex justify-between border-b border-warm-200 py-1"><dt className="text-warm-600">Single sign-on</dt><dd className="text-navy-950 font-medium">{data.plan.sso ? 'Included' : 'Enterprise plan'}</dd></div>
          <div className="flex justify-between border-b border-warm-200 py-1"><dt className="text-warm-600">Roles, 2-step, audit log</dt><dd className="text-navy-950 font-medium">Included</dd></div>
        </dl>
      </Section>

      <Section title={`Members (${data.members.length})`} description={manage ? 'Removing someone signs them out immediately and disables their account; their projects stay with the organization.' : undefined}>
        {note('members')}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Organization members</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-500 border-b border-warm-200">
              <th scope="col" className="py-2 pr-3 font-semibold">Member</th><th scope="col" className="py-2 pr-3 font-semibold">Role</th>
              {manage && <th scope="col" className="py-2 pr-3 font-semibold">2-step</th>}
              {manage && <th scope="col" className="py-2 font-semibold"><span className="sr-only">Actions</span></th>}
            </tr></thead>
            <tbody>
              {data.members.map(m => (
                <tr key={m.id} className="border-b border-warm-100 align-middle">
                  <td className="py-2.5 pr-3"><div className="font-medium text-navy-950">{m.name}{m.id === data.you.id && <span className="text-warm-400 font-normal"> (you)</span>}</div><div className="text-warm-500 text-[12px]">{m.email}</div></td>
                  <td className="py-2.5 pr-3">
                    {manage && m.id !== data.you.id && (isOwner || !['owner', 'admin'].includes(m.role)) ? (
                      <select aria-label={`Role for ${m.name}`} value={m.role} className="bg-warm-100 border border-warm-300 rounded px-2 py-1 text-[13px]"
                        onChange={async e => { if (await act('members', { action: 'set_role', userId: m.id, role: e.target.value }, `${m.name} is now ${e.target.value}.`)) load() }}>
                        {assignable.concat(data.roles.filter(r => r.id === m.role && !assignable.includes(r))).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    ) : <span className="capitalize">{m.role}</span>}
                  </td>
                  {manage && <td className="py-2.5 pr-3">{m.mfaEnabled ? <span className="inline-flex items-center gap-1 text-status-on-track"><ShieldCheck size={14} aria-hidden="true" />On</span> : <span className="inline-flex items-center gap-1 text-warm-500"><ShieldAlert size={14} aria-hidden="true" />Off</span>}</td>}
                  {manage && <td className="py-2.5 text-right whitespace-nowrap">
                    {m.lockedUntil && new Date(m.lockedUntil) > new Date() && <Button variant="ghost" onClick={async () => { if (await act('members', { action: 'unlock_member', userId: m.id }, `${m.name} unlocked.`)) load() }}><Lock size={12} className="inline mr-0.5" aria-hidden="true" />Unlock</Button>}
                    {m.id !== data.you.id && (isOwner || !['owner', 'admin'].includes(m.role)) && <Button variant="ghost" className="text-status-at-risk" onClick={async () => {
                      if (!confirm(`Remove ${m.name}? They'll be signed out and can no longer sign in.`)) return
                      if (await act('members', { action: 'remove_member', userId: m.id }, `${m.name} removed.`)) load()
                    }}>Remove</Button>}
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {manage && (
        <Section title="Invite someone" description="Invitations are single-use and expire in 7 days. Send the link yourself (email, Teams, Slack); it only works for the address you enter.">
          {note('invite')}
          <form className="grid sm:grid-cols-[1fr_180px_auto] gap-3 items-end" onSubmit={async e => {
            e.preventDefault()
            const d = await act('invite', { action: 'invite', ...invite })
            if (d) { setInviteLink(String(d.link)); setInvite({ ...invite, email: '' }); load() }
          }}>
            <Field label="Work email">{p => <input {...p} type="email" required className={inputClass} value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} />}</Field>
            <Field label="Role">{p => <select {...p} className={inputClass} value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}>{assignable.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>}</Field>
            <Button type="submit" disabled={busy === 'invite'}>Create invitation</Button>
          </form>
          <p className="text-[12px] text-warm-500 mt-2">{data.roles.find(r => r.id === invite.role)?.description}</p>
          {inviteLink && (
            <div className="mt-3 flex gap-2 items-center bg-warm-100 border border-warm-200 rounded-md p-2.5">
              <code className="flex-1 text-[12px] break-all text-navy-950">{inviteLink}</code>
              <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(inviteLink)}><Copy size={13} className="inline mr-1" aria-hidden="true" />Copy</Button>
            </div>
          )}
          {!!data.invitations?.length && (
            <ul className="mt-4 divide-y divide-warm-200 border border-warm-200 rounded-md">
              {data.invitations.map(i => (
                <li key={i.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                  <span><span className="text-navy-950 font-medium">{i.email}</span> · <span className="capitalize">{i.role}</span> · expires {fmtDate(i.expiresAt)}</span>
                  <Button variant="ghost" onClick={async () => { if (await act('invite', { action: 'revoke_invite', invitationId: i.id }, 'Invitation revoked.')) load() }}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {manage && settings && (
        <Section title="Policies" description="Apply to everyone in the organization. Changes are recorded in the audit log.">
          {note('settings')}
          {data.service?.cuiWarning && (
            <div role="note" className="bg-status-attention-bg border-l-2 border-status-attention text-warm-700 text-[13px] px-4 py-3 rounded-md mb-4">
              <strong className="font-semibold text-navy-950">Controlled information.</strong> {data.service.cuiWarning}
            </div>
          )}
          <div className="space-y-3">
            {([
              ['requireMfa', 'Require two-step verification', 'Members without it are asked to set it up before they can continue. Turn it on for your own account first.'],
              ['requireIndependentReview', 'Independent review', "The person who created a plan can't approve it."],
              ['requireApprovalToPublish', 'Approval before publishing', 'A baseline can only be published after someone other than its author approves the current version.'],
              ['aiEnabled', 'Allow AI features', 'Off by default for new organizations. Off = rules-only: nothing is sent to any AI model. On = interview suggestions, Ask AI and report wording are sent to the configured model (OpenAI on the cloud service; see the subprocessor list). Scheduling, CPM, quality checks and reports work either way. Projects marked CUI or classified are never sent to a cloud model.'],
            ] as const).map(([k, label, help]) => (
              <label key={k} className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1 w-4 h-4 accent-accent-500" checked={settings[k]} onChange={e => setSettings({ ...settings, [k]: e.target.checked })} />
                <span><span className="block text-[13.5px] font-medium text-navy-950">{label}</span><span className="block text-[12.5px] text-warm-500">{help}</span></span>
              </label>
            ))}
            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              <Field label="AI requests per day" hint={`Used today: ${data.aiUsageToday ?? 0}. Caps model spend; resets at midnight UTC.`}>{p => <input {...p} type="number" min={0} max={10000} className={inputClass} value={settings.aiDailyLimit} onChange={e => setSettings({ ...settings, aiDailyLimit: Number(e.target.value) })} />}</Field>
              <Field label="Sign out after inactivity (hours)" hint="1–24 hours.">{p => <input {...p} type="number" min={1} max={24} className={inputClass} value={settings.sessionIdleHours} onChange={e => setSettings({ ...settings, sessionIdleHours: Number(e.target.value) })} />}</Field>
              <Field label="Keep Ask AI history (days)" hint="0 = keep until deleted.">{p => <input {...p} type="number" min={0} max={3650} className={inputClass} value={settings.chatRetentionDays} onChange={e => setSettings({ ...settings, chatRetentionDays: Number(e.target.value) })} />}</Field>
              <Field label="Delete inactive projects after (days)" hint="Plans and uploaded schedules unchanged this long are deleted. 0 = keep until deleted.">{p => <input {...p} type="number" min={0} max={3650} className={inputClass} value={settings.projectRetentionDays} onChange={e => setSettings({ ...settings, projectRetentionDays: Number(e.target.value) })} />}</Field>
            </div>
            <fieldset className="pt-2">
              <legend className="text-[13.5px] font-medium text-navy-950">Quality check thresholds (DCMA 14-point)</legend>
              <p className="text-[12.5px] text-warm-500 mb-2">Defaults are the published DCMA values (5%, 90% FS, 44 days, 0.95). Tighten or relax them to match your company or owner standard; every quality report states the threshold it used.</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Max share of offenders (%)" hint="Logic, lags, hard constraints, high float, high duration, missed tasks. 1–25.">{p => <input {...p} type="number" min={1} max={25} className={inputClass} value={settings.quality.maxPct} onChange={e => setSettings({ ...settings, quality: { ...settings.quality, maxPct: Number(e.target.value) } })} />}</Field>
                <Field label="Min finish-to-start links (%)" hint="Relationship types. 50–100.">{p => <input {...p} type="number" min={50} max={100} className={inputClass} value={settings.quality.minFsPct} onChange={e => setSettings({ ...settings, quality: { ...settings.quality, minFsPct: Number(e.target.value) } })} />}</Field>
                <Field label="High float above (work days)" hint="10–260.">{p => <input {...p} type="number" min={10} max={260} className={inputClass} value={settings.quality.highFloatDays} onChange={e => setSettings({ ...settings, quality: { ...settings.quality, highFloatDays: Number(e.target.value) } })} />}</Field>
                <Field label="High duration above (work days)" hint="5–260.">{p => <input {...p} type="number" min={5} max={260} className={inputClass} value={settings.quality.highDurationDays} onChange={e => setSettings({ ...settings, quality: { ...settings.quality, highDurationDays: Number(e.target.value) } })} />}</Field>
                <Field label="Min CPLI and BEI" hint="0.80–1.00.">{p => <input {...p} type="number" min={0.8} max={1} step={0.01} className={inputClass} value={settings.quality.indexTarget} onChange={e => setSettings({ ...settings, quality: { ...settings.quality, indexTarget: Number(e.target.value) } })} />}</Field>
              </div>
            </fieldset>
            <Button disabled={busy === 'settings'} onClick={async () => { const d = await act('settings', { action: 'update_settings', settings }, 'Policies saved.'); if (d) load() }}>Save policies</Button>
          </div>
        </Section>
      )}

      {manage && (
        <Section title="Single sign-on (SSO)" description="Members sign in with your identity provider (Microsoft Entra ID, Okta, Google Workspace, or any OpenID Connect provider). People with an allowed email domain are added on first sign-in with the default role.">
          {note('sso')}
          {!data.plan.sso ? <p className="text-[13px] text-warm-600">Single sign-on is part of the Enterprise plan.</p> : (
            <form className="space-y-3" onSubmit={async e => {
              e.preventDefault(); setSsoHelp(null); setBusy('sso'); setMsg(null)
              const r = await postJson('/api/org', { action: 'update_sso', sso: { ...sso, domains: sso.domains.split(/[\s,]+/).filter(Boolean) } })
              setBusy(null)
              if (!r.ok) {
                setMsg({ tone: 'error', text: String(r.data.error || 'Could not save.'), section: 'sso' })
                if (r.data.verification) setSsoHelp(r.data.verification as { value: string; hosts: string[] })
                return
              }
              setMsg({ tone: 'success', text: sso.enabled ? 'Single sign-on is on.' : 'Saved.', section: 'sso' }); setSso({ ...sso, clientSecret: '' }); load()
            }}>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Issuer URL" hint="e.g. https://login.microsoftonline.com/<tenant-id>/v2.0">{p => <input {...p} className={inputClass} value={sso.issuer} onChange={e => setSso({ ...sso, issuer: e.target.value })} />}</Field>
                <Field label="Client ID">{p => <input {...p} className={inputClass} value={sso.clientId} onChange={e => setSso({ ...sso, clientId: e.target.value })} />}</Field>
                <Field label="Client secret" hint={data.sso?.hasSecret ? 'A secret is saved. Leave blank to keep it.' : 'Stored encrypted; never shown again.'}>{p => <input {...p} type="password" autoComplete="off" className={inputClass} value={sso.clientSecret} onChange={e => setSso({ ...sso, clientSecret: e.target.value })} />}</Field>
                <Field label="Email domains" hint="Comma-separated, e.g. acme.com, acme.co.uk">{p => <input {...p} className={inputClass} value={sso.domains} onChange={e => setSso({ ...sso, domains: e.target.value })} />}</Field>
                <Field label="Role for new members">{p => <select {...p} className={inputClass} value={sso.defaultRole} onChange={e => setSso({ ...sso, defaultRole: e.target.value })}>{data.roles.filter(r => r.id !== 'owner').map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>}</Field>
                <div className="text-[12px] text-warm-600 self-end">Redirect URI to register with your provider:<br /><code className="text-navy-950 break-all">{typeof window !== 'undefined' ? `${window.location.origin}/api/auth/sso/callback` : ''}</code></div>
              </div>
              {(data.sso?.verification || ssoHelp) && (
                <p className="text-[12.5px] text-warm-600">Domain ownership: add a DNS TXT record at <code className="text-navy-950">{ssoHelp?.hosts.join(', ') || data.sso?.verification?.host}</code> with the value <code className="text-navy-950 break-all">{ssoHelp?.value || data.sso?.verification?.value}</code>.</p>
              )}
              <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 w-4 h-4 accent-accent-500" checked={sso.enabled} onChange={e => setSso({ ...sso, enabled: e.target.checked })} /><span className="text-[13.5px] text-navy-950 font-medium">Turn on single sign-on</span></label>
              <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 w-4 h-4 accent-accent-500" checked={sso.enforce} onChange={e => setSso({ ...sso, enforce: e.target.checked })} /><span><span className="block text-[13.5px] text-navy-950 font-medium">Require single sign-on</span><span className="block text-[12.5px] text-warm-600">Members can no longer use a password. Owners keep password sign-in as an emergency account.</span></span></label>
              <Button type="submit" disabled={busy === 'sso'}>{busy === 'sso' ? 'Checking provider…' : 'Save single sign-on'}</Button>
            </form>
          )}
        </Section>
      )}

      {manage && <Integrations />}

      {can('audit.read') && (
        <Section title="Audit log" description="Every sign-in, change, review, export and AI request, with who, when and from where. Records are chained by hash and the database refuses edits or deletions, so tampering is both blocked and detectable.">
          {note('audit')}
          <div className="flex flex-wrap gap-2 items-end mb-3">
            <Field label="Filter">{p => (
              <select {...p} className="bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px]" value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
                <option value="">All activity</option><option value="auth.">Sign-ins</option><option value="plan.">Plans</option><option value="schedule.">Schedules</option>
                <option value="member.">Members</option><option value="org.">Organization</option><option value="ai.">AI requests</option><option value="privacy.">Privacy</option>
              </select>
            )}</Field>
            <Button variant="secondary" disabled={busy === 'verify'} onClick={async () => {
              setBusy('verify'); const r = await fetch('/api/audit?verify=1'); setVerify(await r.json()); setBusy(null)
            }}>{busy === 'verify' ? 'Verifying…' : 'Verify integrity'}</Button>
            <a href={AUDIT_CSV[actionFilter] ?? AUDIT_CSV['']} className="px-3.5 py-2 rounded-md text-[13px] border border-warm-300 bg-warm-50 text-navy-950 hover:bg-warm-100 font-medium"><Download size={13} className="inline mr-1" aria-hidden="true" />Download CSV</a>
          </div>
          {verify && (
            <div className="mb-3">{verify.ok
              ? <Alert tone="success"><CheckCircle2 size={14} className="inline mr-1" aria-hidden="true" />Intact: all {verify.count.toLocaleString()} records match their hash chain.</Alert>
              : <Alert tone="error"><XCircle size={14} className="inline mr-1" aria-hidden="true" />Integrity check failed at record #{verify.brokenAt?.seq}: {verify.brokenAt?.reason}</Alert>}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">Audit log, newest first</caption>
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-500 border-b border-warm-200">
                <th scope="col" className="py-2 pr-3 font-semibold">When</th><th scope="col" className="py-2 pr-3 font-semibold">Who</th><th scope="col" className="py-2 pr-3 font-semibold">What</th><th scope="col" className="py-2 font-semibold">Details</th>
              </tr></thead>
              <tbody>
                {(events || []).map(e => (
                  <tr key={e.seq} className="border-b border-warm-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-warm-600">{fmtDateTime(e.at)}</td>
                    <td className="py-2 pr-3 text-warm-700">{e.actorEmail || 'system'}{e.ip && <div className="text-[11px] text-warm-400">{e.ip}</div>}</td>
                    <td className="py-2 pr-3 text-navy-950 font-medium">{actionLabel(e.action)}</td>
                    <td className="py-2 text-warm-600 break-words">{summarize(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {events && events.length >= 50 && events.length % 50 === 0 && <div className="mt-3"><Button variant="secondary" onClick={() => loadAudit(events[events.length - 1].seq)}>Load older</Button></div>}
        </Section>
      )}

      {manage && (
        <Section title="Your organization's data" description="Download everything stored for your organization (members, plans, schedules, answers, AI history and the audit log) as one JSON file.">
          {note('data')}
          <Button variant="secondary" disabled={busy === 'data'} onClick={async () => {
            setBusy('data')
            const res = await fetch('/api/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export_data' }) })
            setBusy(null)
            if (!res.ok) { setMsg({ tone: 'error', text: 'Export failed.', section: 'data' }); return }
            const url = URL.createObjectURL(await res.blob())
            const a = document.createElement('a'); a.href = url; a.download = `planora-organization-export-${new Date().toISOString().slice(0, 10)}.json`; a.click()
          }}><Download size={13} className="inline mr-1" aria-hidden="true" />{busy === 'data' ? 'Preparing…' : 'Export organization data'}</Button>
        </Section>
      )}

      {isOwner && (
        <Section title="Ownership and deletion" tone="danger" description="Confirm with your password (and authenticator code if you use one).">
          {note('owner')}
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <Field label="Password">{p => <input {...p} type="password" autoComplete="current-password" className={inputClass} value={owner.password} onChange={e => setOwner({ ...owner, password: e.target.value })} />}</Field>
            <Field label="Authenticator code (if on)">{p => <input {...p} inputMode="numeric" className={inputClass} value={owner.code} onChange={e => setOwner({ ...owner, code: e.target.value })} />}</Field>
          </div>
          <div className="flex flex-wrap gap-2 items-end mb-5">
            <Field label="Transfer ownership to">{p => (
              <select {...p} className={inputClass} value={owner.userId} onChange={e => setOwner({ ...owner, userId: e.target.value })}>
                <option value="">Choose a member…</option>
                {data.members.filter(m => m.id !== data.you.id).map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
              </select>
            )}</Field>
            <Button variant="secondary" disabled={!owner.userId || busy === 'owner'} onClick={async () => {
              if (!confirm('Transfer ownership? You will become an admin.')) return
              if (await act('owner', { action: 'transfer_ownership', userId: owner.userId, password: owner.password, code: owner.code }, 'Ownership transferred.')) { setOwner({ userId: '', password: '', code: '', confirm: '' }); load() }
            }}>Transfer</Button>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <Field label={`Type "${data.org.name}" to delete the organization`}>{p => <input {...p} className={inputClass} value={owner.confirm} onChange={e => setOwner({ ...owner, confirm: e.target.value })} />}</Field>
            <Button variant="danger" disabled={owner.confirm !== data.org.name || busy === 'owner'} onClick={async () => {
              if (!confirm('Delete the organization and ALL of its data permanently? This cannot be undone.')) return
              if (await act('owner', { action: 'delete_org', password: owner.password, code: owner.code, confirm: owner.confirm })) window.location.href = '/'
            }}>Delete organization</Button>
          </div>
        </Section>
      )}
    </div>
  )
}
