#!/usr/bin/env node
// End-to-end checks for cloud storage connections (Organization > Cloud storage) against a running
// server and two local storage emulators:
//   npx -y s3rver@3.7.1 -a 127.0.0.1 -d /tmp/s3 -p 4569 --configure-bucket runf9-e2e &        (S3 protocol)
//   npx -y -p azurite@3.37.0 azurite-blob --blobPort 10000 -l /tmp/az --skipApiVersionCheck --disableTelemetry &   (Azure Blob)
//   RUNF9_STORAGE_CUSTOM_ENDPOINTS=true RUNF9_SIGNUP=open … next start
//   BASE_URL=http://localhost:3000 node scripts/e2e-cloud-storage.mjs
// Exercises: connecting (tested before saving; bad keys refused), secrets never returned, browsing,
// uploading with the original kept in the firm's storage, importing a schedule and a document from
// storage, reading originals back with a SHA-256 check (a changed file is refused), permissions,
// disconnecting, and audit records without secrets. Exits non-zero on the first failure.

import fs from 'node:fs'
import path from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const S3 = process.env.S3_ENDPOINT || 'http://127.0.0.1:4569'
const S3_BUCKET = process.env.S3_BUCKET || 'runf9-e2e'
const AZ = process.env.AZURE_ENDPOINT || 'http://127.0.0.1:10000'
// Azurite's well-known development account (public, documented by Microsoft; not a secret).
const AZ_ACCOUNT = 'devstoreaccount1'
const AZ_KEY = process.env.AZURITE_ACCOUNT_KEY || 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
const AZ_CONTAINER = 'runf9-e2e'
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'lib', 'parsers', '__fixtures__')
let passed = 0

function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra ?? ''); process.exit(1) }
  passed++
  console.log(`✓ ${msg}`)
}

class Client {
  constructor() { this.jar = new Map() }
  get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') }
  async raw(method, url, body, opts = {}) {
    const headers = { cookie: this.cookie, origin: BASE }
    let payload = body
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(url.startsWith('http') ? url : BASE + url, { method, headers, body: payload, ...opts })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';'); const i = pair.indexOf('=')
      const k = pair.slice(0, i), v = pair.slice(i + 1)
      if (v) this.jar.set(k, v); else this.jar.delete(k)
    }
    return res
  }
  async req(method, url, body) {
    const res = await this.raw(method, url, body)
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  get(u) { return this.req('GET', u) }
  post(u, b) { return this.req('POST', u, b ?? {}) }
}

/** A container SAS for Azurite (service SAS, version 2020-12-06 string-to-sign). */
function azureSas(perms) {
  const sv = '2020-12-06', se = new Date(Date.now() + 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const sts = [perms, '', se, `/blob/${AZ_ACCOUNT}/${AZ_CONTAINER}`, '', '', '', sv, 'c', '', '', '', '', '', '', ''].join('\n')
  const sig = createHmac('sha256', Buffer.from(AZ_KEY, 'base64')).update(sts).digest('base64')
  return new URLSearchParams({ sv, se, sr: 'c', sp: perms, sig }).toString()
}

async function ensureAzureContainer() {
  // Shared Key is simplest for a one-off create; a SAS cannot create its own container.
  const date = new Date().toUTCString(), v = '2021-08-06'
  const sts = ['PUT', '', '', '', '', '', '', '', '', '', '', '', `x-ms-date:${date}\nx-ms-version:${v}`, `/${AZ_ACCOUNT}/${AZ_ACCOUNT}/${AZ_CONTAINER}\nrestype:container`].join('\n')
  const sig = createHmac('sha256', Buffer.from(AZ_KEY, 'base64')).update(sts).digest('base64')
  const res = await fetch(`${AZ}/${AZ_ACCOUNT}/${AZ_CONTAINER}?restype=container`, { method: 'PUT', headers: { 'x-ms-date': date, 'x-ms-version': v, Authorization: `SharedKey ${AZ_ACCOUNT}:${sig}` } })
  if (![201, 409].includes(res.status)) throw new Error(`Could not create the Azurite container (HTTP ${res.status})`)
}

const sha = b => createHash('sha256').update(b).digest('hex')
const xer = fs.readFileSync(path.join(FIX, 'sample.xer'))
const spec = Buffer.from('1.3 SCHEDULE UPDATES\nThe Contractor shall update the schedule monthly. No activity duration shall exceed 20 working days.\n')

await ensureAzureContainer()

const admin = new Client()
const email = `storage${Date.now()}@example.com`
let r = await admin.post('/api/auth', { action: 'signup', email, password: 'correct horse battery staple', name: 'Sam Storage', company: 'Storage Builders' })
ok(r.status === 200, 'admin signs up', r.data)

// ── Connect ──
r = await admin.post('/api/storage', { action: 'connect', provider: 's3', name: 'Client A (S3)', config: { endpoint: S3, bucket: S3_BUCKET, region: 'us-east-1', prefix: 'projects/' }, secret: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVERSECRET1234' } })
ok(r.status === 200 && r.data.connection?.canRead && r.data.connection?.canWrite, 'S3-compatible storage connects after a read and write test', r.data)
const s3 = r.data.connection
r = await admin.post('/api/storage', { action: 'connect', provider: 'azure', name: 'Client B (Azure)', config: { endpoint: AZ, account: AZ_ACCOUNT, container: AZ_CONTAINER }, secret: { sas: azureSas('racwdl') } })
ok(r.status === 200 && r.data.connection?.canRead && r.data.connection?.canWrite, 'Azure Blob container connects with a SAS token', r.data)
const az = r.data.connection
r = await admin.post('/api/storage', { action: 'connect', provider: 'azure', name: 'Bad SAS', config: { endpoint: AZ, account: AZ_ACCOUNT, container: AZ_CONTAINER }, secret: { sas: azureSas('racwdl').replace(/sig=[^&]+/, 'sig=AAAA') } })
ok(r.status === 400 && /could not use this storage/i.test(r.data.error), 'a wrong SAS is refused before anything is saved', r.data)
r = await admin.post('/api/storage', { action: 'connect', provider: 'azure', name: 'Read only', config: { endpoint: AZ, account: AZ_ACCOUNT, container: AZ_CONTAINER }, secret: { sas: azureSas('rl') } })
ok(r.status === 200 && r.data.connection.canRead && !r.data.connection.canWrite, 'a read-only SAS connects for import only', r.data)
const readOnly = r.data.connection
r = await admin.post('/api/storage', { action: 'connect', provider: 'aws', name: 'Bad bucket', config: { bucket: 'Not_A_Bucket', region: 'us-east-1' }, secret: { accessKeyId: 'AKIAEXAMPLEEXAMPLE', secretAccessKey: 'x'.repeat(40) } })
ok(r.status === 400 && /Bucket name/.test(r.data.error), 'invalid bucket names are refused', r.data)

r = await admin.get('/api/storage')
const listed = JSON.stringify(r.data)
ok(r.status === 200 && r.data.connections.length === 3, 'connections are listed', r.data)
ok(!/S3RVERSECRET1234|sig=/.test(listed) && !listed.includes('"secret"'), 'secrets are never returned')

// ── Upload from this computer, keep the original in S3 ──
let fd = new FormData()
fd.append('file', new Blob([xer]), 'sample.xer')
fd.append('keepIn', s3.id)
r = await admin.post('/api/schedules', fd)
ok(r.status === 200 && r.data.schedule?.id, 'schedule uploads with the original kept in S3', r.data)
const first = r.data.schedule

r = await admin.get(`/api/storage/${s3.id}/objects?prefix=${encodeURIComponent('projects/runf9/schedules/')}`)
const keptKey = r.data.files?.find(f => f.key.endsWith('sample.xer'))?.key
ok(r.status === 200 && keptKey, 'the original is in the S3 bucket under projects/runf9/schedules/', r.data)

let res = await admin.raw('GET', `/api/schedules/${first.id}/export?format=original`)
let body = Buffer.from(await res.arrayBuffer())
ok(res.status === 200 && sha(body) === sha(xer), 'downloading the original reads it back from S3, byte for byte')

// ── Import from S3, keep the original in Azure ──
fd = new FormData()
fd.append('sourceConnectionId', s3.id)
fd.append('sourceKey', keptKey)
fd.append('keepIn', az.id)
fd.append('allowDuplicate', 'true')
r = await admin.post('/api/schedules', fd)
ok(r.status === 200 && r.data.schedule?.id && r.data.summary?.activitiesImported > 0, 'a schedule is imported from S3 and parsed', r.data)
const second = r.data.schedule
res = await admin.raw('GET', `/api/schedules/${second.id}/export?format=original`)
body = Buffer.from(await res.arrayBuffer())
ok(res.status === 200 && sha(body) === sha(xer), 'its original is kept in Azure and reads back intact')

fd = new FormData()
fd.append('sourceConnectionId', s3.id)
fd.append('sourceKey', 'projects/../etc/passwd')
r = await admin.post('/api/schedules', fd)
ok(r.status === 400, 'object keys with ".." are refused', r.data)
r = await admin.get(`/api/storage/${s3.id}/objects?prefix=${encodeURIComponent('other/')}`)
ok(r.status === 200 && r.data.prefix === 'projects/', 'browsing stays inside the connection folder', r.data)
fd = new FormData()
fd.append('file', new Blob([xer]), 'sample.xer')
fd.append('keepIn', readOnly.id)
r = await admin.post('/api/schedules', fd)
ok(r.status === 400 && /cannot save files/i.test(r.data.error), 'keeping a file in a read-only storage is refused before upload', r.data)

// ── A file changed in the bucket is never used as the original ──
const tampered = await fetch(`${S3}/${S3_BUCKET}/${keptKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: Buffer.from('not the uploaded file') })
ok(tampered.ok, '(test setup) the S3 object is overwritten outside RunF9')
res = await admin.raw('GET', `/api/schedules/${first.id}/export?format=original`)
r = { status: res.status, data: await res.json().catch(() => ({})) }
ok(r.status === 409 && /SHA-256 differs/.test(r.data.error), 'RunF9 refuses an original whose SHA-256 changed', r.data)

// ── Documents: import from Azure, keep the original there ──
fd = new FormData()
fd.append('file', new Blob([spec]), 'spec.txt')
fd.append('docType', 'scheduling_spec')
fd.append('keepIn', az.id)
r = await admin.post(`/api/schedules/${second.id}/documents`, fd)
ok(r.status === 200 && r.data.document?.chunkCount > 0, 'a document uploads with its original kept in Azure', r.data)
r = await admin.get(`/api/storage/${az.id}/objects?prefix=${encodeURIComponent('runf9/documents/')}`)
const docKey = r.data.files?.find(f => f.key.endsWith('spec.txt'))?.key
ok(docKey, 'the document original is in the Azure container', r.data)
fd = new FormData()
fd.append('sourceConnectionId', az.id)
fd.append('sourceKey', docKey)
fd.append('docType', 'contract')
fd.append('title', 'Imported from Azure')
r = await admin.post(`/api/schedules/${first.id}/documents`, fd)
ok(r.status === 200 && r.data.document?.title === 'Imported from Azure', 'a document is imported from Azure and indexed for search', r.data)

// ── Permissions ──
const other = new Client()
await other.post('/api/auth', { action: 'signup', email: `other${Date.now()}@example.com`, password: 'correct horse battery staple', name: 'Other Firm', company: 'Other Firm' })
r = await other.get(`/api/storage/${s3.id}/objects`)
ok(r.status === 404, 'another firm cannot browse this firm\'s storage', r.data)
fd = new FormData()
fd.append('sourceConnectionId', s3.id)
fd.append('sourceKey', keptKey)
r = await other.post('/api/schedules', fd)
ok(r.status === 404, 'another firm cannot import from this firm\'s storage', r.data)

// ── Audit and disconnect ──
r = await admin.get('/api/audit?action=storage.')
const auditText = JSON.stringify(r.data)
ok(r.status === 200 && /storage\.connected/.test(auditText) && !/S3RVERSECRET1234|sig=/.test(auditText), 'connections are audited without secrets', r.data)
r = await admin.post('/api/storage', { action: 'remove', id: az.id })
ok(r.status === 200, 'a connection is disconnected')
res = await admin.raw('GET', `/api/schedules/${second.id}/export?format=original`)
r = { status: res.status, data: await res.json().catch(() => ({})) }
ok(r.status === 409 && /no longer connected/.test(r.data.error), 'an original kept in a disconnected storage says where it is', r.data)
r = await admin.get('/api/storage')
ok(r.data.connections.every(c => c.id !== az.id), 'the disconnected storage is no longer offered')

// ── Sign-in instead of keys (Microsoft, Google, AWS role), against scripts/mock-cloud.mjs ──
const MOCK = process.env.MOCK_CLOUD_URL
if (MOCK) {
  r = await admin.get('/api/storage')
  ok(r.data.signIn?.azure && r.data.signIn?.gcp && r.data.signIn?.aws && /^runf9-[0-9a-f]{32}$/.test(r.data.aws?.externalId), 'sign-in with Microsoft, Google and AWS is offered, with this firm\'s AWS external ID', r.data)

  /** Starts a sign-in, follows the provider's redirect back to RunF9, returns RunF9's final redirect. */
  async function signIn(provider, name, config, hint) {
    const s = await admin.post('/api/storage', { action: 'oauth_start', provider, name, config })
    if (s.status !== 200) { console.error('oauth_start failed', s.status, s.data); return { start: s } }
    const authorize = new URL(s.data.url)
    if (hint) authorize.searchParams.set('login_hint', hint)
    const idp = await fetch(authorize, { redirect: 'manual' })
    const callback = new URL(idp.headers.get('location'))
    const done = await admin.raw('GET', callback.pathname + callback.search, undefined, { redirect: 'manual' })
    return { start: s, authorize, location: done.headers.get('location') || '', status: done.status }
  }

  let x = await signIn('azure', 'Client C (Microsoft sign-in)', { account: 'clientc', container: 'schedules', endpoint: `${MOCK}/blob` })
  ok(x.authorize.searchParams.get('code_challenge_method') === 'S256' && x.authorize.searchParams.get('scope') === 'https://storage.azure.com/user_impersonation offline_access' && !x.authorize.searchParams.has('client_secret'), 'Microsoft sign-in uses PKCE and asks only for storage access')
  ok(x.status === 303 && /storage=connected/.test(x.location), 'signing in with Microsoft connects the Azure container', x)
  x = await signIn('gcp', 'Client D (Google sign-in)', { bucket: 'client-d', endpoint: `${MOCK}/gcs` })
  ok(x.status === 303 && /storage=connected/.test(x.location) && x.authorize.searchParams.get('access_type') === 'offline', 'signing in with Google connects the Cloud Storage bucket', x)
  x = await signIn('azure', 'Cancelled', { account: 'clientc', container: 'schedules', endpoint: `${MOCK}/blob` }, 'deny@example.com')
  ok(/storage_error=/.test(x.location) && /cancelled/i.test(decodeURIComponent(x.location)), 'a cancelled sign-in says so and saves nothing', x)

  // A forged callback without the sign-in cookie is refused.
  const forged = await new Client().raw('GET', '/api/storage/oauth/callback?code=x&state=y', undefined, { redirect: 'manual' })
  ok(forged.status === 401 || forged.status === 403 || /storage_error=/.test(forged.headers.get('location') || ''), 'a callback without a signed-in admin and the sign-in cookie is refused')

  r = await admin.get('/api/storage')
  const ms = r.data.connections.find(c => c.name === 'Client C (Microsoft sign-in)')
  const goog = r.data.connections.find(c => c.name === 'Client D (Google sign-in)')
  ok(ms?.canRead && ms?.canWrite && goog?.canRead && goog?.canWrite && !JSON.stringify(r.data).includes('refresh'), 'signed-in storages can import and keep originals; refresh tokens are never returned', r.data)

  // Project mailbox: sign in with Microsoft, name one Outlook folder, RunF9 copies its new emails.
  {
    const mb = `/api/schedules/${first.id}/mailbox`
    r = await admin.get(mb)
    ok(r.status === 200 && r.data.offered && r.data.canConnect && r.data.mailboxes.length === 0, 'a project mailbox is offered where Microsoft sign-in is set up', r.data)
    const connect = async folder => {
      const s = await admin.post(mb, { action: 'connect_start', folder })
      if (s.status !== 200) return { start: s, location: '' }
      const authorize = new URL(s.data.url)
      const idp = await fetch(authorize, { redirect: 'manual' })
      const callback = new URL(idp.headers.get('location'))
      const done = await admin.raw('GET', callback.pathname + callback.search, undefined, { redirect: 'manual' })
      return { start: s, authorize, status: done.status, location: done.headers.get('location') || '' }
    }
    r = await admin.post(mb, { action: 'connect_start', folder: '  ' })
    ok(r.status === 400, 'a mailbox needs a folder name')
    let m = await connect('No Such Folder')
    ok(/mailbox_error=/.test(m.location) && /no top-level mail folder/i.test(decodeURIComponent(m.location)), 'a folder that does not exist is refused, and nothing is saved', m.location)
    m = await connect('runf9  project')
    ok(m.authorize.searchParams.get('scope') === 'https://graph.microsoft.com/Mail.Read offline_access' && m.authorize.searchParams.get('code_challenge_method') === 'S256', 'the mailbox sign-in asks only to read mail, with PKCE', m.authorize?.search)
    ok(m.status === 303 && /\/dashboard\/documents\?mailbox=connected/.test(m.location), 'signing in with Microsoft connects the folder (name matched without regard to case)', m.location)
    r = await admin.get(mb)
    const box = r.data.mailboxes[0]
    ok(r.data.mailboxes.length === 1 && box.address === 'pm@contoso.example' && box.folderName === 'RunF9 Project' && box.received === 1 && /1 new message/.test(box.lastStatus) && /1 skipped/.test(box.lastStatus) && !JSON.stringify(r.data).includes('refresh'),
      'the first read copies the new email, skips the marked one, and never returns the sign-in', r.data)
    r = await admin.get(`/api/schedules/${first.id}/documents`)
    const titles = (r.data.documents || []).map(d => d.title)
    ok(titles.includes('Switchgear delivery') && !titles.some(t => /CUI|Private|Old thread/.test(t)), 'the email is a project document; the marked, the private and the 90-day-old ones are not', titles)
    r = await admin.post(mb, { action: 'sync', mailboxId: box.id })
    ok(r.status === 200 && r.data.received === 0 && /Up to date/.test(r.data.status), 'reading again finds nothing new', r.data)
    const g = (await (await fetch(`${MOCK}/stats`)).json()).graph
    ok(g.folders.length >= 2 && g.folders.every(f => f === 'fld-runf9') && g.messages === 2, 'RunF9 asked Microsoft only for the named folder (never the Inbox)', g)
    m = await connect('RunF9 Project')
    ok(/mailbox_error=/.test(m.location) && /already connected/i.test(decodeURIComponent(m.location)), 'the same folder cannot be connected twice', m.location)
    const outsider = new Client()
    await outsider.post('/api/auth', { action: 'signup', email: `outsider${Date.now()}@example.com`, password: 'correct horse battery staple', name: 'Outsider', company: 'Another Firm' })
    ok((await outsider.get(mb)).status === 404 && (await outsider.post(mb, { action: 'sync', mailboxId: box.id })).status === 404 && (await outsider.raw('DELETE', `${mb}?mailboxId=${box.id}`)).status === 404, 'another firm cannot see, read or disconnect the mailbox')
    r = await admin.post(mb, { action: 'sync', mailboxId: 'nope' })
    ok(r.status === 404, 'an unknown mailbox cannot be read')
    r = await admin.raw('DELETE', `${mb}?mailboxId=${box.id}`)
    ok(r.status === 200, 'an admin disconnects the mailbox', r.status)
    r = await admin.post(mb, { action: 'sync', mailboxId: box.id })
    ok(r.status === 404, 'a disconnected mailbox is no longer read')
    r = await admin.get(`/api/schedules/${first.id}/documents`)
    ok((r.data.documents || []).some(d => d.title === 'Switchgear delivery'), 'emails already copied stay after disconnecting')
  }

  // AWS: the one-click role, then connect with the role ARN.
  r = await admin.post('/api/storage', { action: 'aws_launch', provider: 'aws', config: { bucket: 'client-e', region: 'us-east-1', prefix: 'projects/' } })
  const launch = r.data.launchUrl && new URLSearchParams(r.data.launchUrl.split('#/stacks/quickcreate?')[1])
  ok(r.status === 200 && launch?.get('param_ExternalId') === r.data.externalId && launch.get('param_BucketName') === 'client-e' && launch.get('templateURL'), 'AWS: the one-click link opens CloudFormation with the bucket and this firm\'s external ID filled in', r.data)
  r = await admin.post('/api/storage', { action: 'connect_role', provider: 'aws', name: 'Client E (AWS role)', config: { bucket: 'client-e', region: 'us-east-1', prefix: 'projects/', endpoint: `${MOCK}/s3`, roleArn: 'arn:aws:iam::111122223333:role/RunF9-Storage-client-e' } })
  ok(r.status === 200 && r.data.connection?.canRead && r.data.connection?.canWrite, 'AWS: RunF9 assumes the role (no keys) and connects the bucket', r.data)
  const role = r.data.connection
  r = await admin.post('/api/storage', { action: 'connect_role', provider: 'aws', name: 'Denied', config: { bucket: 'client-e', region: 'us-east-1', endpoint: `${MOCK}/s3`, roleArn: 'arn:aws:iam::111122223333:role/denied' } })
  ok(r.status === 400 && /refused|could not use/i.test(r.data.error), 'AWS: a role RunF9 may not assume is refused', r.data)
  r = await admin.post('/api/storage', { action: 'connect_role', provider: 'aws', name: 'Bad', config: { bucket: 'client-e', region: 'us-east-1', roleArn: 'not-an-arn' } })
  ok(r.status === 400 && /role ARN/.test(r.data.error), 'AWS: a malformed role ARN is refused', r.data)

  // Use each: keep an original there, read it back (tokens refresh; Microsoft's rotate and are saved).
  const before = await (await fetch(`${MOCK}/stats`)).json()
  for (const c of [ms, goog, role]) {
    fd = new FormData()
    fd.append('file', new Blob([xer]), 'sample.xer')
    fd.append('keepIn', c.id)
    fd.append('allowDuplicate', 'true')
    r = await admin.post('/api/schedules', fd)
    ok(r.status === 200, `upload keeps its original in ${c.name}`, r.data)
    for (let i = 0; i < 2; i++) {
      res = await admin.raw('GET', `/api/schedules/${r.data.schedule.id}/export?format=original`)
      body = Buffer.from(await res.arrayBuffer())
      ok(res.status === 200 && sha(body) === sha(xer), `${c.name}: the original reads back intact (${i + 1})`)
    }
  }
  const after = await (await fetch(`${MOCK}/stats`)).json()
  ok(after.refreshes.azure > before.refreshes.azure && after.refreshes.gcp > before.refreshes.gcp && after.assumeRole >= before.assumeRole, 'access tokens were refreshed; rotated Microsoft refresh tokens were saved (later reads still work)', { before, after })
  r = await admin.get('/api/audit?action=storage.')
  ok(!/-rt-|refresh_token|session-/.test(JSON.stringify(r.data)) && /"auth":"oauth"/.test(JSON.stringify(r.data)) && /"auth":"role"/.test(JSON.stringify(r.data)), 'sign-ins are audited without tokens', r.data)
}

console.log(`\n${passed} cloud storage checks passed.`)
