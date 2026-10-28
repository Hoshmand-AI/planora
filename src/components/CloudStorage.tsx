'use client'

// Organization > Cloud storage: connect the firm's Amazon S3 bucket, Azure Blob container or Google
// Cloud Storage bucket, then import schedules and documents from it and keep original files there.
// RunF9 tests every connection (list + write a check file) before saving it. API: /api/storage.

import { useCallback, useEffect, useState } from 'react'
import { Cloud, CheckCircle2, XCircle, Loader2, Plus, Trash2, RefreshCw } from 'lucide-react'
import { Section, Field, Button, Alert, inputClass } from '@/components/ui'

interface Connection { id: string; provider: string; providerLabel: string; name: string; location: string; canRead: boolean; canWrite: boolean; statusDetail?: string | null; checkedAt?: string | null }
type Provider = 'azure' | 'aws' | 'gcp' | 's3'

interface FieldDef { key: string; label: string; secret?: boolean; placeholder?: string; hint?: string; optional?: boolean; part: 'config' | 'secret' }

const FORMS: Record<Provider, { title: string; intro: string; fields: FieldDef[]; steps: string[]; policy?: (v: Record<string, string>) => string }> = {
  azure: {
    title: 'Microsoft Azure Blob Storage',
    intro: 'Connect a container in your (or your client’s) Azure storage account.',
    fields: [
      { key: 'account', label: 'Storage account name', placeholder: 'harborclientstorage', part: 'config' },
      { key: 'container', label: 'Container', placeholder: 'runf9', part: 'config' },
      { key: 'sas', label: 'SAS token for the container', secret: true, placeholder: 'sp=racwdl&st=…&se=…&sig=…', part: 'secret' },
      { key: 'prefix', label: 'Folder inside the container', placeholder: 'projects/', optional: true, part: 'config' },
    ],
    steps: [
      'In the Azure portal, open the storage account, then Containers, and the container RunF9 should use.',
      'Choose Shared access tokens. Signing method: Account key (or a user delegation key).',
      'Permissions: Read, Add, Create, Write, Delete and List. Allowed protocols: HTTPS only. Set an expiry date your security policy accepts.',
      'Generate the SAS token and paste it here. RunF9 encrypts it and can use only this container.',
    ],
  },
  aws: {
    title: 'Amazon S3',
    intro: 'Connect an S3 bucket in your (or your client’s) AWS account, including AWS GovCloud.',
    fields: [
      { key: 'bucket', label: 'Bucket name', placeholder: 'harbor-client-schedules', part: 'config' },
      { key: 'region', label: 'Region', placeholder: 'us-east-1', part: 'config' },
      { key: 'accessKeyId', label: 'Access key ID', placeholder: 'AKIA…', part: 'secret' },
      { key: 'secretAccessKey', label: 'Secret access key', secret: true, part: 'secret' },
      { key: 'prefix', label: 'Folder inside the bucket', placeholder: 'projects/', optional: true, part: 'config' },
    ],
    steps: [
      'In IAM, create a user (or role credentials) just for RunF9.',
      'Attach the policy below, limited to this bucket.',
      'Create an access key for that user and paste the key ID and secret here. RunF9 encrypts the secret.',
    ],
    policy: v => JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: `arn:aws:s3:::${v.bucket || 'BUCKET'}` },
        { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: `arn:aws:s3:::${v.bucket || 'BUCKET'}/${v.prefix || ''}*` },
      ],
    }, null, 2),
  },
  gcp: {
    title: 'Google Cloud Storage',
    intro: 'Connect a Cloud Storage bucket in your (or your client’s) Google Cloud project.',
    fields: [
      { key: 'bucket', label: 'Bucket name', placeholder: 'harbor-client-schedules', part: 'config' },
      { key: 'accessKeyId', label: 'HMAC key access ID', placeholder: 'GOOG1E…', part: 'secret' },
      { key: 'secretAccessKey', label: 'HMAC key secret', secret: true, part: 'secret' },
      { key: 'prefix', label: 'Folder inside the bucket', placeholder: 'projects/', optional: true, part: 'config' },
    ],
    steps: [
      'Create a service account for RunF9 and give it the Storage Object Admin role on this bucket only.',
      'In Cloud Storage, open Settings, then Interoperability, and create an HMAC key for that service account.',
      'Paste the access ID and secret here. RunF9 encrypts the secret.',
    ],
  },
  s3: {
    title: 'S3-compatible storage',
    intro: 'Storage on your own network that speaks the S3 protocol (for example MinIO or NetApp StorageGRID).',
    fields: [
      { key: 'endpoint', label: 'Storage address', placeholder: 'https://minio.example.internal:9000', part: 'config' },
      { key: 'bucket', label: 'Bucket name', part: 'config' },
      { key: 'region', label: 'Region', placeholder: 'us-east-1', optional: true, part: 'config' },
      { key: 'accessKeyId', label: 'Access key', part: 'secret' },
      { key: 'secretAccessKey', label: 'Secret key', secret: true, part: 'secret' },
      { key: 'prefix', label: 'Folder inside the bucket', placeholder: 'projects/', optional: true, part: 'config' },
    ],
    steps: ['Create a key that can list, read, write and delete in this bucket only, and paste it here.'],
  },
}

export function CloudStorage({ manage }: { manage: boolean }) {
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [providers, setProviders] = useState<{ id: Provider; label: string }[]>([])
  const [adding, setAdding] = useState<Provider | null>(null)
  const [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/storage')
    const d = await res.json().catch(() => ({}))
    setConnections(d.connections ?? [])
    setProviders(d.providers ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    return { ok: res.ok, d }
  }

  const test = async (c: Connection) => {
    setBusy(c.id); setNote(null)
    const { ok, d } = await post({ action: 'test', id: c.id })
    setBusy(null)
    setNote(ok ? { tone: d.status.read || d.status.write ? 'success' : 'error', text: `${c.name}: ${d.status.detail}` } : { tone: 'error', text: d.error || 'Test failed.' })
    load()
  }
  const remove = async (c: Connection) => {
    if (!confirm(`Disconnect ${c.name}? Files RunF9 kept there stay in your storage, but RunF9 can no longer read them.`)) return
    setBusy(c.id)
    const { ok, d } = await post({ action: 'remove', id: c.id })
    setBusy(null)
    setNote(ok ? { tone: 'success', text: `${c.name} was disconnected.` } : { tone: 'error', text: d.error || 'Could not disconnect.' })
    load()
  }

  return (
    <Section id="cloud-storage" title="Cloud storage" description="Connect your AWS, Azure or Google Cloud storage, or a client’s. Then choose it when uploading: import schedules and documents from it, and keep the original files there instead of in RunF9.">
      {note && <div className="mb-3"><Alert tone={note.tone}>{note.text}</Alert></div>}
      {connections === null ? (
        <p className="text-[13px] text-warm-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading…</p>
      ) : (
        <>
          {connections.length > 0 && (
            <ul className="divide-y divide-warm-200 rounded-xl border border-warm-200 bg-white mb-4">
              {connections.map(c => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Cloud size={18} aria-hidden className="text-accent-600 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-navy-950">{c.name} <span className="font-normal text-warm-600">· {c.providerLabel}</span></div>
                    <div className="text-[12.5px] text-warm-600 truncate">{c.location}</div>
                    <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
                      <Can ok={c.canRead} label="Import files" />
                      <Can ok={c.canWrite} label="Keep originals" />
                    </div>
                  </div>
                  {manage && (
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => test(c)} disabled={busy === c.id}><RefreshCw size={13} className="inline -mt-0.5" aria-hidden /> Test</Button>
                      <Button variant="ghost" onClick={() => remove(c)} disabled={busy === c.id}><Trash2 size={13} className="inline -mt-0.5" aria-hidden /> Disconnect</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {manage ? (
            adding ? (
              <ConnectForm provider={adding} onCancel={() => setAdding(null)} onConnected={c => { setAdding(null); setNote({ tone: 'success', text: `${c.name} is connected. ${c.statusDetail ?? ''}` }); load() }} />
            ) : (
              <div>
                <p className="text-[13px] font-semibold text-navy-950 mb-2">Connect storage</p>
                <div className="flex flex-wrap gap-2">
                  {(['azure', 'aws', 'gcp', 's3'] as Provider[]).filter(p => providers.some(x => x.id === p)).map(p => (
                    <button key={p} type="button" onClick={() => { setAdding(p); setNote(null) }}
                      className="pressable inline-flex items-center gap-1.5 rounded-full border border-warm-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-navy-950 hover:border-navy-900">
                      <Plus size={14} aria-hidden /> {p === 'azure' ? 'Microsoft Azure' : p === 'aws' ? 'Amazon S3 (AWS)' : p === 'gcp' ? 'Google Cloud Storage' : 'S3-compatible'}
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : connections.length === 0 && <p className="text-[13px] text-warm-600">No cloud storage is connected. An owner or admin can connect one.</p>}
        </>
      )}
    </Section>
  )
}

function Can({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? 'text-status-on-track' : 'text-warm-600'}`}>
      {ok ? <CheckCircle2 size={13} aria-hidden /> : <XCircle size={13} aria-hidden />}{label}{ok ? '' : ': not allowed'}
    </span>
  )
}

function ConnectForm({ provider, onCancel, onConnected }: { provider: Provider; onCancel: () => void; onConnected: (c: Connection) => void }) {
  const f = FORMS[provider]
  const [values, setValues] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const config: Record<string, string> = {}, secret: Record<string, string> = {}
    for (const d of f.fields) (d.part === 'config' ? config : secret)[d.key] = values[d.key] ?? ''
    try {
      const res = await fetch('/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect', provider, name, config, secret }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'Could not connect.'); return }
      onConnected(d.connection)
    } catch { setError('Network error. Try again.') } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-warm-200 bg-white p-5">
      <h3 className="text-[16px] font-semibold text-navy-950">{f.title}</h3>
      <p className="text-[13px] text-warm-600 mt-0.5">{f.intro}</p>
      <ol className="mt-3 list-decimal ml-5 space-y-1 text-[13px] text-warm-700">{f.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {f.policy && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-accent-600">IAM policy for this bucket</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-warm-100 p-3 text-[12px] text-navy-950">{f.policy(values)}</pre>
        </details>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Name in RunF9" hint="What your team sees when uploading, e.g. the client.">{p => <input {...p} value={name} required maxLength={80} onChange={e => setName(e.target.value)} placeholder="Harbor client (Azure)" className={inputClass} />}</Field>
        {f.fields.map(d => (
          <Field key={d.key} label={`${d.label}${d.optional ? ' (optional)' : ''}`} hint={d.hint}>{p => (
            <input {...p} type={d.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} required={!d.optional}
              value={values[d.key] ?? ''} placeholder={d.placeholder} onChange={e => setValues(v => ({ ...v, [d.key]: e.target.value }))} className={inputClass} />
          )}</Field>
        ))}
      </div>
      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>{busy ? <><Loader2 size={13} className="inline animate-spin -mt-0.5" aria-hidden /> Testing the connection…</> : 'Test and connect'}</Button>
        <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        <span className="text-[12px] text-warm-600">RunF9 lists the folder and writes, then deletes, a small check file before saving.</span>
      </div>
    </form>
  )
}
