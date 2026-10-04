// Single sign-on with OpenID Connect (Microsoft Entra ID, Okta, Google Workspace, Ping, Keycloak…).
//
// Flow: the user enters their work email → the email domain selects the organization (domains
// are unique across organizations) → authorization-code flow with PKCE, state and nonce →
// the ID token's signature is verified against the provider's published keys (JWKS) and its
// issuer, audience, expiry and nonce are checked → the email must be verified and in an allowed
// domain → the member is signed in, or created just-in-time with the organization's default role.

import { createHash, createPublicKey, randomBytes } from 'crypto'
import { resolveTxt } from 'dns/promises'
import jwt from 'jsonwebtoken'
import { initSchema, query } from '@/lib/db'
import { decrypt, encrypt } from './crypto'
import { ApiError } from './api'
import { isRole, type Role } from './permissions'

export interface SsoConfig {
  enabled: boolean
  issuer: string
  clientId: string
  /** Encrypted client secret (never returned to the browser) */
  clientSecretEnc?: string
  domains: string[]
  defaultRole: Role
  /** Members (other than owners, who keep password sign-in as break-glass) must use SSO */
  enforce: boolean
  /** Per-organization token proving domain ownership via a DNS TXT record */
  verificationToken?: string
}

export const EMPTY_SSO: SsoConfig = { enabled: false, issuer: '', clientId: '', domains: [], defaultRole: 'viewer', enforce: false }

export function normalizeSso(raw: unknown): SsoConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: r.enabled === true,
    issuer: typeof r.issuer === 'string' ? r.issuer.trim().replace(/\/+$/, '') : '',
    clientId: typeof r.clientId === 'string' ? r.clientId.trim() : '',
    clientSecretEnc: typeof r.clientSecretEnc === 'string' ? r.clientSecretEnc : undefined,
    domains: Array.isArray(r.domains) ? r.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean) : [],
    defaultRole: isRole(r.defaultRole) && r.defaultRole !== 'owner' ? r.defaultRole : 'viewer',
    enforce: r.enforce === true,
    verificationToken: typeof r.verificationToken === 'string' ? r.verificationToken : undefined,
  }
}

export const TXT_PREFIX = 'planora-domain-verification='
export const txtHost = (domain: string) => `_planora-challenge.${domain}`

/** Domain ownership: _planora-challenge.<domain> must have a TXT record planora-domain-verification=<token>. */
export async function verifyDomain(domain: string, token: string): Promise<boolean> {
  if (insecureAllowed() && /\.(example|test|invalid|localhost)$/.test(domain)) return true
  try {
    const records = await resolveTxt(txtHost(domain))
    return records.some(parts => parts.join('') === `${TXT_PREFIX}${token}`)
  } catch {
    return false
  }
}

/** What admins see: everything except the secret. */
export const publicSso = (c: SsoConfig) => ({
  enabled: c.enabled, issuer: c.issuer, clientId: c.clientId, hasSecret: !!c.clientSecretEnc, domains: c.domains, defaultRole: c.defaultRole, enforce: c.enforce,
  verification: c.verificationToken ? { host: '_planora-challenge.<domain>', value: `${TXT_PREFIX}${c.verificationToken}` } : null,
})

const insecureAllowed = () => /^(1|true)$/i.test(process.env.PLANORA_ALLOW_INSECURE_OIDC || '')

export function validateIssuer(issuer: string): void {
  let u: URL
  try { u = new URL(issuer) } catch { throw new ApiError(400, 'Issuer must be a URL, e.g. https://login.microsoftonline.com/<tenant>/v2.0') }
  if (u.protocol !== 'https:' && !(insecureAllowed() && u.protocol === 'http:')) throw new ApiError(400, 'The issuer must use https.')
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
const discoveryCache = new Map<string, { at: number; d: Discovery }>()
const jwksCache = new Map<string, { at: number; keys: Record<string, unknown>[] }>()

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new ApiError(502, `The identity provider returned ${res.status} for ${new URL(url).pathname}.`)
  return res.json()
}

export async function discover(issuer: string): Promise<Discovery> {
  validateIssuer(issuer)
  const hit = discoveryCache.get(issuer)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.d
  const d = await getJson(`${issuer}/.well-known/openid-configuration`) as Discovery
  if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw new ApiError(502, 'The identity provider configuration is incomplete.')
  if (d.issuer?.replace(/\/+$/, '') !== issuer) throw new ApiError(502, `The provider reports issuer ${d.issuer}, which doesn't match ${issuer}.`)
  discoveryCache.set(issuer, { at: Date.now(), d })
  return d
}

async function signingKey(jwksUri: string, kid: string | undefined): Promise<ReturnType<typeof createPublicKey>> {
  const load = async (force: boolean) => {
    const hit = jwksCache.get(jwksUri)
    if (!force && hit && Date.now() - hit.at < 3_600_000) return hit.keys
    const keys = ((await getJson(jwksUri)) as { keys?: Record<string, unknown>[] }).keys || []
    jwksCache.set(jwksUri, { at: Date.now(), keys })
    return keys
  }
  let keys = await load(false)
  let jwk = keys.find(k => !kid || k.kid === kid)
  if (!jwk) { keys = await load(true); jwk = keys.find(k => !kid || k.kid === kid) } // key rotation
  if (!jwk) throw new ApiError(401, 'The sign-in token was signed with an unknown key.')
  return createPublicKey({ key: jwk as never, format: 'jwk' })
}

const b64url = (b: Buffer) => b.toString('base64url')

export async function orgForEmail(email: string): Promise<{ orgId: string; config: SsoConfig } | null> {
  await initSchema()
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain) return null
  const res = await query('SELECT o.id, o.sso FROM sso_domains d JOIN organizations o ON o.id=d.org_id WHERE d.domain=$1', [domain])
  if (!res.rows[0]) return null
  const config = normalizeSso(res.rows[0].sso)
  return config.enabled ? { orgId: String(res.rows[0].id), config } : null
}

export async function ssoConfigFor(orgId: string): Promise<SsoConfig> {
  await initSchema()
  const res = await query('SELECT sso FROM organizations WHERE id=$1', [orgId])
  return normalizeSso(res.rows[0]?.sso)
}

/** Builds the redirect to the identity provider and the signed, short-lived state for the callback. */
export async function startSso(orgId: string, config: SsoConfig, email: string, callbackUrl: string): Promise<{ url: string; stateCookie: string }> {
  const d = await discover(config.issuer)
  const verifier = b64url(randomBytes(32))
  const nonce = b64url(randomBytes(16))
  const state = b64url(randomBytes(16))
  const url = new URL(d.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.clientId, redirect_uri: callbackUrl, scope: 'openid email profile',
    state, nonce, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', login_hint: email,
  }).toString()
  const stateCookie = jwt.sign({ typ: 'sso', orgId, state, nonce, verifier, callbackUrl }, cookieSecret(), { expiresIn: '10m' })
  return { url: url.toString(), stateCookie }
}

function cookieSecret() {
  const s = process.env.JWT_SECRET
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production')
  return `sso:${s || 'planora-dev-secret-change-in-production-2026'}`
}

export interface SsoIdentity { orgId: string; email: string; name: string; subject: string; config: SsoConfig }

/** Completes the flow: checks state, exchanges the code, verifies the ID token. */
export async function finishSso(params: URLSearchParams, stateCookie: string | undefined): Promise<SsoIdentity> {
  if (params.get('error')) throw new ApiError(401, `The identity provider declined the sign-in (${params.get('error_description') || params.get('error')}).`)
  let st: { orgId: string; state: string; nonce: string; verifier: string; callbackUrl: string }
  try { st = jwt.verify(stateCookie || '', cookieSecret()) as typeof st } catch { throw new ApiError(401, 'Your sign-in expired or was started in another browser. Start again.') }
  if (!params.get('state') || params.get('state') !== st.state) throw new ApiError(401, 'Sign-in state mismatch. Start again.')
  const code = params.get('code')
  if (!code) throw new ApiError(400, 'Missing authorization code.')
  const config = await ssoConfigFor(st.orgId)
  if (!config.enabled || !config.clientSecretEnc) throw new ApiError(400, 'Single sign-on is not set up for this organization.')
  const d = await discover(config.issuer)
  const res = await fetch(d.token_endpoint, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: st.callbackUrl, client_id: config.clientId, client_secret: decrypt(config.clientSecretEnc), code_verifier: st.verifier }),
  })
  const tok = await res.json().catch(() => ({})) as { id_token?: string; error?: string; error_description?: string }
  if (!res.ok || !tok.id_token) throw new ApiError(401, `The identity provider refused the sign-in (${tok.error_description || tok.error || res.status}).`)
  const header = jwt.decode(tok.id_token, { complete: true })?.header
  if (!header || !['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'PS256'].includes(header.alg)) throw new ApiError(401, 'Unsupported token signature algorithm.')
  const key = await signingKey(d.jwks_uri, header.kid)
  let claims: Record<string, unknown>
  try {
    claims = jwt.verify(tok.id_token, key, { algorithms: [header.alg as jwt.Algorithm], issuer: config.issuer, audience: config.clientId, clockTolerance: 60 }) as Record<string, unknown>
  } catch (err) {
    throw new ApiError(401, `The sign-in token is not valid (${(err as Error).message}).`)
  }
  if (claims.nonce !== st.nonce) throw new ApiError(401, 'Sign-in token nonce mismatch.')
  const email = String(claims.email || claims.preferred_username || claims.upn || '').toLowerCase()
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new ApiError(401, 'The identity provider did not return an email address.')
  if (claims.email_verified === false) throw new ApiError(401, 'Your email address is not verified with the identity provider.')
  const domain = email.split('@')[1]
  if (!config.domains.includes(domain)) throw new ApiError(403, `${domain} is not an allowed domain for this organization.`)
  return { orgId: st.orgId, email, name: String(claims.name || email.split('@')[0]).slice(0, 120), subject: String(claims.sub || ''), config }
}

/** Saves configuration and claims the domains (each domain can belong to only one organization). */
export async function saveSsoConfig(orgId: string, input: { enabled?: boolean; issuer?: string; clientId?: string; clientSecret?: string; domains?: string[]; defaultRole?: string; enforce?: boolean }): Promise<SsoConfig> {
  const cur = await ssoConfigFor(orgId)
  const next = normalizeSso({
    ...cur,
    ...input,
    clientSecretEnc: input.clientSecret ? encrypt(input.clientSecret) : cur.clientSecretEnc,
    verificationToken: cur.verificationToken || b64url(randomBytes(12)),
  })
  if (next.domains.some(d => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))) throw new ApiError(400, 'Domains look like example.com (no @ or https://).')
  if (next.enabled) {
    if (!next.issuer || !next.clientId || !next.clientSecretEnc || !next.domains.length) throw new ApiError(400, 'Issuer, client ID, client secret and at least one email domain are required.')
    await discover(next.issuer) // fail fast if the provider can't be reached or is misconfigured
    const unverified: string[] = []
    for (const dmn of next.domains) if (!(await verifyDomain(dmn, next.verificationToken!))) unverified.push(dmn)
    if (unverified.length) {
      await query('UPDATE organizations SET sso=$2 WHERE id=$1', [orgId, JSON.stringify({ ...next, enabled: false })])
      throw new ApiError(400, `Prove you own ${unverified.join(', ')}: add a DNS TXT record at ${unverified.map(txtHost).join(', ')} with the value ${TXT_PREFIX}${next.verificationToken}, wait a few minutes, then save again.`, 'domain_unverified', { verification: { value: `${TXT_PREFIX}${next.verificationToken}`, hosts: unverified.map(txtHost) } })
    }
  }
  await initSchema()
  const taken = await query('SELECT domain FROM sso_domains WHERE domain = ANY($1) AND org_id<>$2', [next.domains, orgId])
  if (taken.rows.length) throw new ApiError(409, `${taken.rows.map(r => r.domain).join(', ')} is already claimed by another organization.`)
  // Domains are claimed only while SSO is on and ownership has been verified.
  await query('DELETE FROM sso_domains WHERE org_id=$1', [orgId])
  if (next.enabled) for (const dmn of next.domains) await query('INSERT INTO sso_domains (domain, org_id) VALUES ($1,$2)', [dmn, orgId])
  await query('UPDATE organizations SET sso=$2 WHERE id=$1', [orgId, JSON.stringify(next)])
  return next
}
