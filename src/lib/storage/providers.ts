// Cloud storage a firm connects to RunF9 (Organization > Cloud storage): Amazon S3, Azure Blob
// Storage, Google Cloud Storage, or an S3-compatible store on the firm's own network. RunF9 can
// import schedules and documents from it and keep original files in it instead of RunF9's database.
//
// Plain HTTPS, no cloud SDKs. Destinations are built from validated names (bucket, region, storage
// account), never from a free-form URL, except an S3-compatible endpoint, which only a private
// deployment may use (or RUNF9_STORAGE_CUSTOM_ENDPOINTS=true for tests). Every request also passes
// the air-gapped egress rule (src/lib/server/egress.ts), and redirects are never followed.

import { egressProblem } from '@/lib/server/egress'
import { deploymentKind } from '@/lib/llm/provider'
import { signV4, uriEncode } from './sigv4'

type Env = Record<string, string | undefined>

export const PROVIDERS = ['aws', 'azure', 'gcp', 's3'] as const
export type StorageProvider = typeof PROVIDERS[number]
export const PROVIDER_LABEL: Record<StorageProvider, string> = { aws: 'Amazon S3', azure: 'Azure Blob Storage', gcp: 'Google Cloud Storage', s3: 'S3-compatible storage' }

export interface StorageConfig {
  bucket?: string      // aws, gcp, s3
  region?: string      // aws, s3
  account?: string     // azure storage account
  container?: string   // azure
  endpoint?: string    // s3 (and azure in tests): https://host[:port]
  prefix?: string      // folder inside the bucket/container, e.g. "runf9/"
}
export interface StorageSecret { accessKeyId?: string; secretAccessKey?: string; sas?: string }

export interface ObjectEntry { key: string; size: number; modified: string | null }
export interface Listing { folders: string[]; files: ObjectEntry[] }

export class StorageError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const GCS_BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/
const REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d{1,2}$/
const ACCOUNT = /^[a-z0-9]{3,24}$/
const CONTAINER = /^(?!.*--)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

export const customEndpointsAllowed = (env: Env = process.env) =>
  deploymentKind(env) !== 'commercial_cloud' || /^(1|true|yes)$/i.test(env.RUNF9_STORAGE_CUSTOM_ENDPOINTS || '')

const clean = (s: unknown, max = 300) => (typeof s === 'string' ? s.trim().slice(0, max) : '')

function normalizePrefix(p: string): string {
  const s = p.replace(/^\/+/, '').replace(/\/{2,}/g, '/')
  if (/[\u0000-\u001f]|(^|\/)\.\.?(\/|$)/.test(s)) throw new StorageError('The folder must be a plain path such as runf9/ (no "..").')
  return s && !s.endsWith('/') ? `${s}/` : s
}

function normalizeEndpoint(raw: string, env: Env): string {
  if (!customEndpointsAllowed(env)) throw new StorageError('A custom storage address is only available in a private RunF9 deployment.')
  let u: URL
  try { u = new URL(raw) } catch { throw new StorageError('The storage address must be a URL such as https://storage.example.internal:9000.') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new StorageError('The storage address must start with https://.')
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) throw new StorageError('Give only the address (scheme, host and port), without a path or credentials.')
  return `${u.protocol}//${u.host}`
}

/** Validates what an admin entered; returns the normalized config and secret, or throws StorageError. */
export function validateConnection(provider: string, config: Record<string, unknown>, secret: Record<string, unknown>, env: Env = process.env): { provider: StorageProvider; config: StorageConfig; secret: StorageSecret } {
  if (!(PROVIDERS as readonly string[]).includes(provider)) throw new StorageError(`Provider must be one of ${PROVIDERS.join(', ')}.`)
  const p = provider as StorageProvider
  const prefix = normalizePrefix(clean(config.prefix, 200))
  const endpoint = clean(config.endpoint, 200)
  if (p === 'azure') {
    const account = clean(config.account, 24).toLowerCase(), container = clean(config.container, 63).toLowerCase()
    if (!endpoint && !ACCOUNT.test(account)) throw new StorageError('Storage account name: 3 to 24 lowercase letters and numbers.')
    if (!CONTAINER.test(container)) throw new StorageError('Container name: 3 to 63 lowercase letters, numbers and hyphens.')
    const sas = clean(secret.sas, 2000).replace(/^\?/, '')
    if (!/(^|&)sig=/.test(sas) || !/(^|&)sp=/.test(sas)) throw new StorageError('Paste a SAS token for the container (it contains sp= and sig=).')
    return { provider: p, config: { account, container, prefix, ...(endpoint ? { endpoint: normalizeEndpoint(endpoint, env) } : {}) }, secret: { sas } }
  }
  const bucket = clean(config.bucket, 222)
  if (!(p === 'gcp' ? GCS_BUCKET : BUCKET).test(bucket)) throw new StorageError('Bucket name: lowercase letters, numbers, dots and hyphens.')
  const accessKeyId = clean(secret.accessKeyId, 128), secretAccessKey = clean(secret.secretAccessKey, 256)
  // AWS key IDs are 20 characters and GCS HMAC IDs longer; on-premises stores (MinIO…) allow short keys.
  if (!(p === 's3' ? /^[A-Za-z0-9._-]{3,128}$/ : /^[A-Za-z0-9]{16,128}$/).test(accessKeyId)) throw new StorageError(p === 'gcp' ? 'Enter the HMAC key access ID.' : 'Enter the access key ID.')
  if (secretAccessKey.length < (p === 's3' ? 6 : 16)) throw new StorageError(p === 'gcp' ? 'Enter the HMAC key secret.' : 'Enter the secret access key.')
  if (p === 'gcp') return { provider: p, config: { bucket, prefix }, secret: { accessKeyId, secretAccessKey } }
  const region = clean(config.region, 30) || 'us-east-1'
  if (!REGION.test(region) && !(p === 's3' && /^[a-z0-9-]{2,30}$/.test(region))) throw new StorageError('Region, for example us-east-1 or us-gov-west-1.')
  if (p === 's3') {
    if (!endpoint) throw new StorageError('Enter the storage address, for example https://minio.example.internal:9000.')
    return { provider: p, config: { bucket, region, prefix, endpoint: normalizeEndpoint(endpoint, env) }, secret: { accessKeyId, secretAccessKey } }
  }
  return { provider: p, config: { bucket, region, prefix }, secret: { accessKeyId, secretAccessKey } }
}

/** Where a connection's objects live, in words (no secrets). */
export function describeLocation(provider: StorageProvider, c: StorageConfig): string {
  const folder = c.prefix ? `/${c.prefix}` : ''
  if (provider === 'azure') return `${c.endpoint ?? `${c.account}.blob.core.windows.net`}/${c.container}${folder}`
  if (provider === 'gcp') return `gs://${c.bucket}${folder}`
  if (provider === 's3') return `${c.endpoint}/${c.bucket}${folder}`
  return `s3://${c.bucket}${folder} (${c.region})`
}

/* ─── Client ──────────────────────────────────────────────── */

export interface StorageClient {
  list(prefix?: string): Promise<Listing>
  get(key: string, maxBytes: number): Promise<Buffer>
  put(key: string, body: Buffer, contentType?: string): Promise<void>
  del(key: string): Promise<void>
}

const TIMEOUT_MS = 20_000

/** Object keys a user picked or RunF9 built: no control characters, no "..", within the size S3 allows. */
export function checkKey(key: string): string {
  if (!key || key.length > 1024 || /[\u0000-\u001f\u007f\\]/.test(key) || /(^|\/)\.\.?(\/|$)/.test(key) || key.startsWith('/')) throw new StorageError('That file name is not allowed.')
  return key
}

async function send(url: string, init: RequestInit, env: Env): Promise<Response> {
  const problem = egressProblem(url, env)
  if (problem) throw new StorageError(problem, 403)
  let res: Response
  try {
    res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  } catch (e) {
    throw new StorageError(`Could not reach the storage service (${(e as Error).name === 'TimeoutError' ? 'timed out' : 'connection failed'}).`, 502)
  }
  if (res.status >= 300 && res.status < 400) throw new StorageError('The storage service redirected the request; check the bucket region or address.', 502)
  return res
}

async function failure(res: Response, what: string): Promise<StorageError> {
  const text = await res.text().catch(() => '')
  const code = /<Code>([^<]{1,80})<\/Code>/.exec(text)?.[1]
  if (res.status === 403 || res.status === 401) return new StorageError(`Access denied ${what}${code ? ` (${code})` : ''}. Check the key and its permissions.`, 403)
  if (res.status === 404) return new StorageError(`Not found ${what}${code ? ` (${code})` : ''}. Check the bucket or container name.`, 404)
  return new StorageError(`The storage service refused ${what} (HTTP ${res.status}${code ? `, ${code}` : ''}).`, 502)
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'))
  if (declared && declared > maxBytes) throw new StorageError('The file is larger than the upload limit.', 413)
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const parts: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new StorageError('The file is larger than the upload limit.', 413) }
    parts.push(Buffer.from(value))
  }
  return Buffer.concat(parts)
}

const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const all = (xml: string, re: RegExp) => [...xml.matchAll(re)].map(m => m[1])

function s3Client(provider: 'aws' | 'gcp' | 's3', c: StorageConfig, s: StorageSecret, env: Env): StorageClient {
  const region = provider === 'gcp' ? 'auto' : c.region || 'us-east-1'
  // Path-style for GCS, S3-compatible stores and bucket names with dots; virtual-hosted otherwise.
  const base = provider === 'gcp' ? `https://storage.googleapis.com/${c.bucket}`
    : provider === 's3' ? `${c.endpoint}/${c.bucket}`
    : c.bucket!.includes('.') ? `https://s3.${region}.amazonaws.com/${c.bucket}` : `https://${c.bucket}.s3.${region}.amazonaws.com`
  const req = async (method: string, key: string, query: Record<string, string> = {}, body?: Buffer, headers: Record<string, string> = {}) => {
    const url = new URL(`${base}/${uriEncode(key, true)}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    // Keep the signed query encoding identical to what is sent.
    const qs = [...url.searchParams.entries()].map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&')
    const signed = signV4({ method, url, region, accessKeyId: s.accessKeyId!, secretAccessKey: s.secretAccessKey!, body, headers })
    return send(`${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`, { method, headers: signed, body: body ? new Uint8Array(body) : undefined }, env)
  }
  return {
    async list(prefix = c.prefix ?? '') {
      // An empty prefix is left out: some S3-compatible stores list nothing for "prefix=".
      const res = await req('GET', '', { delimiter: '/', 'max-keys': '500', ...(prefix ? { prefix } : {}) })
      if (!res.ok) throw await failure(res, 'listing the bucket')
      const xml = await res.text()
      const files = all(xml, /<Contents>([\s\S]*?)<\/Contents>/g).map(b => ({
        key: xmlText(/<Key>([\s\S]*?)<\/Key>/.exec(b)?.[1] ?? ''),
        size: Number(/<Size>(\d+)<\/Size>/.exec(b)?.[1] ?? 0),
        modified: /<LastModified>([^<]+)<\/LastModified>/.exec(b)?.[1] ?? null,
      })).filter(f => f.key && !f.key.endsWith('/'))
      const folders = all(xml, /<CommonPrefixes>\s*<Prefix>([\s\S]*?)<\/Prefix>\s*<\/CommonPrefixes>/g).map(xmlText)
      return { folders, files }
    },
    async get(key, maxBytes) {
      const res = await req('GET', checkKey(key))
      if (!res.ok) throw await failure(res, `reading ${key}`)
      return readLimited(res, maxBytes)
    },
    async put(key, body, contentType = 'application/octet-stream') {
      const res = await req('PUT', checkKey(key), {}, body, { 'content-type': contentType })
      if (!res.ok) throw await failure(res, `saving ${key}`)
    },
    async del(key) {
      const res = await req('DELETE', checkKey(key))
      if (!res.ok && res.status !== 404) throw await failure(res, `deleting ${key}`)
    },
  }
}

const AZURE_VERSION = '2021-08-06'

function azureClient(c: StorageConfig, s: StorageSecret, env: Env): StorageClient {
  const base = c.endpoint ? `${c.endpoint}/${c.account || 'devstoreaccount1'}/${c.container}` : `https://${c.account}.blob.core.windows.net/${c.container}`
  const url = (key: string, extra = '') => `${base}${key ? `/${uriEncode(key, true)}` : ''}?${extra ? `${extra}&` : ''}${s.sas}`
  const h = (more: Record<string, string> = {}) => ({ 'x-ms-version': AZURE_VERSION, ...more })
  return {
    async list(prefix = c.prefix ?? '') {
      const res = await send(url('', `restype=container&comp=list&delimiter=%2F&maxresults=500&prefix=${uriEncode(prefix)}`), { headers: h() }, env)
      if (!res.ok) throw await failure(res, 'listing the container')
      const xml = await res.text()
      const files = all(xml, /<Blob>([\s\S]*?)<\/Blob>/g).map(b => ({
        key: xmlText(/<Name>([\s\S]*?)<\/Name>/.exec(b)?.[1] ?? ''),
        size: Number(/<Content-Length>(\d+)<\/Content-Length>/.exec(b)?.[1] ?? 0),
        modified: (() => { const d = /<Last-Modified>([^<]+)<\/Last-Modified>/.exec(b)?.[1]; return d ? new Date(d).toISOString() : null })(),
      })).filter(f => f.key)
      const folders = all(xml, /<BlobPrefix>\s*<Name>([\s\S]*?)<\/Name>\s*<\/BlobPrefix>/g).map(xmlText)
      return { folders, files }
    },
    async get(key, maxBytes) {
      const res = await send(url(checkKey(key)), { headers: h() }, env)
      if (!res.ok) throw await failure(res, `reading ${key}`)
      return readLimited(res, maxBytes)
    },
    async put(key, body, contentType = 'application/octet-stream') {
      const res = await send(url(checkKey(key)), { method: 'PUT', headers: h({ 'x-ms-blob-type': 'BlockBlob', 'content-type': contentType }), body: new Uint8Array(body) }, env)
      if (!res.ok) throw await failure(res, `saving ${key}`)
    },
    async del(key) {
      const res = await send(url(checkKey(key)), { method: 'DELETE', headers: h() }, env)
      if (!res.ok && res.status !== 404) throw await failure(res, `deleting ${key}`)
    },
  }
}

export function storageClient(provider: StorageProvider, config: StorageConfig, secret: StorageSecret, env: Env = process.env): StorageClient {
  return provider === 'azure' ? azureClient(config, secret, env) : s3Client(provider, config, secret, env)
}

/** Can RunF9 list (import) and write (keep originals) here? Writes and removes one small probe file. */
export async function testStorage(client: StorageClient, prefix = ''): Promise<{ read: boolean; write: boolean; detail: string }> {
  let read = false, write = false
  const notes: string[] = []
  try { await client.list(prefix); read = true } catch (e) { notes.push((e as Error).message) }
  const probe = `${prefix}runf9-connection-check.txt`
  try {
    await client.put(probe, Buffer.from(`RunF9 connection check ${new Date().toISOString()}\n`), 'text/plain')
    write = true
    await client.del(probe).catch(() => notes.push(`RunF9 could not delete its check file ${probe}; you can remove it.`))
  } catch (e) { notes.push((e as Error).message) }
  const detail = read && write ? 'RunF9 can import files from here and keep original files here.'
    : read ? `RunF9 can import files from here but cannot save files here. ${notes.join(' ')}`
    : write ? `RunF9 can save files here but cannot list them. ${notes.join(' ')}`
    : notes.join(' ') || 'RunF9 could not connect.'
  return { read, write, detail: detail.trim() }
}

/** Where RunF9 keeps an original file in a connected store: <prefix>runf9/<kind>/<yyyy-mm-dd>-<sha8>-<name>. */
export function objectKeyFor(prefix: string | undefined, kind: 'schedules' | 'documents', fileName: string, sha256: string, now = new Date()): string {
  const name = fileName.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(-120) || 'file'
  return checkKey(`${prefix ?? ''}runf9/${kind}/${now.toISOString().slice(0, 10)}-${sha256.slice(0, 8)}-${name}`)
}
