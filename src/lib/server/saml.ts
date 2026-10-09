// Single sign-on with SAML 2.0 (Microsoft Entra ID, Okta, Ping, ADFS, Google Workspace, OneLogin…),
// alongside OpenID Connect (sso.ts).
//
// Planora is the service provider (SP). Each organization has one SAML connection with its own
// SP entity ID and assertion consumer service (ACS) URL:
//   metadata  /api/auth/saml/<connectionId>/metadata
//   login     /api/auth/saml/<connectionId>/login       (SP-initiated, HTTP-Redirect binding)
//   ACS       /api/auth/saml/<connectionId>/acs         (HTTP-POST binding)
//
// XML signature validation is done by @node-saml/node-saml (xml-crypto); nothing here parses or
// verifies XML-DSig by hand. On top of the library's checks (signature over the Response or the
// Assertion with a configured certificate, single assertion, audience, NotBefore/NotOnOrAfter with
// a small skew, InResponseTo) this module requires:
//   - the Response answers an AuthnRequest we issued for this organization, bound to the browser by
//     a signed, expiring state cookie and the RelayState; each request ID is usable once;
//   - the signed assertion's Issuer is the configured IdP entity ID;
//   - Destination (if present) and the bearer SubjectConfirmationData Recipient are our ACS URL,
//     and its InResponseTo is the issued request ID;
//   - the assertion ID has not been accepted before (replay);
//   - the email is in one of the organization's verified domains.
// IdP-initiated (unsolicited) responses are refused.

import { randomBytes, X509Certificate } from 'crypto'
import jwt from 'jsonwebtoken'
import { DOMParser } from '@xmldom/xmldom'
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml'
import { initSchema, query } from '@/lib/db'
import { ApiError } from './api'
import { isRole, type Role } from './permissions'
import { insecureAllowed, ssoConfigFor, TXT_PREFIX, txtHost, verifyDomain } from './sso'
import { randomToken } from './crypto'

export const NAMEID_FORMATS = {
  email: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
} as const

/** Clock skew tolerated on NotBefore / NotOnOrAfter. */
export const CLOCK_SKEW_MS = 60_000
/** How long an issued AuthnRequest (and the state cookie) stays valid. */
export const REQUEST_TTL_MS = 10 * 60_000
export const SAML_COOKIE = 'planora-saml'
export const SAML_COOKIE_PATH = '/api/auth/saml'
const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_METADATA_BYTES = 256 * 1024

export interface GroupRole { group: string; role: Role }

export interface SamlConfig {
  enabled: boolean
  /** Random, stable identifier used in the SP URLs (not the organization id) */
  connectionId: string
  idpEntityId: string
  /** IdP single sign-on service URL (HTTP-Redirect binding) */
  ssoUrl: string
  /** IdP signing certificates, PEM. More than one during a certificate rollover. */
  certs: string[]
  nameIdFormat: string
  /** Attribute names; empty = use the common names (see EMAIL_ATTRS, NAME_ATTRS, GROUP_ATTRS) */
  attributes: { email: string; name: string; groups: string }
  defaultRole: Role
  /** IdP group → Planora role. Applied on every sign-in (never to owners). */
  groupRoles: GroupRole[]
  domains: string[]
  /** Members (other than owners) must sign in with SSO */
  enforce: boolean
  verificationToken?: string
}

export const EMPTY_SAML: SamlConfig = {
  enabled: false, connectionId: '', idpEntityId: '', ssoUrl: '', certs: [], nameIdFormat: NAMEID_FORMATS.email,
  attributes: { email: '', name: '', groups: '' }, defaultRole: 'viewer', groupRoles: [], domains: [], enforce: false,
}

const str = (v: unknown, max = 2048) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function normalizeSaml(raw: unknown): SamlConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const a = (r.attributes && typeof r.attributes === 'object' ? r.attributes : {}) as Record<string, unknown>
  const formats = Object.values(NAMEID_FORMATS) as string[]
  return {
    enabled: r.enabled === true,
    connectionId: /^[A-Za-z0-9_-]{8,64}$/.test(str(r.connectionId)) ? str(r.connectionId) : '',
    idpEntityId: str(r.idpEntityId),
    ssoUrl: str(r.ssoUrl),
    certs: Array.isArray(r.certs) ? r.certs.filter((c): c is string => typeof c === 'string' && c.length < 20_000).slice(0, 4) : [],
    nameIdFormat: formats.includes(str(r.nameIdFormat)) ? str(r.nameIdFormat) : NAMEID_FORMATS.email,
    attributes: { email: str(a.email, 300), name: str(a.name, 300), groups: str(a.groups, 300) },
    defaultRole: isRole(r.defaultRole) && r.defaultRole !== 'owner' ? r.defaultRole : 'viewer',
    groupRoles: Array.isArray(r.groupRoles)
      ? r.groupRoles.flatMap(g => {
        const o = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>
        const group = str(o.group, 300)
        return group && isRole(o.role) && o.role !== 'owner' ? [{ group, role: o.role }] : []
      }).slice(0, 50)
      : [],
    domains: Array.isArray(r.domains) ? [...new Set(r.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean))] : [],
    enforce: r.enforce === true,
    verificationToken: typeof r.verificationToken === 'string' ? r.verificationToken : undefined,
  }
}

/* ─── Certificates and IdP metadata ─────────────────── */

/** Accepts a PEM certificate or its base64 body; returns normalized PEM. Throws ApiError if it isn't an X.509 certificate. */
export function normalizeCert(input: string): string {
  const body = input.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new ApiError(400, 'The signing certificate must be a PEM or base64 X.509 certificate.')
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
  try { new X509Certificate(pem) } catch { throw new ApiError(400, 'The signing certificate could not be read as an X.509 certificate.') }
  return pem
}

/** Splits pasted text holding one or more certificates. */
export function splitCerts(text: string): string[] {
  const pems = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
  if (pems) return pems
  return text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
}

export function certInfo(pem: string): { subject: string; notAfter: string; fingerprint256: string; expired: boolean } | null {
  try {
    const c = new X509Certificate(pem)
    const notAfter = new Date(c.validTo).toISOString()
    return { subject: c.subject.replace(/\n/g, ', '), notAfter, fingerprint256: c.fingerprint256, expired: Date.parse(notAfter) < Date.now() }
  } catch { return null }
}

function elementsByLocalName(root: Node, name: string): Element[] {
  const out: Element[] = []
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        if ((c as Element).localName === name) out.push(c as Element)
        walk(c)
      }
    }
  }
  walk(root)
  return out
}

function parseXml(xml: string): Document {
  let failed = false
  const doc = new DOMParser({ errorHandler: { error: () => { failed = true }, fatalError: () => { failed = true } } }).parseFromString(xml, 'text/xml')
  if (failed || !doc?.documentElement) throw new ApiError(400, 'That is not well-formed XML.')
  return doc as unknown as Document
}

/** Reads the fields we need from IdP metadata XML (EntityDescriptor with an IDPSSODescriptor). */
export function parseIdpMetadata(xml: string): { idpEntityId: string; ssoUrl: string; certs: string[] } {
  if (!xml || xml.length > MAX_METADATA_BYTES) throw new ApiError(400, 'Paste the identity provider metadata XML (up to 256 KB).')
  if (/<!DOCTYPE/i.test(xml)) throw new ApiError(400, 'Metadata with a DOCTYPE is not accepted.')
  const doc = parseXml(xml)
  const entity = doc.documentElement.localName === 'EntityDescriptor' ? doc.documentElement : elementsByLocalName(doc, 'EntityDescriptor')[0]
  if (!entity) throw new ApiError(400, 'No EntityDescriptor found in the metadata.')
  const idp = elementsByLocalName(entity, 'IDPSSODescriptor')[0]
  if (!idp) throw new ApiError(400, 'The metadata has no IDPSSODescriptor (is this the identity provider metadata?).')
  const sso = elementsByLocalName(idp, 'SingleSignOnService')
  const redirect = sso.find(e => e.getAttribute('Binding') === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect')
  const certs = elementsByLocalName(idp, 'KeyDescriptor')
    .filter(k => !k.getAttribute('use') || k.getAttribute('use') === 'signing')
    .flatMap(k => elementsByLocalName(k, 'X509Certificate').map(c => c.textContent || ''))
    .filter(Boolean)
  return {
    idpEntityId: entity.getAttribute('entityID') || '',
    ssoUrl: redirect?.getAttribute('Location') || '',
    certs: [...new Set(certs.map(normalizeCert))],
  }
}

/* ─── Storage ───────────────────────────────────────── */

export async function samlConfigFor(orgId: string): Promise<SamlConfig> {
  await initSchema()
  const res = await query('SELECT saml FROM organizations WHERE id=$1', [orgId])
  return normalizeSaml(res.rows[0]?.saml)
}

export async function samlByConnection(connectionId: string): Promise<{ orgId: string; plan: string; config: SamlConfig } | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(connectionId)) return null
  await initSchema()
  const res = await query(`SELECT id, plan, saml FROM organizations WHERE saml->>'connectionId'=$1`, [connectionId])
  const row = res.rows[0]
  return row ? { orgId: String(row.id), plan: String(row.plan || 'free'), config: normalizeSaml(row.saml) } : null
}

/** The organization whose SAML connection serves this email's domain (only when SAML is on). */
export async function samlOrgForEmail(email: string): Promise<{ orgId: string; config: SamlConfig } | null> {
  await initSchema()
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain) return null
  const res = await query('SELECT o.id, o.saml FROM saml_domains d JOIN organizations o ON o.id=d.org_id WHERE d.domain=$1', [domain])
  if (!res.rows[0]) return null
  const config = normalizeSaml(res.rows[0].saml)
  return config.enabled ? { orgId: String(res.rows[0].id), config } : null
}

/** Password sign-in is refused for members (not owners) when either OIDC or SAML SSO is enforced. */
export async function ssoEnforced(orgId: string): Promise<boolean> {
  const [oidc, saml] = await Promise.all([ssoConfigFor(orgId), samlConfigFor(orgId)])
  return (oidc.enabled && oidc.enforce) || (saml.enabled && saml.enforce)
}

export interface SpUrls { entityId: string; acsUrl: string; metadataUrl: string; loginUrl: string }
export function spUrls(origin: string, connectionId: string): SpUrls {
  const base = `${origin.replace(/\/$/, '')}/api/auth/saml/${connectionId}`
  return { entityId: `${base}/metadata`, metadataUrl: `${base}/metadata`, acsUrl: `${base}/acs`, loginUrl: `${base}/login` }
}

/** What admins see. Certificates are public material, so they are returned with their details. */
export function publicSaml(c: SamlConfig, origin: string) {
  return {
    enabled: c.enabled, idpEntityId: c.idpEntityId, ssoUrl: c.ssoUrl, nameIdFormat: c.nameIdFormat, attributes: c.attributes,
    defaultRole: c.defaultRole, groupRoles: c.groupRoles, domains: c.domains, enforce: c.enforce,
    certs: c.certs.map(pem => ({ pem, ...certInfo(pem) })),
    sp: c.connectionId ? spUrls(origin, c.connectionId) : null,
    verification: c.verificationToken ? { host: '_planora-challenge.<domain>', value: `${TXT_PREFIX}${c.verificationToken}` } : null,
  }
}

/** For the audit log: no PEM bodies, just what changed. */
export function auditableSaml(c: SamlConfig) {
  return {
    enabled: c.enabled, idpEntityId: c.idpEntityId, ssoUrl: c.ssoUrl, nameIdFormat: c.nameIdFormat, attributes: c.attributes, defaultRole: c.defaultRole,
    groupRoles: c.groupRoles, domains: c.domains, enforce: c.enforce, certFingerprints: c.certs.map(p => certInfo(p)?.fingerprint256 || 'unreadable'),
  }
}

export interface SamlInput {
  enabled?: boolean; idpEntityId?: string; ssoUrl?: string; certs?: string[] | string; nameIdFormat?: string
  attributes?: Partial<SamlConfig['attributes']>; defaultRole?: string; groupRoles?: unknown; domains?: string[]; enforce?: boolean
}

function validateSsoUrl(url: string) {
  let u: URL
  try { u = new URL(url) } catch { throw new ApiError(400, 'The IdP single sign-on URL must be a URL.') }
  if (u.protocol !== 'https:' && !(insecureAllowed() && u.protocol === 'http:')) throw new ApiError(400, 'The IdP single sign-on URL must use https.')
}

/** Saves the SAML configuration and claims its domains (each domain belongs to one organization). */
export async function saveSamlConfig(orgId: string, input: SamlInput): Promise<SamlConfig> {
  const cur = await samlConfigFor(orgId)
  const oidc = await ssoConfigFor(orgId)
  const certs = input.certs === undefined ? cur.certs
    : (Array.isArray(input.certs) ? input.certs : splitCerts(input.certs)).filter(c => c.trim()).map(normalizeCert)
  // Fields left out of the request keep their saved values.
  const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  const next = normalizeSaml({
    ...cur,
    ...given,
    attributes: { ...cur.attributes, ...(input.attributes || {}) },
    certs,
    connectionId: cur.connectionId || randomToken(12),
    // One DNS TXT record proves a domain for both OIDC and SAML.
    verificationToken: cur.verificationToken || oidc.verificationToken || randomToken(12),
  })
  if (next.domains.some(d => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))) throw new ApiError(400, 'Domains look like example.com (no @ or https://).')
  if (next.enabled) {
    if (!next.idpEntityId || !next.ssoUrl || !next.certs.length || !next.domains.length) {
      throw new ApiError(400, 'IdP entity ID, single sign-on URL, at least one signing certificate and at least one email domain are required.')
    }
    validateSsoUrl(next.ssoUrl)
    const unverified: string[] = []
    for (const dmn of next.domains) if (!(await verifyDomain(dmn, next.verificationToken!))) unverified.push(dmn)
    if (unverified.length) {
      await query('UPDATE organizations SET saml=$2 WHERE id=$1', [orgId, JSON.stringify({ ...next, enabled: false })])
      throw new ApiError(400, `Prove you own ${unverified.join(', ')}: add a DNS TXT record at ${unverified.map(txtHost).join(', ')} with the value ${TXT_PREFIX}${next.verificationToken}, wait a few minutes, then save again.`, 'domain_unverified', { verification: { value: `${TXT_PREFIX}${next.verificationToken}`, hosts: unverified.map(txtHost) } })
    }
  }
  await initSchema()
  const taken = await query('SELECT domain FROM saml_domains WHERE domain = ANY($1) AND org_id<>$2 UNION SELECT domain FROM sso_domains WHERE domain = ANY($1) AND org_id<>$2', [next.domains, orgId])
  if (taken.rows.length) throw new ApiError(409, `${taken.rows.map(r => r.domain).join(', ')} is already claimed by another organization.`)
  await query('DELETE FROM saml_domains WHERE org_id=$1', [orgId])
  if (next.enabled) for (const dmn of next.domains) await query('INSERT INTO saml_domains (domain, org_id) VALUES ($1,$2)', [dmn, orgId])
  await query('UPDATE organizations SET saml=$2 WHERE id=$1', [orgId, JSON.stringify(next)])
  return next
}

/* ─── Request IDs and replay protection ─────────────── */

/** Where issued AuthnRequest IDs and accepted assertion IDs are kept (Postgres; in-memory in tests). */
export interface SamlStore {
  /** Records an issued request ID. */
  saveRequest(id: string): Promise<void>
  /** ISO time the request was issued, if it is pending (issued for this organization and not yet used). */
  pendingRequest(id: string): Promise<string | null>
  /** Marks the request used. True only for the first caller. */
  consumeRequest(id: string): Promise<boolean>
  /** Records an accepted assertion ID. False if it was seen before (replay). */
  recordAssertion(id: string, expiresAt: Date): Promise<boolean>
}

export function dbSamlStore(orgId: string): SamlStore {
  return {
    async saveRequest(id) {
      await query('INSERT INTO saml_requests (id, org_id) VALUES ($1,$2)', [id, orgId])
    },
    async pendingRequest(id) {
      const res = await query(`SELECT created_at FROM saml_requests WHERE id=$1 AND org_id=$2 AND consumed_at IS NULL AND created_at > NOW() - make_interval(secs => $3)`, [id, orgId, REQUEST_TTL_MS / 1000])
      return res.rows[0] ? new Date(res.rows[0].created_at).toISOString() : null
    },
    async consumeRequest(id) {
      const res = await query(`UPDATE saml_requests SET consumed_at=NOW() WHERE id=$1 AND org_id=$2 AND consumed_at IS NULL AND created_at > NOW() - make_interval(secs => $3) RETURNING id`, [id, orgId, REQUEST_TTL_MS / 1000])
      return (res.rowCount ?? 0) > 0
    },
    async recordAssertion(id, expiresAt) {
      const res = await query('INSERT INTO saml_assertions (org_id, assertion_id, expires_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [orgId, id, expiresAt.toISOString()])
      return (res.rowCount ?? 0) > 0
    },
  }
}

export async function purgeExpiredSamlState(): Promise<void> {
  await query(`DELETE FROM saml_requests WHERE created_at < NOW() - INTERVAL '1 day'`)
  await query('DELETE FROM saml_assertions WHERE expires_at < NOW()')
}

/** Adapts the store to node-saml's cache interface. Consumption is done by validateSamlResponse, atomically. */
function cacheFor(store: SamlStore, onSave?: (id: string) => void): CacheProvider {
  return {
    saveAsync: async (key, value) => { await store.saveRequest(key); onSave?.(key); return { value, createdAt: Date.now() } },
    getAsync: async key => store.pendingRequest(key),
    removeAsync: async () => null,
  }
}

function samlClient(config: SamlConfig, urls: SpUrls, store: SamlStore, onSave?: (id: string) => void): SAML {
  return new SAML({
    issuer: urls.entityId,
    audience: urls.entityId,
    callbackUrl: urls.acsUrl,
    entryPoint: config.ssoUrl,
    idpIssuer: config.idpEntityId,
    idpCert: config.certs.length ? config.certs : ['-'],
    identifierFormat: config.nameIdFormat,
    // Either a signed Response or a signed Assertion; node-saml rejects a message with neither.
    wantAuthnResponseSigned: false,
    wantAssertionsSigned: false,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: 0,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    cacheProvider: cacheFor(store, onSave),
    // Let the IdP apply its own authentication policy (MFA etc.) instead of demanding a password.
    disableRequestedAuthnContext: true,
    generateUniqueId: () => `_${randomBytes(20).toString('hex')}`,
  })
}

export function spMetadataXml(config: SamlConfig, urls: SpUrls): string {
  return samlClient(config, urls, { saveRequest: async () => {}, pendingRequest: async () => null, consumeRequest: async () => false, recordAssertion: async () => false })
    .generateServiceProviderMetadata(null, null)
}

/* ─── Sign-in ───────────────────────────────────────── */

function cookieSecret() {
  const s = process.env.JWT_SECRET
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production')
  return `saml:${s || 'planora-dev-secret-change-in-production-2026'}`
}

export interface SamlState { typ: 'saml'; orgId: string; cid: string; rid: string; relay: string; test: boolean }

/** Builds the AuthnRequest redirect and the signed, short-lived state cookie that binds it to this browser. */
export async function startSaml(orgId: string, config: SamlConfig, origin: string, opts: { test?: boolean; store?: SamlStore } = {}): Promise<{ url: string; stateCookie: string; requestId: string }> {
  if (!config.connectionId || !config.ssoUrl || !config.certs.length) throw new ApiError(400, 'SAML single sign-on is not set up for this organization.')
  const store = opts.store ?? dbSamlStore(orgId)
  if (!opts.store) await purgeExpiredSamlState().catch(() => {})
  let requestId = ''
  const relay = randomToken(18)
  const url = await samlClient(config, spUrls(origin, config.connectionId), store, id => { requestId = id }).getAuthorizeUrlAsync(relay, undefined, {})
  if (!requestId) throw new Error('SAML request id was not recorded')
  const state: SamlState = { typ: 'saml', orgId, cid: config.connectionId, rid: requestId, relay, test: !!opts.test }
  const stateCookie = jwt.sign(state, cookieSecret(), { expiresIn: Math.floor(REQUEST_TTL_MS / 1000) })
  return { url, stateCookie, requestId }
}

export function readSamlState(cookie: string | undefined): SamlState {
  try {
    const st = jwt.verify(cookie || '', cookieSecret()) as SamlState
    if (st.typ !== 'saml' || !st.orgId || !st.cid || !st.rid || !st.relay) throw new Error('bad state')
    return st
  } catch {
    throw new ApiError(401, 'Your sign-in expired or was started in another browser. Start again.')
  }
}

/** Secure + SameSite=None over https (the ACS is a cross-site POST from the IdP); Lax on plain-http development hosts. */
export function samlCookieOptions(origin: string, maxAgeSec: number) {
  const secure = process.env.NODE_ENV === 'production' || origin.startsWith('https:')
  return { httpOnly: true, secure, sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax', path: SAML_COOKIE_PATH, maxAge: maxAgeSec }
}

type X = Record<string, unknown>
const arr = (v: unknown): X[] => (Array.isArray(v) ? v.filter((e): e is X => !!e && typeof e === 'object') : [])
const text = (v: unknown): string => {
  const first = Array.isArray(v) ? v[0] : v
  if (typeof first === 'string') return first.trim()
  if (first && typeof first === 'object' && typeof (first as X)._ === 'string') return String((first as X)._).trim()
  return ''
}
const attrs = (v: unknown): X => (v && typeof v === 'object' && (v as X).$ && typeof (v as X).$ === 'object' ? (v as X).$ as X : {})

export const EMAIL_ATTRS = ['email', 'mail', 'emailaddress', 'Email', 'User.Email', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'urn:oid:0.9.2342.19200300.100.1.3']
export const NAME_ATTRS = ['displayName', 'displayname', 'name', 'http://schemas.microsoft.com/identity/claims/displayname', 'urn:oid:2.16.840.1.113730.3.1.241', 'urn:oid:2.5.4.3']
export const GROUP_ATTRS = ['groups', 'group', 'memberOf', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups', 'urn:oid:1.3.6.1.4.1.5923.1.5.1.1']
const GIVEN_ATTRS = ['givenName', 'firstName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname', 'urn:oid:2.5.4.42']
const SURNAME_ATTRS = ['sn', 'surname', 'lastName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname', 'urn:oid:2.5.4.4']

function attrValues(profile: Profile, names: string[]): string[] {
  const a = (profile.attributes || {}) as Record<string, unknown>
  for (const n of names) {
    const v = a[n]
    if (v === undefined) continue
    const list = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
    if (list.length) return list
  }
  return []
}

const ROLE_RANK: Role[] = ['admin', 'scheduler', 'reviewer', 'viewer']
/** The most privileged role any of the member's groups maps to, or null if none match. */
export function roleForGroups(groups: string[], mapping: GroupRole[]): Role | null {
  const set = new Set(groups.map(g => g.toLowerCase()))
  const matched = mapping.filter(m => set.has(m.group.toLowerCase())).map(m => m.role)
  return ROLE_RANK.find(r => matched.includes(r)) ?? null
}

export interface SamlIdentity {
  orgId: string; email: string; name: string; nameId: string; groups: string[]
  /** Role from the group mapping (null: no mapped group) */
  groupRole: Role | null
  assertionId: string; sessionIndex?: string
}

export interface ValidateInput {
  orgId: string
  config: SamlConfig
  urls: SpUrls
  samlResponse: string
  /** The AuthnRequest ID from the state cookie */
  requestId: string
  store: SamlStore
}

/** Validates a SAML Response posted to the ACS and maps it to an identity. Throws ApiError(401/403) on any failure. */
export async function validateSamlResponse(input: ValidateInput): Promise<SamlIdentity> {
  const { config, urls, store, requestId } = input
  const reject = (why: string): never => { throw new ApiError(401, `The SAML response was rejected (${why}).`, 'saml_invalid') }
  if (!input.samlResponse || input.samlResponse.length > MAX_RESPONSE_BYTES) reject('missing or too large')
  const xml = Buffer.from(input.samlResponse, 'base64').toString('utf8')
  if (/<!DOCTYPE/i.test(xml)) reject('DOCTYPE not allowed')

  // The outer Response (may be unsigned when only the assertion is signed): it must answer our request.
  let root: Element
  try { root = parseXml(xml).documentElement } catch { return reject('malformed XML') }
  if (root.localName !== 'Response') reject('not a SAML Response')
  if (root.getAttribute('InResponseTo') !== requestId) reject('InResponseTo does not match the sign-in request')
  const destination = root.getAttribute('Destination')
  if (destination && destination !== urls.acsUrl) reject('Destination is not this service')

  let profile: Profile | null
  try {
    profile = (await samlClient(config, urls, store).validatePostResponseAsync({ SAMLResponse: input.samlResponse })).profile
  } catch (err) {
    await store.consumeRequest(requestId).catch(() => false)
    if (err instanceof ApiError) throw err
    return reject((err as Error).message.replace(/\s+/g, ' ').slice(0, 160))
  }
  // One response per request, even under concurrent posts.
  if (!(await store.consumeRequest(requestId))) reject('this sign-in request was already used or has expired')
  if (!profile) return reject('no assertion')

  // Checks on the signed assertion (getAssertion() is the verified XML only).
  const assertion = (profile.getAssertion?.() as X | undefined)?.Assertion as X | undefined
  if (!assertion) return reject('no signed assertion')
  const assertionId = String(attrs(assertion).ID || '')
  if (!assertionId) reject('assertion has no ID')
  if (text(assertion.Issuer) !== config.idpEntityId) reject('assertion Issuer is not the configured identity provider')
  const responseIssuer = elementsByLocalName(root, 'Issuer').find(e => e.parentNode === root)?.textContent?.trim()
  if (responseIssuer && responseIssuer !== config.idpEntityId) reject('response Issuer is not the configured identity provider')
  const subject = arr(assertion.Subject)[0]
  const bearer = arr(subject?.SubjectConfirmation).filter(sc => attrs(sc).Method === 'urn:oasis:names:tc:SAML:2.0:cm:bearer')
  const confirmed = bearer.some(sc => arr(sc.SubjectConfirmationData).some(d => {
    const a = attrs(d)
    return a.Recipient === urls.acsUrl && a.InResponseTo === requestId && typeof a.NotOnOrAfter === 'string'
  }))
  if (!confirmed) reject('no bearer confirmation for this service and request (Recipient / InResponseTo)')

  const conditions = arr(assertion.Conditions)[0]
  const notOnOrAfter = Date.parse(String(attrs(conditions).NotOnOrAfter || ''))
  const expires = new Date(Math.max(Number.isFinite(notOnOrAfter) ? notOnOrAfter : 0, Date.now()) + CLOCK_SKEW_MS + 3_600_000)
  if (!(await store.recordAssertion(assertionId, expires))) reject('this assertion was already used')

  // Identity
  const nameId = String(profile.nameID || '')
  const emailAttr = attrValues(profile, config.attributes.email ? [config.attributes.email] : EMAIL_ATTRS)[0]
  const email = String(emailAttr || (/^[^@\s]+@[^@\s]+$/.test(nameId) ? nameId : '')).toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(401, 'The identity provider did not send an email address.', 'saml_invalid')
  const domain = email.split('@')[1]
  if (!config.domains.includes(domain)) throw new ApiError(403, `${domain} is not an allowed domain for this organization.`, 'saml_domain')
  const given = attrValues(profile, GIVEN_ATTRS)[0], family = attrValues(profile, SURNAME_ATTRS)[0]
  const name = (attrValues(profile, config.attributes.name ? [config.attributes.name] : NAME_ATTRS)[0] || [given, family].filter(Boolean).join(' ') || email.split('@')[0]).slice(0, 120)
  const groups = attrValues(profile, config.attributes.groups ? [config.attributes.groups] : GROUP_ATTRS).slice(0, 500)
  return { orgId: input.orgId, email, name, nameId, groups, groupRole: roleForGroups(groups, config.groupRoles), assertionId, sessionIndex: profile.sessionIndex }
}

/** Where an admin lands after a test sign-in from Organization → SAML (no session is created in test mode). */
export const samlTestResultPath = (ok: boolean, message: string) => `/dashboard/org?${new URLSearchParams({ saml_test: ok ? 'ok' : 'failed', saml_message: message.slice(0, 300) })}#saml`
