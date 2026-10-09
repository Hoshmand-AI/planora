import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import { inflateRawSync } from 'node:zlib'
import {
  normalizeSaml, parseIdpMetadata, roleForGroups, spUrls, startSaml, validateSamlResponse, readSamlState, normalizeCert, splitCerts,
  type SamlConfig, type SamlStore,
} from './saml'
import { ApiError } from './api'

// SAML 2.0 response validation against a test identity provider whose key pair and certificate are
// generated here. Signatures are produced with xml-crypto, the same way real IdPs sign.

const ORIGIN = 'https://planora.test'
const IDP = 'https://idp.example.test/metadata'

function makeIdp() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
  const attrs = [{ name: 'commonName', value: 'Test IdP' }]
  cert.setSubject(attrs); cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) }
}

let idp: { key: string; cert: string }
let attacker: { key: string; cert: string }
beforeAll(() => { idp = makeIdp(); attacker = makeIdp() }, 60_000)

/** In-memory store with the same semantics as dbSamlStore. */
function memoryStore() {
  const requests = new Map<string, { at: number; used: boolean }>()
  const assertions = new Set<string>()
  const store: SamlStore = {
    async saveRequest(id) { requests.set(id, { at: Date.now(), used: false }) },
    async pendingRequest(id) { const r = requests.get(id); return r && !r.used ? new Date(r.at).toISOString() : null },
    async consumeRequest(id) { const r = requests.get(id); if (!r || r.used) return false; r.used = true; return true },
    async recordAssertion(id) { if (assertions.has(id)) return false; assertions.add(id); return true },
  }
  return { store, requests, assertions }
}

const config = (over: Partial<SamlConfig> = {}): SamlConfig => normalizeSaml({
  enabled: true, connectionId: 'conn_test_1234', idpEntityId: IDP, ssoUrl: 'https://idp.example.test/sso', certs: [idp.cert],
  domains: ['acme.test'], defaultRole: 'viewer', groupRoles: [{ group: 'Planora Admins', role: 'admin' }, { group: 'Schedulers', role: 'scheduler' }], ...over,
})
const urls = spUrls(ORIGIN, 'conn_test_1234')

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

interface Opts {
  requestId: string; email?: string; audience?: string; recipient?: string; destination?: string | null; issuer?: string
  notBefore?: string; notOnOrAfter?: string; subjectInResponseTo?: string; responseInResponseTo?: string; assertionId?: string; groups?: string[]
}
function assertionXml(o: Opts) {
  const id = o.assertionId || `_a${randomUUID().replace(/-/g, '')}`
  const email = o.email || 'jane@acme.test'
  const groups = (o.groups || []).map(g => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join('')
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso()}">`
    + `<saml:Issuer>${o.issuer || IDP}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${o.subjectInResponseTo ?? o.requestId}" NotOnOrAfter="${o.notOnOrAfter || iso(300_000)}" Recipient="${o.recipient || urls.acsUrl}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${o.notBefore || iso(-60_000)}" NotOnOrAfter="${o.notOnOrAfter || iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${o.audience || urls.entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${iso()}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>`
    + `<saml:Attribute Name="displayName"><saml:AttributeValue>Jane Doe</saml:AttributeValue></saml:Attribute>`
    + (groups ? `<saml:Attribute Name="groups">${groups}</saml:Attribute>` : '')
    + `</saml:AttributeStatement></saml:Assertion>`
}

function sign(xml: string, key: string, xpath: string, after: string) {
  const sig = new SignedXml({ privateKey: key, canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#', signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' })
  sig.addReference({ xpath, digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] })
  sig.computeSignature(xml, { location: { reference: after, action: 'after' } })
  return sig.getSignedXml()
}

const signAssertion = (assertion: string, key = idp.key) => sign(assertion, key, "//*[local-name(.)='Assertion']", "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']")

function responseXml(o: Opts, inner: string) {
  const dest = o.destination === null ? '' : ` Destination="${o.destination || urls.acsUrl}"`
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID().replace(/-/g, '')}" Version="2.0" IssueInstant="${iso()}"${dest} InResponseTo="${o.responseInResponseTo ?? o.requestId}">`
    + `<saml:Issuer>${o.issuer || IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${inner}</samlp:Response>`
}

const b64 = (s: string) => Buffer.from(s).toString('base64')
/** Signed assertion inside an unsigned response (the most common IdP default). */
const signedResponse = (o: Opts, key = idp.key) => b64(responseXml(o, signAssertion(assertionXml(o), key)))

async function issue(store: SamlStore) {
  const { url, requestId, stateCookie } = await startSaml('org_1', config(), ORIGIN, { store })
  return { url, requestId, stateCookie }
}

async function expectRejected(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(() => null, e => e)
  expect(err, 'expected rejection').toBeInstanceOf(ApiError)
  expect((err as ApiError).status).toBeGreaterThanOrEqual(401)
  expect((err as ApiError).message).toMatch(re)
}

describe('SAML service provider', () => {
  let mem: ReturnType<typeof memoryStore>
  beforeEach(() => { mem = memoryStore() })
  const validate = (samlResponse: string, requestId: string, cfg = config(), store = mem.store) =>
    validateSamlResponse({ orgId: 'org_1', config: cfg, urls, samlResponse, requestId, store })

  it('issues an AuthnRequest over HTTP-Redirect with RelayState bound to a signed state cookie', async () => {
    const { url, requestId, stateCookie } = await issue(mem.store)
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://idp.example.test/sso')
    const req = inflateRawSync(Buffer.from(u.searchParams.get('SAMLRequest')!, 'base64')).toString()
    expect(req).toContain(`ID="${requestId}"`)
    expect(req).toContain(`AssertionConsumerServiceURL="${urls.acsUrl}"`)
    expect(req).toContain(urls.entityId)
    const st = readSamlState(stateCookie)
    expect(st.rid).toBe(requestId)
    expect(u.searchParams.get('RelayState')).toBe(st.relay)
    expect(mem.requests.has(requestId)).toBe(true)
    expect(() => readSamlState(stateCookie + 'x')).toThrow(/expired|another browser/)
  })

  it('accepts a valid signed assertion and maps email, name, groups and role', async () => {
    const { requestId } = await issue(mem.store)
    const id = await validate(signedResponse({ requestId, groups: ['Everyone', 'Schedulers'] }), requestId)
    expect(id).toMatchObject({ orgId: 'org_1', email: 'jane@acme.test', name: 'Jane Doe', groupRole: 'scheduler' })
    expect(mem.requests.get(requestId)!.used).toBe(true)
  })

  it('accepts a response signed as a whole (signature over the Response)', async () => {
    const { requestId } = await issue(mem.store)
    const o = { requestId }
    const xml = sign(responseXml(o, assertionXml(o)), idp.key, "/*[local-name(.)='Response']", "/*[local-name(.)='Response']/*[local-name(.)='Issuer']")
    expect((await validate(b64(xml), requestId)).email).toBe('jane@acme.test')
  })

  it('rejects an unsigned response', async () => {
    const { requestId } = await issue(mem.store)
    await expectRejected(validate(b64(responseXml({ requestId }, assertionXml({ requestId }))), requestId), /signature/i)
  })

  it('rejects a bad signature (signed by another key)', async () => {
    const { requestId } = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId }, attacker.key), requestId), /signature/i)
  })

  it('rejects a tampered assertion (content changed after signing)', async () => {
    const { requestId } = await issue(mem.store)
    const xml = Buffer.from(signedResponse({ requestId }), 'base64').toString().replace(/jane@acme\.test/g, 'boss@acme.test')
    await expectRejected(validate(b64(xml), requestId), /signature|digest/i)
  })

  it('rejects the wrong audience', async () => {
    const { requestId } = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId, audience: 'https://other-sp.test' }), requestId), /audience/i)
  })

  it('rejects the wrong Destination and the wrong Recipient', async () => {
    let { requestId } = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId, destination: 'https://evil.test/acs' }), requestId), /Destination/)
    ;({ requestId } = await issue(mem.store))
    await expectRejected(validate(signedResponse({ requestId, recipient: 'https://evil.test/acs' }), requestId), /Recipient|subject confirmation/i)
  })

  it('rejects an expired assertion and one not yet valid', async () => {
    let { requestId } = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId, notOnOrAfter: iso(-5 * 60_000) }), requestId), /expired|subject confirmation/i)
    ;({ requestId } = await issue(mem.store))
    await expectRejected(validate(signedResponse({ requestId, notBefore: iso(10 * 60_000) }), requestId), /not yet valid/i)
  })

  it('rejects the wrong issuer', async () => {
    const { requestId } = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId, issuer: 'https://someone-else.test' }), requestId), /Issuer/)
  })

  it('rejects a replayed response (request ID is one-time) and a replayed assertion ID', async () => {
    const { requestId } = await issue(mem.store)
    const r = signedResponse({ requestId, assertionId: '_replayme' })
    await validate(r, requestId)
    await expectRejected(validate(r, requestId), /InResponseTo|already used/)
    // Same assertion ID answering a fresh request is still a replay.
    const second = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId: second.requestId, assertionId: '_replayme' }), second.requestId), /assertion was already used/)
  })

  it('rejects a wrong or unknown InResponseTo, and unsolicited (IdP-initiated) responses', async () => {
    const { requestId } = await issue(mem.store)
    const other = await issue(mem.store)
    // Answering a different request than the one bound to this browser.
    await expectRejected(validate(signedResponse({ requestId: other.requestId }), requestId), /InResponseTo/)
    // Request the SP never issued.
    await expectRejected(validate(signedResponse({ requestId: '_never_issued' }), '_never_issued'), /InResponseTo/)
    // Signed SubjectConfirmationData answering another request.
    const third = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId: third.requestId, subjectInResponseTo: other.requestId }), third.requestId), /InResponseTo|subject/i)
    // No InResponseTo at all.
    await expectRejected(validate(signedResponse({ requestId: '', responseInResponseTo: '' }), requestId), /InResponseTo/)
  })

  it('rejects a request issued for another organization (store is per organization)', async () => {
    const orgB = memoryStore()
    const { requestId } = await issue(orgB.store)
    await expectRejected(validate(signedResponse({ requestId }), requestId, config(), mem.store), /InResponseTo/)
  })

  it('rejects signature-wrapping attempts', async () => {
    const { requestId } = await issue(mem.store)
    const signed = signAssertion(assertionXml({ requestId, email: 'jane@acme.test' }))
    const signedId = /ID="([^"]+)"/.exec(signed)![1]
    const evil = assertionXml({ requestId, email: 'ceo@acme.test', assertionId: signedId })
    // XSW: an evil assertion next to the genuine signed one.
    await expectRejected(validate(b64(responseXml({ requestId }, evil + signed)), requestId), /multiple assertions|signature/i)
    // XSW: the genuine signed assertion hidden inside the evil one (same ID), evil one first.
    const nested = evil.replace('</saml:Assertion>', `<saml:Advice>${signed}</saml:Advice></saml:Assertion>`)
    const r2 = await issue(mem.store)
    await expectRejected(validate(b64(responseXml({ requestId: r2.requestId }, nested.replaceAll(requestId, r2.requestId))), r2.requestId), /signature|ID|duplicate/i)
    // XSW: genuine signed assertion moved into the response Extensions; an unsigned evil assertion in its place.
    const r3 = await issue(mem.store)
    const ext = `<samlp:Extensions>${signed}</samlp:Extensions>`
    await expectRejected(validate(b64(responseXml({ requestId: r3.requestId }, ext + assertionXml({ requestId: r3.requestId, email: 'ceo@acme.test' }))), r3.requestId), /signature/i)
  })

  it('rejects an email outside the organization\'s allowed domains (e.g. another organization\'s domain)', async () => {
    const { requestId } = await issue(mem.store)
    await expectRejected(validate(signedResponse({ requestId, email: 'mallory@other-org.test' }), requestId), /not an allowed domain/)
  })

  it('accepts any configured certificate (rollover) and rejects DOCTYPE payloads', async () => {
    const { requestId } = await issue(mem.store)
    const cfg = config({ certs: [attacker.cert, idp.cert] })
    expect((await validate(signedResponse({ requestId }), requestId, cfg)).email).toBe('jane@acme.test')
    const r = await issue(mem.store)
    await expectRejected(validate(b64(`<!DOCTYPE x [<!ENTITY e "x">]>${responseXml({ requestId: r.requestId }, '')}`), r.requestId), /DOCTYPE/)
  })
})

describe('SAML configuration helpers', () => {
  it('maps groups to the most privileged matching role (never owner)', () => {
    const map = [{ group: 'A', role: 'viewer' as const }, { group: 'B', role: 'admin' as const }]
    expect(roleForGroups(['a', 'b'], map)).toBe('admin')
    expect(roleForGroups(['c'], map)).toBeNull()
    expect(normalizeSaml({ groupRoles: [{ group: 'X', role: 'owner' }], defaultRole: 'owner' })).toMatchObject({ groupRoles: [], defaultRole: 'viewer' })
  })

  it('reads IdP metadata (entity ID, redirect SSO URL, signing certificates)', () => {
    const body = idp.cert.replace(/-----[A-Z ]+-----|\s/g, '')
    const md = `<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP}">
      <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
        <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
        <md:KeyDescriptor use="encryption"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
        <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.test/post"/>
        <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.test/sso"/>
      </md:IDPSSODescriptor></md:EntityDescriptor>`
    const parsed = parseIdpMetadata(md)
    expect(parsed).toMatchObject({ idpEntityId: IDP, ssoUrl: 'https://idp.example.test/sso' })
    expect(parsed.certs).toHaveLength(1)
    expect(() => parseIdpMetadata('<x>')).toThrow()
    expect(() => parseIdpMetadata(`<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${md}`)).toThrow(/DOCTYPE/)
  })

  it('accepts certificates as PEM or base64 and rejects garbage', () => {
    const body = idp.cert.replace(/-----[A-Z ]+-----|\s/g, '')
    expect(normalizeCert(body)).toBe(normalizeCert(idp.cert))
    expect(splitCerts(idp.cert + '\n' + attacker.cert)).toHaveLength(2)
    expect(() => normalizeCert('not a cert')).toThrow()
    expect(() => normalizeCert(Buffer.from('hello world').toString('base64'))).toThrow()
  })
})
