#!/usr/bin/env node
// End-to-end checks for cloud storage connections (Organization > Cloud storage) against a running
// server and two local storage emulators:
//   npx -y s3rver@3.7.1 -d /tmp/s3 -p 4569 --configure-bucket runf9-e2e &        (S3 protocol)
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
  constructor() { this.cookie = '' }
  async raw(method, url, body) {
    const headers = { cookie: this.cookie, origin: BASE }
    let payload = body
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers, body: payload })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
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

console.log(`\n${passed} cloud storage checks passed.`)
