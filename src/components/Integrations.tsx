'use client'

// Organization → Integrations: API keys and webhooks. Secrets are shown once, right after creation.
// Each list is shown first; the form that adds to it opens from a button (it was always open, so the page
// showed two forms and two filled buttons before anything had been created).

import { useCallback, useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { Section, Field, Button, Alert, inputClass, postJson } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

interface Key { id: string; name: string; prefix: string; role: string; createdBy: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null }
interface Hook { id: string; url: string; events: string[]; createdAt: string; disabledAt: string | null; lastDeliveryAt: string | null; lastStatus: string | null; consecutiveFailures: number }
interface Data { available: boolean; keys: Key[]; webhooks: Hook[]; events: { id: string; label: string }[]; roles: string[] }

const URL_ = '/api/org/integrations'

export function Integrations() {
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const [key, setKey] = useState({ name: '', role: 'viewer', expiresInDays: '365' })
  const [hook, setHook] = useState<{ url: string; events: string[] }>({ url: '', events: ['plan.publish', 'plan.review'] })
  const [adding, setAdding] = useState<'key' | 'hook' | null>(null)

  const [loadErr, setLoadErr] = useState(false)
  const load = useCallback(async () => {
    try {
      const res = await fetch(URL_)
      if (!res.ok) throw new Error('load')
      setData(await res.json()); setLoadErr(false)
    } catch { setLoadErr(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (id: string, payload: Record<string, unknown>, ok?: string) => {
    setBusy(id); setMsg(null)
    const r = await postJson(URL_, payload)
    setBusy(null)
    if (!r.ok) { setMsg({ tone: 'error', text: String(r.data.error || 'Something went wrong.') }); return null }
    if (ok) setMsg({ tone: 'success', text: ok })
    await load()
    return r.data
  }

  if (!data) return loadErr ? (
    <Section title="Integrations: API and webhooks">
      <div className="space-y-2"><Alert tone="error">Could not load integrations. Check your connection and try again.</Alert><Button variant="secondary" onClick={load}>Try again</Button></div>
    </Section>
  ) : null
  return (
    <Section title="Integrations: API and webhooks" description="Connect RunF9 to BI dashboards, a data warehouse or your own tools. API keys act with a limited role and can be revoked at any time; webhooks send signed notifications when things happen. Everything here is in the audit log. The developer guide (endpoints, webhook signatures) is available from support@hoshmand.ai.">
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {!data.available && <div className="mb-3"><Alert tone="info">API keys and webhooks are included in the Pro and Enterprise plans.</Alert></div>}
      {secret && (
        <div className="mb-4 border border-status-attention bg-status-attention-bg rounded-md p-3">
          <p className="text-body text-warm-700 font-medium">{secret.label} Copy it now: it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all text-caption bg-warm-50 border border-warm-200 rounded px-2 py-1.5 text-ink">{secret.value}</code>
            <Button variant="secondary" aria-label="Copy" onClick={() => navigator.clipboard?.writeText(secret.value)}><Copy size={13} /></Button>
          </div>
          <Button variant="ghost" className="mt-2" onClick={() => setSecret(null)}>I&apos;ve stored it safely</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-subhead font-semibold text-ink">API keys</h3>
        {adding !== 'key' && <Button variant="secondary" disabled={!data.available} onClick={() => setAdding('key')}>New API key</Button>}
      </div>
      {data.keys.length > 0 ? (
        <div tabIndex={0} role="region" aria-label="API keys" className="relative overflow-x-auto mb-3">
          <table className="w-full text-body [&_th]:text-caption">
            <caption className="sr-only">API keys</caption>
            <thead><tr className="text-left text-warm-500"><th scope="col" className="py-1.5 pr-3 font-medium">Name</th><th scope="col" className="pr-3 font-medium">Key</th><th scope="col" className="pr-3 font-medium">Role</th><th scope="col" className="pr-3 font-medium">Last used</th><th scope="col" className="pr-3 font-medium">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.keys.map(k => (
                <tr key={k.id} className="border-t border-warm-200 text-warm-700">
                  <td className="py-1.5 pr-3 font-medium text-ink">{k.name}</td>
                  <td className="pr-3 font-mono">{k.prefix}…</td>
                  <td className="pr-3">{k.role === 'viewer' ? 'Read-only' : 'Scheduler'}</td>
                  <td className="pr-3">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : 'Never'}</td>
                  <td className="pr-3">{k.revokedAt ? `Revoked ${fmtDateTime(k.revokedAt)}` : k.expiresAt ? fmtDateTime(k.expiresAt) : 'Never'}</td>
                  <td className="text-right">{!k.revokedAt && <Button variant="ghost" disabled={busy === k.id} onClick={() => { if (confirm(`Revoke “${k.name}”? Anything using it stops working immediately.`)) act(k.id, { action: 'revoke_key', id: k.id }, 'Key revoked.') }}>Revoke</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : adding !== 'key' && <p className="text-body text-warm-600 mb-3">No API keys yet.</p>}
      {adding === 'key' && (
      <form className="grid sm:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-end mb-3" onSubmit={async e => {
        e.preventDefault()
        const d = await act('key', { action: 'create_key', name: key.name, role: key.role, expiresInDays: key.expiresInDays ? Number(key.expiresInDays) : null }, 'API key created.')
        if (d) { setSecret({ label: `API key “${key.name}” created.`, value: String(d.secret) }); setKey({ ...key, name: '' }); setAdding(null) }
      }}>
        <Field label="Key name">{p => <input {...p} required maxLength={80} className={inputClass} placeholder="e.g. Power BI" value={key.name} onChange={e => setKey({ ...key, name: e.target.value })} />}</Field>
        <Field label="Access">{p => <select {...p} className={inputClass} value={key.role} onChange={e => setKey({ ...key, role: e.target.value })}><option value="viewer">Read-only</option><option value="scheduler">Scheduler (answer, generate)</option></select>}</Field>
        <Field label="Expires">{p => <select {...p} className={inputClass} value={key.expiresInDays} onChange={e => setKey({ ...key, expiresInDays: e.target.value })}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="">Never</option></select>}</Field>
        <Button type="submit" disabled={busy === 'key' || !data.available}>Create key</Button>
        <Button type="button" variant="secondary" onClick={() => setAdding(null)}>Cancel</Button>
      </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 mt-6 pt-5 border-t border-warm-200">
        <h3 className="text-subhead font-semibold text-ink">Webhooks</h3>
        {adding !== 'hook' && <Button variant="secondary" disabled={!data.available} onClick={() => setAdding('hook')}>New webhook</Button>}
      </div>
      {data.webhooks.length > 0 ? (
        <ul className="mb-3 divide-y divide-warm-200 border-y border-warm-200">
          {data.webhooks.map(h => (
            <li key={h.id} className="py-3 text-caption text-warm-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono break-all text-ink">{h.url}</div>
                  <div className="mt-0.5">{h.events.join(', ')}</div>
                  <div className="mt-0.5 text-warm-600">
                    {h.disabledAt ? <span className="text-status-at-risk font-medium">Disabled after {h.consecutiveFailures} failed deliveries. </span> : null}
                    Last delivery: {h.lastDeliveryAt ? `${fmtDateTime(h.lastDeliveryAt)} (${h.lastStatus})` : 'none yet'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy === h.id} onClick={async () => { const d = await act(h.id, { action: 'test_webhook', id: h.id }); if (d) setMsg({ tone: d.ok ? 'success' : 'error', text: `Test delivery: ${d.status}` }) }}>Send test</Button>
                  {h.disabledAt && <Button variant="secondary" disabled={busy === h.id} onClick={() => act(h.id, { action: 'enable_webhook', id: h.id }, 'Webhook re-enabled.')}>Re-enable</Button>}
                  <Button variant="ghost" disabled={busy === h.id} onClick={() => { if (confirm('Remove this webhook?')) act(h.id, { action: 'delete_webhook', id: h.id }, 'Webhook removed.') }}>Remove</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : adding !== 'hook' && <p className="text-body text-warm-600">No webhooks yet.</p>}
      {adding === 'hook' && (
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault()
        const d = await act('hook', { action: 'create_webhook', url: hook.url, events: hook.events }, 'Webhook added.')
        if (d) { setSecret({ label: 'Webhook signing secret created.', value: String(d.secret) }); setHook({ ...hook, url: '' }); setAdding(null) }
      }}>
        <Field label="Endpoint URL (HTTPS)">{p => <input {...p} required type="url" className={inputClass} placeholder="https://hooks.example.com/runf9" value={hook.url} onChange={e => setHook({ ...hook, url: e.target.value })} />}</Field>
        <fieldset>
          <legend className="block text-caption font-semibold text-warm-600 mb-1.5">Events</legend>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {data.events.map(ev => (
              <label key={ev.id} className="flex items-start gap-2 py-1 text-caption text-warm-700">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-accent-500" checked={hook.events.includes(ev.id)} onChange={e => setHook({ ...hook, events: e.target.checked ? [...hook.events, ev.id] : hook.events.filter(x => x !== ev.id) })} />
                <span><span className="font-mono text-ink">{ev.id}</span> · {ev.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy === 'hook' || !data.available}>Add webhook</Button>
          <Button type="button" variant="secondary" onClick={() => setAdding(null)}>Cancel</Button>
        </div>
      </form>
      )}
    </Section>
  )
}
