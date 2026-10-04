#!/usr/bin/env node
// Minimal OpenID Connect provider for automated tests (never for production).
//   PORT=4010 node scripts/mock-oidc.mjs
// Supports discovery, an auto-approving /authorize (signs in as login_hint), /token with PKCE
// verification, and /jwks with an RS256 key. ?bad=nonce|aud|sig on /authorize produces a broken token.

import http from 'node:http'
import { createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto'

const PORT = Number(process.env.PORT || 4010)
const ISSUER = `http://localhost:${PORT}`
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KID = 'test-key-1'
const codes = new Map()
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

function sign(claims, key = privateKey) {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: KID })
  const body = b64(claims)
  const s = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url')
  return `${head}.${body}.${s}`
}

const send = (res, status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)) }

http.createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER)
  if (url.pathname === '/.well-known/openid-configuration') {
    return send(res, 200, { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`, id_token_signing_alg_values_supported: ['RS256'] })
  }
  if (url.pathname === '/jwks') return send(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] })
  if (url.pathname === '/authorize') {
    const p = url.searchParams
    const code = randomBytes(16).toString('base64url')
    codes.set(code, { email: p.get('login_hint'), nonce: p.get('nonce'), challenge: p.get('code_challenge'), clientId: p.get('client_id'), redirect: p.get('redirect_uri'), bad: p.get('bad') })
    const back = new URL(p.get('redirect_uri'))
    back.searchParams.set('code', code)
    back.searchParams.set('state', p.get('state'))
    res.writeHead(302, { location: back.toString() }); return res.end()
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const f = new URLSearchParams(raw)
    const c = codes.get(f.get('code'))
    codes.delete(f.get('code'))
    if (!c) return send(res, 400, { error: 'invalid_grant' })
    if (createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
    if (f.get('client_secret') !== 'test-secret') return send(res, 401, { error: 'invalid_client' })
    const now = Math.floor(Date.now() / 1000)
    const claims = { iss: ISSUER, sub: `sub-${c.email}`, aud: c.bad === 'aud' ? 'someone-else' : c.clientId, iat: now, exp: now + 300, nonce: c.bad === 'nonce' ? 'wrong' : c.nonce, email: c.email, email_verified: true, name: c.email.split('@')[0] }
    return send(res, 200, { access_token: 'x', token_type: 'Bearer', id_token: sign(claims, c.bad === 'sig' ? other.privateKey : privateKey) })
  }
  send(res, 404, { error: 'not found' })
}).listen(PORT, () => console.log(`mock OIDC provider on ${ISSUER}`))
