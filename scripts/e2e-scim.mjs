#!/usr/bin/env node
// End-to-end checks for SAML 2.0 single sign-on and SCIM 2.0 provisioning against a running server.
//   BASE_URL=http://localhost:3200 DATABASE_URL=postgres://… node scripts/e2e-scim.mjs
// The server must run with PLANORA_ALLOW_INSECURE_OIDC=1 (test domains *.example count as verified
// and a plain-http IdP URL is accepted). DATABASE_URL is used to set the Enterprise plan
// (scripts/set-plan.mjs) and to confirm the test owners' email addresses.
// A test identity provider key pair and certificate are generated here; responses are signed with
// xml-crypto exactly as an IdP would. Exits non-zero on failure.

import { execFileSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import pg from 'pg'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
// This suite creates its own organizations, so the server must allow self sign-up (PLANORA_SIGNUP=open,
// as in ci.yml). The private beta default (invite-only) is covered by scripts/e2e-beta.mjs.
if ((await fetch(`${BASE}/api/auth`).then(r => r.json()).catch(() => null))?.signup?.mode === 'invite_only') {
  console.error('✗ Start the server with PLANORA_SIGNUP=open for this suite (invite-only mode is checked by scripts/e2e-beta.mjs).')
  process.exit(1)
}
const ORIGIN = new URL(BASE).origin
const PW = 'correct horse battery staple'
let passed = 0

function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra !== undefined ? JSON.stringify(extra).slice(0, 800) : ''); process.exit(1) }
  passed++
  console.log(`✓ ${msg}`)
}

class Client {
  constructor() { this.cookie = '' }
  async req(method, url, body, headers = {}) {
    const h = { cookie: this.cookie, origin: ORIGIN, ...headers }
    let payload
    if (body !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: 'manual' })
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith('planora-token=')) this.cookie = c.split(';')[0]
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { status: res.status, data, headers: res.headers, text }
  }
  get(u, h) { return this.req('GET', u, undefined, h) }
  post(u, b, h) { return this.req('POST', u, b ?? {}, h) }
}

const scim = (token) => async (method, path, body) => {
  const res = await fetch(`${BASE}/api/scim/v2${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, type: res.headers.get('content-type') || '', data: text ? JSON.parse(text) : null }
}

function makeIdp() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
  const attrs = [{ name: 'commonName', value: 'Planora e2e IdP' }]
  cert.setSubject(attrs); cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) }
}

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString()
function samlResponse({ idpEntityId, acsUrl, audience, requestId, email, key, sign = true }) {
  const aid = `_a${randomUUID().replace(/-/g, '')}`
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${aid}" Version="2.0" IssueInstant="${iso()}"><saml:Issuer>${idpEntityId}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" NotOnOrAfter="${iso(300_000)}" Recipient="${acsUrl}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${iso()}" SessionIndex="_s"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName"><saml:AttributeValue>Jane SAML</saml:AttributeValue></saml:Attribute><saml:Attribute Name="groups"><saml:AttributeValue>Planora Schedulers</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`
  let signed = assertion
  if (sign) {
    const sig = new SignedXml({ privateKey: key, canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#', signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' })
    sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] })
    sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } })
    signed = sig.getSignedXml()
  }
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID().replace(/-/g, '')}" Version="2.0" IssueInstant="${iso()}" Destination="${acsUrl}" InResponseTo="${requestId}"><saml:Issuer>${idpEntityId}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`
  return Buffer.from(xml).toString('base64')
}

/** Starts SP-initiated sign-in through "Sign in with SSO" and returns the request id, RelayState and state cookie. */
async function startSamlSignIn(email) {
  const res = await fetch(`${BASE}/api/auth/sso`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email }) })
  const data = await res.json()
  const stateCookie = (res.headers.getSetCookie?.() || []).find(c => c.startsWith('planora-saml='))?.split(';')[0]
  const url = new URL(data.url)
  const request = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest'), 'base64')).toString()
  return { status: res.status, url, request, requestId: /ID="([^"]+)"/.exec(request)[1], relay: url.searchParams.get('RelayState'), stateCookie }
}

async function postAcs(acsUrl, samlResp, relay, stateCookie) {
  const res = await fetch(acsUrl, {
    method: 'POST', redirect: 'manual',
    // A real IdP page posts this cross-site; the ACS accepts it (bound by the state cookie instead).
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://idp.example', 'sec-fetch-site': 'cross-site', cookie: stateCookie || '' },
    body: new URLSearchParams({ SAMLResponse: samlResp, RelayState: relay }).toString(),
  })
  const session = (res.headers.getSetCookie?.() || []).find(c => c.startsWith('planora-token=') && !c.startsWith('planora-token=;'))?.split(';')[0]
  return { status: res.status, location: res.headers.get('location') || '', session }
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required (plans and test setup).'); process.exit(2) }
  const stamp = Date.now()
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  await db.query('DELETE FROM rate_limits')
  const setPlan = (who, plan) => execFileSync('node', ['scripts/set-plan.mjs', who, plan, 'e2e scim'], { env: process.env }).toString()
  const signup = async (who, company) => {
    const c = new Client()
    const r = await c.post('/api/auth', { action: 'signup', email: who, password: PW, name: `${company} Owner`, company })
    ok(r.status === 200 && r.data.user.role === 'owner', `${company}: owner signs up`)
    await db.query('UPDATE users SET email_verified_at=NOW() WHERE LOWER(email)=LOWER($1)', [who]) // test setup: confirmed address
    setPlan(who, 'enterprise')
    return c
  }

  const domA = `samla${stamp}.example`, domB = `scimb${stamp}.example`
  const ownerA = await signup(`owner@${domA}`, 'Alpha Builders')
  const ownerB = await signup(`owner@${domB}`, 'Beta Contractors')
  const idp = makeIdp(), rogue = makeIdp()
  const idpEntityId = `http://localhost:4011/${stamp}`

  /* ── SAML configuration ── */
  let r = await ownerA.post('/api/org/saml', { action: 'save', saml: { enabled: true, idpEntityId, ssoUrl: 'http://localhost:4011/sso', certs: idp.cert, domains: [domA], defaultRole: 'viewer', groupRoles: [{ group: 'Planora Schedulers', role: 'scheduler' }] } })
  ok(r.status === 200 && r.data.saml.enabled && r.data.saml.sp?.acsUrl && r.data.saml.certs[0]?.fingerprint256, 'Admin configures SAML (SP URLs issued, certificate parsed)', r.data)
  const sp = r.data.saml.sp
  r = await ownerB.post('/api/org/saml', { action: 'save', saml: { enabled: true, idpEntityId, ssoUrl: 'http://localhost:4011/sso', certs: idp.cert, domains: [domA] } })
  ok(r.status === 409, 'Another organization cannot claim the same SAML domain')
  r = await ownerB.post('/api/org/saml', { action: 'save', saml: { enabled: false, domains: [domB] } })
  ok(r.status === 200, 'Second organization saves its own domain')
  // orgB verifies its domain for SCIM through OIDC-free SAML settings: turn SAML on with its own (unused) IdP.
  r = await ownerB.post('/api/org/saml', { action: 'save', saml: { enabled: true, idpEntityId: `${idpEntityId}-b`, ssoUrl: 'http://localhost:4011/sso-b', certs: rogue.cert, domains: [domB] } })
  ok(r.status === 200, 'Second organization turns SAML on for its domain')

  const md = await fetch(sp.metadataUrl)
  const mdText = await md.text()
  ok(md.status === 200 && /samlmetadata\+xml/.test(md.headers.get('content-type') || '') && mdText.includes(`entityID="${sp.entityId}"`) && mdText.includes(sp.acsUrl), 'SP metadata is served with entity ID and ACS URL')

  /* ── SAML sign-in ── */
  let s = await startSamlSignIn(`jane@${domA}`)
  ok(s.status === 200 && s.url.pathname === '/sso' && s.request.includes(`AssertionConsumerServiceURL="${sp.acsUrl}"`) && s.relay && s.stateCookie, 'Sign in with SSO starts a SAML AuthnRequest (HTTP-Redirect, RelayState, state cookie)')
  const good = samlResponse({ idpEntityId, acsUrl: sp.acsUrl, audience: sp.entityId, requestId: s.requestId, email: `jane@${domA}`, key: idp.key })
  let a = await postAcs(sp.acsUrl, good, s.relay, s.stateCookie)
  ok(a.status === 303 && a.location.endsWith('/dashboard') && a.session, 'A signed SAML response signs the member in', a)
  const jane = new Client(); jane.cookie = a.session
  r = await jane.get('/api/auth')
  ok(r.data.user?.email === `jane@${domA}` && r.data.user.role === 'scheduler' && r.data.org.name === 'Alpha Builders' && r.data.security.mfaSetupRequired === false, 'Just-in-time member created in the right organization with the group-mapped role', r.data)
  a = await postAcs(sp.acsUrl, good, s.relay, s.stateCookie)
  ok(a.status === 303 && a.location.includes('sso_error') && !a.session, 'Replaying the same SAML response is rejected')

  s = await startSamlSignIn(`joe@${domA}`)
  a = await postAcs(sp.acsUrl, samlResponse({ idpEntityId, acsUrl: sp.acsUrl, audience: sp.entityId, requestId: s.requestId, email: `joe@${domA}`, key: rogue.key }), s.relay, s.stateCookie)
  ok(a.status === 303 && a.location.includes('sso_error') && !a.session, 'A response signed with another key is rejected')
  s = await startSamlSignIn(`joe@${domA}`)
  a = await postAcs(sp.acsUrl, samlResponse({ idpEntityId, acsUrl: sp.acsUrl, audience: sp.entityId, requestId: s.requestId, email: `joe@${domA}`, key: idp.key, sign: false }), s.relay, s.stateCookie)
  ok(a.status === 303 && a.location.includes('sso_error') && !a.session, 'An unsigned response is rejected')
  s = await startSamlSignIn(`joe@${domA}`)
  a = await postAcs(sp.acsUrl, samlResponse({ idpEntityId, acsUrl: sp.acsUrl, audience: sp.entityId, requestId: s.requestId, email: `joe@${domA}`, key: idp.key }), s.relay, '')
  ok(a.status === 303 && a.location.includes('sso_error') && !a.session, 'A response without the browser\'s state cookie is rejected')
  s = await startSamlSignIn(`joe@${domA}`)
  a = await postAcs(sp.acsUrl, samlResponse({ idpEntityId, acsUrl: sp.acsUrl, audience: sp.entityId, requestId: s.requestId, email: `mallory@${domB}`, key: idp.key }), s.relay, s.stateCookie)
  ok(a.status === 303 && a.location.includes('sso_error') && !a.session, 'An email in another organization\'s domain is rejected')
  const mallory = await db.query('SELECT 1 FROM users WHERE email=$1', [`mallory@${domB}`])
  ok(mallory.rowCount === 0, 'No account is created for a rejected response')

  /* ── SSO required applies to SAML organizations too ── */
  r = await ownerA.post('/api/org/saml', { action: 'save', saml: { enabled: true, enforce: true, domains: [domA] } })
  ok(r.status === 200 && r.data.saml.enforce, 'Admin requires single sign-on (SAML)')
  await db.query("UPDATE users SET password_hash=(SELECT password_hash FROM users WHERE email=$1) WHERE email=$2", [`owner@${domA}`, `jane@${domA}`]) // test: give the SSO member a known password
  r = await new Client().post('/api/auth', { action: 'signin', email: `jane@${domA}`, password: PW })
  ok(r.status === 403 && r.data.code === 'sso_required', 'With SAML enforced, members cannot use a password')
  r = await new Client().post('/api/auth', { action: 'signin', email: `owner@${domA}`, password: PW })
  ok(r.status === 200, 'Owners keep password sign-in as a break-glass account')

  /* ── SCIM tokens ── */
  r = await ownerA.post('/api/org/scim', { action: 'create_token', name: 'Entra ID' })
  ok(r.status === 200 && /^scim_/.test(r.data.secret) && r.data.token.prefix && !('token_hash' in r.data.token), 'Admin creates a SCIM token (shown once)')
  const tokenA = r.data.secret, tokenAId = r.data.token.id
  r = await ownerB.post('/api/org/scim', { action: 'create_token', name: 'Okta' })
  const tokenB = r.data.secret
  r = await ownerA.get('/api/org/scim')
  ok(r.status === 200 && r.data.tokens.length === 1 && !JSON.stringify(r.data).includes(tokenA), 'Token list never includes the secret')
  const A = scim(tokenA), B = scim(tokenB)

  /* ── SCIM endpoints ── */
  let x = await scim('scim_' + 'x'.repeat(43))('GET', '/Users')
  ok(x.status === 401 && x.data.schemas?.[0] === 'urn:ietf:params:scim:api:messages:2.0:Error' && x.data.status === '401', 'Unknown token: SCIM 401 error')
  x = await fetch(`${BASE}/api/scim/v2/Users`, { headers: { cookie: ownerA.cookie } }).then(async res => ({ status: res.status }))
  ok(x.status === 401, 'A session cookie is not accepted by SCIM endpoints')
  x = await A('GET', '/ServiceProviderConfig')
  ok(x.status === 200 && x.data.patch.supported === true && /scim\+json/.test(x.type), 'ServiceProviderConfig served')
  x = await A('GET', `/Users?filter=${encodeURIComponent(`userName eq "jane@${domA}"`)}`)
  ok(x.status === 200 && x.data.totalResults === 1 && x.data.Resources[0].active === true, 'Filter by userName finds the SAML member')
  const janeId = x.data.Resources[0].id
  x = await A('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `new@${domA}`, name: { givenName: 'New', familyName: 'Hire' }, roles: [{ value: 'reviewer', primary: true }], externalId: 'e-1' })
  ok(x.status === 201 && x.data.userName === `new@${domA}` && x.data.roles[0].value === 'reviewer', 'SCIM creates a member', x.data)
  const newId = x.data.id
  x = await A('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `new@${domA}` })
  ok(x.status === 409 && x.data.scimType === 'uniqueness', 'Duplicate userName: 409 uniqueness')
  x = await A('GET', '/Users?startIndex=1&count=1')
  ok(x.status === 200 && x.data.itemsPerPage === 1 && x.data.totalResults >= 3, 'Paging with startIndex and count')

  // Cross-organization isolation
  x = await B('GET', `/Users/${janeId}`)
  ok(x.status === 404, 'Another organization\'s token cannot read the member')
  x = await B('PATCH', `/Users/${janeId}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] })
  ok(x.status === 404, 'Another organization\'s token cannot deprovision the member')
  x = await B('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `sneaky@${domA}` })
  ok(x.status === 400 && x.data.scimType === 'invalidValue', 'A token cannot create users outside its organization\'s domains')
  r = await jane.get('/api/auth')
  ok(r.data.user?.email === `jane@${domA}`, 'Member still signed in after the rejected cross-org attempts')

  // Deprovisioning revokes sessions immediately
  x = await A('PATCH', `/Users/${janeId}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] })
  ok(x.status === 200 && x.data.active === false, 'PATCH active=false deprovisions the member')
  r = await jane.get('/api/auth')
  ok(r.data.user === null, 'The deprovisioned member\'s session ends immediately')
  s = await startSamlSignIn(`jane@${domA}`)
  a = await postAcs(sp.acsUrl, samlResponse({ idpEntityId, acsUrl: sp.acsUrl, audience: sp.entityId, requestId: s.requestId, email: `jane@${domA}`, key: idp.key }), s.relay, s.stateCookie)
  ok(a.status === 303 && a.location.includes('sso_error') && !a.session, 'A deprovisioned member cannot sign in with SAML')
  x = await A('DELETE', `/Users/${newId}`)
  ok(x.status === 204, 'DELETE deprovisions')
  x = await A('GET', `/Users/${newId}`)
  ok(x.status === 404 && x.data.status === '404', 'Deleted user is gone from SCIM')

  // Audit and revocation
  r = await ownerA.get('/api/audit?action=scim.')
  const actions = r.data.events.map(e => e.action)
  ok(['scim.token_created', 'scim.user_created', 'scim.user_deprovisioned', 'scim.user_deleted'].every(act => actions.includes(act)) && !JSON.stringify(r.data).includes(tokenA), 'SCIM actions are audited (token never logged)', actions)
  ok(r.data.events.some(e => e.action === 'scim.user_deprovisioned' && e.actorEmail === 'scim-token:Entra ID'), 'SCIM changes are attributed to the token')
  r = await ownerA.get('/api/org/scim')
  ok(r.data.events.length >= 4, 'Settings show the latest provisioning events')
  r = await ownerA.post('/api/org/scim', { action: 'revoke_token', id: tokenAId })
  ok(r.status === 200, 'Admin revokes the SCIM token')
  x = await A('GET', '/Users')
  ok(x.status === 401, 'A revoked token stops working immediately')

  await db.end()
  console.log(`\n${passed} SAML and SCIM checks passed`)
}

main().catch(err => { console.error(err); process.exit(1) })
