// AWS Signature Version 4 for the S3 protocol, used for Amazon S3 and for Google Cloud Storage's
// S3-compatible XML API (HMAC keys). No SDK: one function, checked against AWS's published example
// in sigv4.test.ts.

import { createHash, createHmac } from 'crypto'

export interface SignInput {
  method: string
  url: URL
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Request body (hashed into the signature); empty for GET/DELETE */
  body?: Buffer
  headers?: Record<string, string>
  now?: Date
  service?: string
  /** Every AWS service except S3 signs the path encoded a second time (e.g. Bedrock model ids with ":") */
  doubleEncodePath?: boolean
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export function uriEncode(s: string, keepSlash = false): string {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return keepSlash ? e.replace(/%2F/g, '/') : e
}

/** Headers to send: the caller's, plus host, x-amz-date, x-amz-content-sha256 and Authorization. */
export function signV4(i: SignInput): Record<string, string> {
  const service = i.service ?? 's3'
  const now = i.now ?? new Date()
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = amzDate.slice(0, 8)
  const payloadHash = sha256(i.body ?? Buffer.alloc(0))
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ')
  headers.host = i.url.host
  headers['x-amz-date'] = amzDate
  headers['x-amz-content-sha256'] = payloadHash

  const signedHeaders = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaders.map(k => `${k}:${headers[k]}\n`).join('')
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&')
  // The URL's pathname is already percent-encoded once (built with uriEncode); S3 signs it as is.
  const path = i.url.pathname || '/'
  const canonicalPath = i.doubleEncodePath ? path.split('/').map(seg => uriEncode(seg)).join('/') : path
  const canonicalRequest = [i.method, canonicalPath, query, canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n')

  const scope = `${day}/${i.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), service), 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const out: Record<string, string> = { ...headers }
  out.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
  delete out.host // fetch sets Host itself
  return out
}
