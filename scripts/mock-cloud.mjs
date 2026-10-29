#!/usr/bin/env node
// Stand-ins for the cloud sign-in services and storage, for automated tests only (never production).
//   PORT=4040 node scripts/mock-cloud.mjs
// Point RunF9 at it with the test-only overrides (honoured only where RUNF9_STORAGE_CUSTOM_ENDPOINTS
// or a private deployment allows custom storage addresses):
//   RUNF9_AZURE_AUTHORITY=http://127.0.0.1:4040/ms        Microsoft identity platform (authorize, token)
//   RUNF9_GOOGLE_AUTH_URL=http://127.0.0.1:4040/google/auth   RUNF9_GOOGLE_TOKEN_URL=…/google/token
//   RUNF9_AWS_STS_ENDPOINT=http://127.0.0.1:4040/sts      AWS STS AssumeRole
// and connections at endpoints …/blob (Azure Blob), …/gcs (Cloud Storage XML API), …/s3 (S3).
// Like the real services: authorization codes need the PKCE verifier; Microsoft rotates refresh
// tokens (an old one stops working); access tokens are short-lived; storage accepts only valid tokens.

import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

const PORT = Number(process.env.PORT || 4040)
const CLIENT = { azure: { id: process.env.MOCK_AZURE_CLIENT_ID || 'azure-test-client', secret: process.env.MOCK_AZURE_CLIENT_SECRET || 'azure-test-secret' }, gcp: { id: process.env.MOCK_GOOGLE_CLIENT_ID || 'google-test-client', secret: process.env.MOCK_GOOGLE_CLIENT_SECRET || 'google-test-secret' } }
const RUNF9_AWS_KEY = process.env.MOCK_RUNF9_AWS_ACCESS_KEY_ID || 'AKIARUNF9TESTKEY0001'
// Access tokens expire in 61 s by default; MOCK_ACCESS_TTL=30 makes RunF9 refresh on every call (exercises rotation).
const ACCESS_TTL = Number(process.env.MOCK_ACCESS_TTL || 61)

const codes = new Map()            // code -> { provider, challenge, redirect }
const refresh = new Map()          // refresh token -> provider
const access = new Map()           // access token -> { provider, until }
const sessions = new Map()         // aws session token -> { keyId, until }
const objects = new Map()          // `${ns}/${container}/${key}` -> { body, modified }
const stats = { refreshes: { azure: 0, gcp: 0 }, assumeRole: 0 }

const tok = p => `${p}-${randomBytes(12).toString('base64url')}`
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
const xml = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/xml' }); res.end(`<?xml version="1.0" encoding="UTF-8"?>${body}`) }
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const body = req => new Promise(r => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => r(Buffer.concat(parts))) })

function issue(provider) {
  const at = tok(`${provider}-at`), rt = tok(`${provider}-rt`)
  access.set(at, { provider, until: Date.now() + ACCESS_TTL * 1000 })
  refresh.set(rt, provider)
  return { access_token: at, refresh_token: rt, expires_in: ACCESS_TTL, token_type: 'Bearer' }
}

async function tokenEndpoint(req, res, provider) {
  const p = new URLSearchParams((await body(req)).toString())
  if (p.get('client_id') !== CLIENT[provider].id || p.get('client_secret') !== CLIENT[provider].secret) return json(res, 401, { error: 'invalid_client' })
  if (p.get('grant_type') === 'authorization_code') {
    const c = codes.get(p.get('code'))
    codes.delete(p.get('code'))
    if (!c || c.provider !== provider || c.redirect !== p.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' })
    if (createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE' })
    return json(res, 200, issue(provider))
  }
  if (p.get('grant_type') === 'refresh_token') {
    const rt = p.get('refresh_token')
    if (refresh.get(rt) !== provider) return json(res, 400, { error: 'invalid_grant' })
    stats.refreshes[provider]++
    const t = issue(provider)
    if (provider === 'azure') refresh.delete(rt)            // Microsoft rotates refresh tokens
    else { refresh.delete(t.refresh_token); delete t.refresh_token } // Google keeps the original
    return json(res, 200, t)
  }
  return json(res, 400, { error: 'unsupported_grant_type' })
}

function authorize(url, res, provider) {
  const p = url.searchParams
  if (p.get('client_id') !== CLIENT[provider].id || p.get('code_challenge_method') !== 'S256') { res.writeHead(400); return res.end('bad request') }
  const back = new URL(p.get('redirect_uri'))
  if (p.get('deny') === '1' || (p.get('login_hint') || '').startsWith('deny')) {
    back.searchParams.set('error', 'access_denied')
  } else {
    const code = tok('code')
    codes.set(code, { provider, challenge: p.get('code_challenge'), redirect: p.get('redirect_uri') })
    back.searchParams.set('code', code)
  }
  back.searchParams.set('state', p.get('state'))
  res.writeHead(302, { location: back.toString() }); res.end()
}

function bearerOk(req, provider) {
  const t = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
  const a = t && access.get(t)
  return !!a && a.provider === provider && a.until > Date.now()
}

// One storage handler for the three protocols (namespace = blob | gcs | s3).
async function storage(req, res, ns, rest, url) {
  const [container, ...keyParts] = rest
  const key = decodeURIComponent(keyParts.join('/'))
  const isList = req.method === 'GET' && !key
  const id = `${ns}/${container}/${key}`
  if (req.method === 'PUT') { objects.set(id, { body: await body(req), modified: new Date() }); res.writeHead(201); return res.end() }
  if (req.method === 'DELETE') { objects.delete(id); res.writeHead(ns === 'blob' ? 202 : 204); return res.end() }
  if (!isList) {
    const o = objects.get(id)
    if (!o) return ns === 'blob' ? xml(res, 404, '<Error><Code>BlobNotFound</Code></Error>') : xml(res, 404, '<Error><Code>NoSuchKey</Code></Error>')
    res.writeHead(200, { 'content-length': o.body.length }); return res.end(o.body)
  }
  const prefix = url.searchParams.get('prefix') || ''
  const delim = url.searchParams.get('delimiter') || ''
  const files = [], folders = new Set()
  for (const [k, o] of objects) {
    if (!k.startsWith(`${ns}/${container}/`)) continue
    const name = k.slice(`${ns}/${container}/`.length)
    if (!name.startsWith(prefix)) continue
    const restName = name.slice(prefix.length)
    if (delim && restName.includes(delim)) folders.add(prefix + restName.slice(0, restName.indexOf(delim) + 1))
    else files.push({ name, o })
  }
  if (ns === 'blob') {
    return xml(res, 200, `<EnumerationResults><Blobs>${files.map(f => `<Blob><Name>${esc(f.name)}</Name><Properties><Last-Modified>${f.o.modified.toUTCString()}</Last-Modified><Content-Length>${f.o.body.length}</Content-Length></Properties></Blob>`).join('')}${[...folders].map(p => `<BlobPrefix><Name>${esc(p)}</Name></BlobPrefix>`).join('')}</Blobs></EnumerationResults>`)
  }
  return xml(res, 200, `<ListBucketResult><Name>${esc(container)}</Name>${files.map(f => `<Contents><Key>${esc(f.name)}</Key><LastModified>${f.o.modified.toISOString()}</LastModified><Size>${f.o.body.length}</Size></Contents>`).join('')}${[...folders].map(p => `<CommonPrefixes><Prefix>${esc(p)}</Prefix></CommonPrefixes>`).join('')}</ListBucketResult>`)
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const parts = url.pathname.split('/').filter(Boolean)
  try {
    if (url.pathname === '/stats') return json(res, 200, stats)
    // Microsoft identity platform: /ms/organizations/oauth2/v2.0/{authorize,token}
    if (parts[0] === 'ms' && parts[4] === 'authorize') return authorize(url, res, 'azure')
    if (parts[0] === 'ms' && parts[4] === 'token' && req.method === 'POST') return tokenEndpoint(req, res, 'azure')
    if (url.pathname === '/google/auth') return authorize(url, res, 'gcp')
    if (url.pathname === '/google/token' && req.method === 'POST') return tokenEndpoint(req, res, 'gcp')
    if (parts[0] === 'sts') {
      const p = url.searchParams
      if (!(req.headers.authorization || '').includes(`Credential=${RUNF9_AWS_KEY}/`) || !(req.headers.authorization || '').includes('/sts/aws4_request')) return xml(res, 403, '<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>')
      if (p.get('Action') !== 'AssumeRole' || !/^runf9-[0-9a-f]{32}$/.test(p.get('ExternalId') || '') || (p.get('RoleArn') || '').includes('denied')) return xml(res, 403, '<ErrorResponse><Error><Code>AccessDenied</Code></Error></ErrorResponse>')
      stats.assumeRole++
      const keyId = `ASIA${randomBytes(8).toString('hex').toUpperCase()}`, session = tok('session')
      sessions.set(session, { keyId, until: Date.now() + 3600_000 })
      return xml(res, 200, `<AssumeRoleResponse><AssumeRoleResult><Credentials><AccessKeyId>${keyId}</AccessKeyId><SecretAccessKey>${randomBytes(20).toString('hex')}</SecretAccessKey><SessionToken>${session}</SessionToken><Expiration>${new Date(Date.now() + 3600_000).toISOString()}</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`)
    }
    if (parts[0] === 'blob') {
      // /blob/{account}/{container}/{key}: Azure Blob with a Microsoft sign-in token
      if (!bearerOk(req, 'azure') || req.headers['x-ms-version'] < '2017-11-09') return xml(res, 403, '<Error><Code>AuthenticationFailed</Code></Error>')
      return storage(req, res, 'blob', parts.slice(2), url)
    }
    if (parts[0] === 'gcs') {
      if (!bearerOk(req, 'gcp')) return xml(res, 401, '<Error><Code>AuthenticationRequired</Code></Error>')
      return storage(req, res, 'gcs', parts.slice(1), url)
    }
    if (parts[0] === 's3') {
      // S3 with role credentials: the session token must be current and the key ID the one issued with it.
      const s = sessions.get(req.headers['x-amz-security-token'] || '')
      if (!s || s.until < Date.now() || !(req.headers.authorization || '').includes(`Credential=${s.keyId}/`) || !(req.headers.authorization || '').split(';').join(',').includes('x-amz-security-token')) return xml(res, 403, '<Error><Code>InvalidToken</Code></Error>')
      return storage(req, res, 's3', parts.slice(1), url)
    }
    res.writeHead(404); res.end()
  } catch (e) { console.error(e); res.writeHead(500, { 'content-type': 'text/plain' }); res.end('internal error') }
}).listen(PORT, '127.0.0.1', () => console.log(`mock cloud on http://127.0.0.1:${PORT}`))
