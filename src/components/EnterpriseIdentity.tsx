'use client'

// Organization → SAML single sign-on and SCIM provisioning (admins, Enterprise plan).
// SAML: paste IdP metadata (or fill the fields), download Planora's SP metadata, test sign-in.
// SCIM: base URL, bearer tokens (shown once, revocable) and the latest provisioning events.

import { useCallback, useEffect, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { Section, Field, Button, Alert, inputClass, postJson } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

interface Cert { pem: string; subject?: string; notAfter?: string; fingerprint256?: string; expired?: boolean }
interface Saml {
  enabled: boolean; idpEntityId: string; ssoUrl: string; nameIdFormat: string; attributes: { email: string; name: string; groups: string }
  defaultRole: string; groupRoles: { group: string; role: string }[]; domains: string[]; enforce: boolean; certs: Cert[]
  sp: { entityId: string; acsUrl: string; metadataUrl: string; loginUrl: string } | null
  verification: { host: string; value: string } | null
}
interface SamlData { available: boolean; saml: Saml; nameIdFormats: Record<string, string> }
interface Token { id: string; name: string; prefix: string; createdBy: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
interface ScimEvent { seq: number; at: string; action: string; actorEmail: string | null; detail: Record<string, unknown> }
interface ScimData { available: boolean; baseUrl: string; tokens: Token[]; events: ScimEvent[] }

const SCIM_LABELS: Record<string, string> = {
  'scim.user_created': 'Provisioned', 'scim.user_updated': 'Updated', 'scim.user_deprovisioned': 'Deprovisioned (signed out)', 'scim.user_reactivated': 'Reactivated',
  'scim.user_deleted': 'Deleted (signed out)', 'scim.token_created': 'Token created', 'scim.token_revoked': 'Token revoked',
}

type Form = { enabled: boolean; idpEntityId: string; ssoUrl: string; certs: string; nameIdFormat: string; email: string; name: string; groups: string; defaultRole: string; groupRoles: string; domains: string; enforce: boolean }

const toForm = (s: Saml): Form => ({
  enabled: s.enabled, idpEntityId: s.idpEntityId, ssoUrl: s.ssoUrl, certs: s.certs.map(c => c.pem.trim()).join('\n\n'), nameIdFormat: s.nameIdFormat,
  email: s.attributes.email, name: s.attributes.name, groups: s.attributes.groups, defaultRole: s.defaultRole,
  groupRoles: s.groupRoles.map(g => `${g.group} = ${g.role}`).join('\n'), domains: s.domains.join(', '), enforce: s.enforce,
})

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[12.5px] text-warm-600">
      <span className="block">{label}</span>
      <span className="flex items-center gap-2 mt-0.5">
        <code className="flex-1 min-w-0 break-all text-navy-950 bg-warm-50 border border-warm-200 rounded px-2 py-1">{value}</code>
        <Button type="button" variant="secondary" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard?.writeText(value)}><Copy size={13} /></Button>
      </span>
    </div>
  )
}

export function EnterpriseIdentity({ roles }: { roles: { id: string; label: string }[] }) {
  const [saml, setSaml] = useState<SamlData | null>(null)
  const [scim, setScim] = useState<ScimData | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [metadata, setMetadata] = useState('')
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'info'; text: string; section: 'saml' | 'scim' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [tokenName, setTokenName] = useState('')
  const [help, setHelp] = useState<{ value: string; hosts: string[] } | null>(null)

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch('/api/org/saml'), fetch('/api/org/scim')])
    if (a.ok) { const d = await a.json() as SamlData; setSaml(d); setForm(toForm(d.saml)) }
    if (b.ok) setScim(await b.json())
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    // Result of "Test sign-in" (the ACS redirects back here; nobody is signed in by a test).
    const q = new URLSearchParams(window.location.search)
    const result = q.get('saml_test')
    if (result) setMsg({ tone: result === 'ok' ? 'success' : 'error', text: q.get('saml_message') || (result === 'ok' ? 'Test sign-in succeeded.' : 'Test sign-in failed.'), section: 'saml' })
  }, [])

  if (!saml || !form) return null
  const note = (section: 'saml' | 'scim') => msg?.section === section ? <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null
  const assignable = roles.filter(r => r.id !== 'owner')

  const readMetadata = async () => {
    setBusy('metadata'); setMsg(null)
    const r = await postJson('/api/org/saml', { action: 'parse_metadata', xml: metadata })
    setBusy(null)
    if (!r.ok) { setMsg({ tone: 'error', text: String(r.data.error || 'Could not read the metadata.'), section: 'saml' }); return }
    const p = r.data.parsed as { idpEntityId: string; ssoUrl: string; certs: string[] }
    setForm({ ...form, idpEntityId: p.idpEntityId || form.idpEntityId, ssoUrl: p.ssoUrl || form.ssoUrl, certs: p.certs.length ? p.certs.map(c => c.trim()).join('\n\n') : form.certs })
    setMsg({ tone: 'info', text: `Read ${p.certs.length} signing certificate${p.certs.length === 1 ? '' : 's'}${p.ssoUrl ? '' : ' (no HTTP-Redirect sign-on URL found: enter it below)'}. Review, then save.`, section: 'saml' })
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy('saml'); setMsg(null); setHelp(null)
    const groupRoles = form.groupRoles.split('\n').map(l => l.split('=')).filter(p => p.length === 2 && p[0].trim()).map(([group, role]) => ({ group: group.trim(), role: role.trim().toLowerCase() }))
    const r = await postJson('/api/org/saml', { action: 'save', saml: {
      enabled: form.enabled, enforce: form.enforce, idpEntityId: form.idpEntityId, ssoUrl: form.ssoUrl, certs: form.certs, nameIdFormat: form.nameIdFormat,
      attributes: { email: form.email, name: form.name, groups: form.groups }, defaultRole: form.defaultRole, groupRoles, domains: form.domains.split(/[\s,]+/).filter(Boolean),
    } })
    setBusy(null)
    if (!r.ok) {
      setMsg({ tone: 'error', text: String(r.data.error || 'Could not save.'), section: 'saml' })
      if (r.data.verification) setHelp(r.data.verification as { value: string; hosts: string[] })
      return
    }
    setMsg({ tone: 'success', text: form.enabled ? 'SAML single sign-on is on.' : 'Saved. Use Test sign-in before turning it on.', section: 'saml' })
    load()
  }

  const scimAct = async (id: string, payload: Record<string, unknown>, ok?: string) => {
    setBusy(id); setMsg(null)
    const r = await postJson('/api/org/scim', payload)
    setBusy(null)
    if (!r.ok) { setMsg({ tone: 'error', text: String(r.data.error || 'Something went wrong.'), section: 'scim' }); return null }
    if (ok) setMsg({ tone: 'success', text: ok, section: 'scim' })
    await load()
    return r.data
  }

  const sp = saml.saml.sp
  return (
    <>
      <Section id="saml" title="SAML single sign-on" description="Use SAML 2.0 with Microsoft Entra ID, Okta, Ping, ADFS, Google Workspace or any SAML identity provider (alongside, or instead of, OpenID Connect above). Responses must be signed with one of the certificates below; people with an allowed email domain are added on first sign-in.">
        {note('saml')}
        {!saml.available ? <p className="text-[13px] text-warm-600">SAML single sign-on is part of the Enterprise plan.</p> : (
          <form className="space-y-3" onSubmit={save}>
            {sp ? (
              <div className="grid gap-2 border border-warm-200 rounded-md p-3">
                <p className="text-[12.5px] font-semibold text-navy-950">Register Planora with your identity provider</p>
                <CopyLine label="Entity ID (Audience)" value={sp.entityId} />
                <CopyLine label="Assertion consumer service (Reply) URL, HTTP-POST" value={sp.acsUrl} />
                <div className="flex flex-wrap gap-2 pt-1">
                  <a href={`${sp.metadataUrl}?download=1`} className="px-3.5 py-2 rounded-md text-[13px] border border-warm-300 bg-warm-50 text-navy-950 hover:bg-warm-100 font-medium"><Download size={13} className="inline mr-1" aria-hidden="true" />Download SP metadata</a>
                  {saml.saml.certs.length > 0 && saml.saml.ssoUrl && <a href={`${sp.loginUrl}?test=1`} className="px-3.5 py-2 rounded-md text-[13px] border border-warm-300 bg-warm-50 text-navy-950 hover:bg-warm-100 font-medium">Test sign-in</a>}
                </div>
                <p className="text-[12px] text-warm-600">Test sign-in checks the whole response from your identity provider and reports the result here. It does not sign you in or add anyone.</p>
              </div>
            ) : <p className="text-[12.5px] text-warm-600">Save once to get Planora&apos;s entity ID, reply URL and SP metadata.</p>}

            <Field label="IdP metadata XML (optional)" hint="Paste your identity provider's federation metadata to fill in the fields below.">{p => (
              <textarea {...p} rows={3} className={`${inputClass} font-mono text-[12px]`} value={metadata} onChange={e => setMetadata(e.target.value)} />
            )}</Field>
            <Button type="button" variant="secondary" disabled={!metadata.trim() || busy === 'metadata'} onClick={readMetadata}>Read metadata</Button>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="IdP entity ID (Issuer)">{p => <input {...p} className={inputClass} value={form.idpEntityId} onChange={e => setForm({ ...form, idpEntityId: e.target.value })} />}</Field>
              <Field label="IdP sign-on URL (HTTP-Redirect)">{p => <input {...p} className={inputClass} value={form.ssoUrl} onChange={e => setForm({ ...form, ssoUrl: e.target.value })} />}</Field>
            </div>
            <Field label="IdP signing certificates" hint="PEM. Add the new certificate next to the old one during a rollover.">{p => (
              <textarea {...p} rows={4} className={`${inputClass} font-mono text-[12px]`} value={form.certs} onChange={e => setForm({ ...form, certs: e.target.value })} />
            )}</Field>
            {saml.saml.certs.length > 0 && (
              <ul className="text-[12px] text-warm-600 space-y-1">
                {saml.saml.certs.map(c => (
                  <li key={c.fingerprint256 || c.pem}><span className="text-navy-950">{c.subject}</span> · expires {c.notAfter ? fmtDateTime(c.notAfter) : 'unknown'}{c.expired && <span className="text-status-at-risk font-medium"> (expired)</span>} · <span className="font-mono break-all">SHA-256 {c.fingerprint256}</span></li>
                ))}
              </ul>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="NameID format">{p => (
                <select {...p} className={inputClass} value={form.nameIdFormat} onChange={e => setForm({ ...form, nameIdFormat: e.target.value })}>
                  {Object.entries(saml.nameIdFormats).map(([k, v]) => <option key={v} value={v}>{k === 'email' ? 'Email address' : k === 'persistent' ? 'Persistent' : 'Unspecified'}</option>)}
                </select>
              )}</Field>
              <Field label="Email domains" hint="Comma-separated, e.g. acme.com, acme.co.uk">{p => <input {...p} className={inputClass} value={form.domains} onChange={e => setForm({ ...form, domains: e.target.value })} />}</Field>
              <Field label="Email attribute" hint="Blank: email, mail or the standard claim; else the NameID.">{p => <input {...p} className={inputClass} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />}</Field>
              <Field label="Name attribute" hint="Blank: displayName or given name + surname.">{p => <input {...p} className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}</Field>
              <Field label="Groups attribute" hint="Blank: groups, memberOf or the standard claim.">{p => <input {...p} className={inputClass} value={form.groups} onChange={e => setForm({ ...form, groups: e.target.value })} />}</Field>
              <Field label="Role for new members">{p => <select {...p} className={inputClass} value={form.defaultRole} onChange={e => setForm({ ...form, defaultRole: e.target.value })}>{assignable.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>}</Field>
            </div>
            <Field label="Group to role mapping" hint="One per line: IdP group = role (admin, scheduler, reviewer or viewer). Applied at every sign-in; owners are never changed.">{p => (
              <textarea {...p} rows={3} className={`${inputClass} font-mono text-[12px]`} placeholder="Planora Admins = admin" value={form.groupRoles} onChange={e => setForm({ ...form, groupRoles: e.target.value })} />
            )}</Field>
            {(saml.saml.verification || help) && (
              <p className="text-[12.5px] text-warm-600">Domain ownership: add a DNS TXT record at <code className="text-navy-950">{help?.hosts.join(', ') || saml.saml.verification?.host}</code> with the value <code className="text-navy-950 break-all">{help?.value || saml.saml.verification?.value}</code>.</p>
            )}
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 w-4 h-4 accent-accent-500" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /><span className="text-[13.5px] text-navy-950 font-medium">Turn on SAML single sign-on</span></label>
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 w-4 h-4 accent-accent-500" checked={form.enforce} onChange={e => setForm({ ...form, enforce: e.target.checked })} /><span><span className="block text-[13.5px] text-navy-950 font-medium">Require single sign-on</span><span className="block text-[12.5px] text-warm-600">Members can no longer use a password. Owners keep password sign-in as an emergency account.</span></span></label>
            <Button type="submit" disabled={busy === 'saml'}>{busy === 'saml' ? 'Saving…' : 'Save SAML settings'}</Button>
          </form>
        )}
      </Section>

      <Section id="scim" title="SCIM provisioning" description="Let your identity provider add, update and remove members automatically (SCIM 2.0). Deactivating or deleting someone in your identity provider disables their Planora account and signs them out everywhere at once. Members are matched by email and must be in one of your verified single sign-on domains.">
        {note('scim')}
        {scim && (!scim.available ? <p className="text-[13px] text-warm-600">SCIM provisioning is part of the Enterprise plan.</p> : (
          <div className="space-y-4">
            <CopyLine label="SCIM base URL (tenant URL)" value={scim.baseUrl} />
            {secret && (
              <div className="border border-status-attention bg-status-attention-bg rounded-md p-3">
                <p className="text-[13px] text-warm-700 font-medium">SCIM token created. Paste it into your identity provider now: it won&apos;t be shown again.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 break-all text-[12.5px] bg-warm-50 border border-warm-200 rounded px-2 py-1.5 text-navy-950">{secret}</code>
                  <Button variant="secondary" aria-label="Copy token" onClick={() => navigator.clipboard?.writeText(secret)}><Copy size={13} /></Button>
                </div>
                <Button variant="ghost" className="mt-2" onClick={() => setSecret(null)}>I&apos;ve stored it safely</Button>
              </div>
            )}
            {scim.tokens.length > 0 ? (
              <div className="relative overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <caption className="sr-only">SCIM tokens</caption>
                  <thead><tr className="text-left text-warm-500"><th scope="col" className="py-1.5 pr-3 font-medium">Name</th><th scope="col" className="pr-3 font-medium">Token</th><th scope="col" className="pr-3 font-medium">Created</th><th scope="col" className="pr-3 font-medium">Last used</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {scim.tokens.map(t => (
                      <tr key={t.id} className="border-t border-warm-200 text-warm-700">
                        <td className="py-1.5 pr-3 font-medium text-navy-950">{t.name}</td>
                        <td className="pr-3 font-mono">{t.prefix}…</td>
                        <td className="pr-3">{fmtDateTime(t.createdAt)} · {t.createdBy}</td>
                        <td className="pr-3">{t.revokedAt ? `Revoked ${fmtDateTime(t.revokedAt)}` : t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : 'Never'}</td>
                        <td className="text-right">{!t.revokedAt && <Button variant="ghost" disabled={busy === t.id} onClick={() => { if (confirm(`Revoke “${t.name}”? Provisioning with it stops immediately.`)) scimAct(t.id, { action: 'revoke_token', id: t.id }, 'Token revoked.') }}>Revoke</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-[12.5px] text-warm-500">No SCIM tokens yet.</p>}
            <form className="grid sm:grid-cols-[1fr_auto] gap-3 items-end" onSubmit={async e => {
              e.preventDefault()
              const d = await scimAct('token', { action: 'create_token', name: tokenName })
              if (d) { setSecret(String(d.secret)); setTokenName('') }
            }}>
              <Field label="Token name">{p => <input {...p} required maxLength={80} className={inputClass} placeholder="e.g. Entra ID provisioning" value={tokenName} onChange={e => setTokenName(e.target.value)} />}</Field>
              <Button type="submit" disabled={busy === 'token'}>Create SCIM token</Button>
            </form>
            <div>
              <h3 className="text-[13px] font-semibold text-navy-950 mb-2">Latest provisioning events</h3>
              {scim.events.length ? (
                <div className="relative overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <caption className="sr-only">Latest SCIM provisioning events, newest first</caption>
                    <thead><tr className="text-left text-warm-500"><th scope="col" className="py-1.5 pr-3 font-medium">When</th><th scope="col" className="pr-3 font-medium">What</th><th scope="col" className="pr-3 font-medium">Member</th><th scope="col" className="font-medium">By</th></tr></thead>
                    <tbody>
                      {scim.events.map(e => (
                        <tr key={e.seq} className="border-t border-warm-200 text-warm-700">
                          <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDateTime(e.at)}</td>
                          <td className="pr-3">{SCIM_LABELS[e.action] || e.action}</td>
                          <td className="pr-3 break-all">{String(e.detail.email ?? e.detail.name ?? '')}</td>
                          <td className="break-all">{e.actorEmail || 'system'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-[12.5px] text-warm-500">No provisioning activity yet.</p>}
            </div>
          </div>
        ))}
      </Section>
    </>
  )
}
