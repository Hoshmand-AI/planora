'use client'

// Organization > Cloud storage: connect the firm's Amazon S3 bucket, Azure Blob container or Google
// Cloud Storage bucket, then import schedules and documents from it and keep original files there.
// RunF9 tests every connection (list + write a check file) before saving it. API: /api/storage.

import { useCallback, useEffect, useState } from 'react'
import { Cloud, CheckCircle2, XCircle, Loader2, Plus, Trash2, RefreshCw } from 'lucide-react'
import { Section, Field, Button, Alert, inputClass } from '@/components/ui'

interface Connection { id: string; provider: string; providerLabel: string; name: string; location: string; canRead: boolean; canWrite: boolean; statusDetail?: string | null; checkedAt?: string | null }
type Provider = 'azure' | 'aws' | 'gcp' | 's3'

type SignIn = { azure: boolean; gcp: boolean; aws: boolean }
interface AwsInfo { externalId: string; oneClick: boolean; templatePath: string; accountId?: string }

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
  const [signIn, setSignIn] = useState<SignIn>({ azure: false, gcp: false, aws: false })
  const [aws, setAws] = useState<AwsInfo | null>(null)
  const [useKey, setUseKey] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/storage')
    const d = await res.json().catch(() => ({}))
    setConnections(d.connections ?? [])
    setProviders(d.providers ?? [])
    setSignIn(d.signIn ?? { azure: false, gcp: false, aws: false })
    setAws(d.aws ?? null)
  }, [])
  useEffect(() => { load() }, [load])
  // Back from a Microsoft or Google sign-in (/api/storage/oauth/callback).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('storage') === 'connected') setNote({ tone: 'success', text: `${q.get('name') || 'The storage'} is connected.` })
    else if (q.get('storage_error')) setNote({ tone: 'error', text: q.get('storage_error')! })
    if (q.has('storage') || q.has('storage_error')) window.history.replaceState(null, '', `${window.location.pathname}#cloud-storage`)
  }, [])
  const canSignIn = (p: Provider) => p !== 's3' && signIn[p]

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
              canSignIn(adding) && !useKey ? (
                <SignInForm provider={adding as 'azure' | 'gcp' | 'aws'} aws={aws} onUseKey={() => setUseKey(true)} onCancel={() => setAdding(null)}
                  onConnected={c => { setAdding(null); setNote({ tone: 'success', text: `${c.name} is connected. ${c.statusDetail ?? ''}` }); load() }} />
              ) : (
                <ConnectForm provider={adding} onCancel={() => setAdding(null)} onSignIn={canSignIn(adding) ? () => setUseKey(false) : undefined}
                  onConnected={c => { setAdding(null); setNote({ tone: 'success', text: `${c.name} is connected. ${c.statusDetail ?? ''}` }); load() }} />
              )
            ) : (
              <div>
                <p className="text-[13px] font-semibold text-navy-950 mb-2">Connect storage</p>
                <div className="flex flex-wrap gap-2">
                  {(['azure', 'aws', 'gcp', 's3'] as Provider[]).filter(p => providers.some(x => x.id === p)).map(p => (
                    <button key={p} type="button" onClick={() => { setAdding(p); setUseKey(false); setNote(null) }}
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

function ConnectForm({ provider, onCancel, onConnected, onSignIn }: { provider: Provider; onCancel: () => void; onConnected: (c: Connection) => void; onSignIn?: () => void }) {
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
        {onSignIn && <Button variant="ghost" type="button" onClick={onSignIn}>{provider === 'aws' ? 'Use a role instead' : 'Sign in instead'}</Button>}
        <span className="text-[12px] text-warm-600">RunF9 lists the folder and writes, then deletes, a small check file before saving.</span>
      </div>
    </form>
  )
}

const SIGN_IN: Record<'azure' | 'gcp' | 'aws', { title: string; intro: string; button: string; fields: FieldDef[]; needs: string }> = {
  azure: {
    title: 'Microsoft Azure Blob Storage',
    intro: 'Sign in with your Microsoft work account. RunF9 then uses the container as you, with no keys to copy.',
    button: 'Sign in with Microsoft',
    fields: [
      { key: 'account', label: 'Storage account name', placeholder: 'harborclientstorage', part: 'config' },
      { key: 'container', label: 'Container', placeholder: 'runf9', part: 'config' },
      { key: 'prefix', label: 'Folder inside the container', placeholder: 'projects/', optional: true, part: 'config' },
    ],
    needs: 'Your account needs the "Storage Blob Data Contributor" role on the container (Azure portal > container > Access control).',
  },
  gcp: {
    title: 'Google Cloud Storage',
    intro: 'Sign in with your Google account. RunF9 then uses the bucket as you, with no keys to copy.',
    button: 'Sign in with Google',
    fields: [
      { key: 'bucket', label: 'Bucket name', placeholder: 'harbor-client-schedules', part: 'config' },
      { key: 'prefix', label: 'Folder inside the bucket', placeholder: 'projects/', optional: true, part: 'config' },
    ],
    needs: 'Your account needs the "Storage Object Admin" role on the bucket.',
  },
  aws: {
    title: 'Amazon S3',
    intro: 'Create a role for RunF9 in your AWS account with one click, then paste its ARN. No access keys are created or shared.',
    button: 'Create the role in AWS',
    fields: [
      { key: 'bucket', label: 'Bucket name', placeholder: 'harbor-client-schedules', part: 'config' },
      { key: 'region', label: 'Region', placeholder: 'us-east-1', part: 'config' },
      { key: 'prefix', label: 'Folder inside the bucket', placeholder: 'projects/', optional: true, part: 'config' },
    ],
    needs: 'The role can only list, read, write and delete in this bucket (or folder), and only RunF9 with your organization\'s external ID can use it.',
  },
}

/** Connect by signing in (Azure, Google) or with a one-click AWS role, instead of pasting keys. */
function SignInForm({ provider, aws, onUseKey, onCancel, onConnected }: { provider: 'azure' | 'gcp' | 'aws'; aws: AwsInfo | null; onUseKey: () => void; onCancel: () => void; onConnected: (c: Connection) => void }) {
  const f = SIGN_IN[provider]
  const [values, setValues] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [launch, setLaunch] = useState<{ launchUrl: string | null; templatePath: string; consoleUrl: string; externalId: string } | null>(null)
  const [roleArn, setRoleArn] = useState('')

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { ok: res.ok, d: await res.json().catch(() => ({})) }
  }
  const config = () => Object.fromEntries(f.fields.map(d => [d.key, values[d.key] ?? '']))

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (provider === 'aws') {
        const { ok, d } = await post({ action: 'aws_launch', provider, config: config() })
        if (!ok) { setError(d.error || 'Could not prepare the role.'); return }
        setLaunch(d)
        if (d.launchUrl) window.open(d.launchUrl, '_blank', 'noopener')
      } else {
        const { ok, d } = await post({ action: 'oauth_start', provider, name, config: config() })
        if (!ok) { setError(d.error || 'Could not start the sign-in.'); return }
        window.location.assign(d.url)
      }
    } catch { setError('Network error. Try again.') } finally { setBusy(false) }
  }
  const connectRole = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const { ok, d } = await post({ action: 'connect_role', provider: 'aws', name, config: { ...config(), roleArn } })
      if (!ok) { setError(d.error || 'Could not connect.'); return }
      onConnected(d.connection)
    } catch { setError('Network error. Try again.') } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-warm-200 bg-white p-5">
      <form onSubmit={start}>
        <h3 className="text-[16px] font-semibold text-navy-950">{f.title}</h3>
        <p className="text-[13px] text-warm-600 mt-0.5">{f.intro}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Name in RunF9" hint="What your team sees when uploading, e.g. the client.">{p => <input {...p} value={name} required maxLength={80} onChange={e => setName(e.target.value)} placeholder={`Harbor client (${provider === 'azure' ? 'Azure' : provider === 'gcp' ? 'Google' : 'AWS'})`} className={inputClass} />}</Field>
          {f.fields.map(d => (
            <Field key={d.key} label={`${d.label}${d.optional ? ' (optional)' : ''}`}>{p => (
              <input {...p} type="text" autoComplete="off" spellCheck={false} required={!d.optional} disabled={!!launch}
                value={values[d.key] ?? ''} placeholder={d.placeholder} onChange={e => setValues(v => ({ ...v, [d.key]: e.target.value }))} className={inputClass} />
            )}</Field>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-warm-600">{f.needs}</p>
        {!launch && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy}>{busy ? <><Loader2 size={13} className="inline animate-spin -mt-0.5" aria-hidden /> One moment…</> : f.button}</Button>
            <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
            <Button variant="ghost" type="button" onClick={onUseKey}>{provider === 'azure' ? 'Use a SAS token instead' : 'Use a key instead'}</Button>
          </div>
        )}
      </form>
      {launch && (
        <form onSubmit={connectRole} className="mt-4 border-t border-warm-200 pt-4">
          <ol className="list-decimal ml-5 space-y-1.5 text-[13px] text-warm-700">
            {launch.launchUrl ? (
              <li>AWS opened in a new tab with the stack filled in. <a href={launch.launchUrl} target="_blank" rel="noopener noreferrer" className="text-accent-600 underline">Open it again</a>. Tick &ldquo;I acknowledge that AWS CloudFormation might create IAM resources&rdquo; and choose <strong>Create stack</strong>.</li>
            ) : (
              <li><a href={launch.templatePath} download className="text-accent-600 underline">Download the template</a>, then <a href={launch.consoleUrl} target="_blank" rel="noopener noreferrer" className="text-accent-600 underline">create a stack in CloudFormation</a> from it. Enter RunF9&apos;s account ID {aws?.accountId ?? ''}, the external ID <code className="rounded bg-warm-100 px-1">{launch.externalId}</code>, the bucket and the folder.</li>
            )}
            <li>When the stack shows CREATE_COMPLETE, open its <strong>Outputs</strong> and copy <strong>RoleArn</strong>.</li>
            <li>Paste it below.</li>
          </ol>
          <div className="mt-3 max-w-xl">
            <Field label="Role ARN">{p => <input {...p} value={roleArn} required onChange={e => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/RunF9-Storage-…" spellCheck={false} className={inputClass} />}</Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy}>{busy ? <><Loader2 size={13} className="inline animate-spin -mt-0.5" aria-hidden /> Testing the connection…</> : 'Test and connect'}</Button>
            <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      )}
      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}
    </div>
  )
}
