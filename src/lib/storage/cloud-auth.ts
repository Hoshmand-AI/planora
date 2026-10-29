// Sign-in for cloud storage connections, instead of pasting keys:
//   Microsoft Azure   OAuth 2.0 (authorization code + PKCE) with RunF9's multi-tenant app registration;
//                     RunF9 keeps a refresh token and calls Blob Storage as the signed-in user.
//   Google Cloud      OAuth 2.0 (authorization code + PKCE, offline access) with RunF9's OAuth client;
//                     RunF9 keeps a refresh token and calls Cloud Storage as the signed-in user.
//   Amazon S3         a CloudFormation stack the admin launches in one click creates an IAM role that
//                     trusts RunF9's AWS account with this organization's external ID; RunF9 assumes
//                     it (STS AssumeRole) for one-hour credentials. No long-lived keys anywhere.
//
// Each method is offered only when the RunF9 identity it needs is configured:
//   RUNF9_AZURE_CLIENT_ID / RUNF9_AZURE_CLIENT_SECRET     (Microsoft Entra app registration)
//   RUNF9_GOOGLE_CLIENT_ID / RUNF9_GOOGLE_CLIENT_SECRET   (Google Cloud OAuth client)
//   RUNF9_AWS_ACCOUNT_ID, RUNF9_AWS_ACCESS_KEY_ID / RUNF9_AWS_SECRET_ACCESS_KEY  (RunF9's IAM user
//                     that may only call sts:AssumeRole)
// Test-only overrides (honoured only where custom storage endpoints are allowed):
//   RUNF9_AZURE_AUTHORITY, RUNF9_GOOGLE_AUTH_URL, RUNF9_GOOGLE_TOKEN_URL, RUNF9_AWS_STS_ENDPOINT

import { createHash, createHmac, randomBytes } from 'crypto'
import { egressProblem } from '@/lib/server/egress'
import { customEndpointsAllowed, StorageError, type StorageConfig, type StorageProvider, type StorageSecret } from './providers'
import { signV4, uriEncode } from './sigv4'

type Env = Record<string, string | undefined>

/** Holds the in-progress sign-in (encrypted) between /api/storage and its callback. */
export const STORAGE_OAUTH_COOKIE = 'runf9-storage-oauth'

export type Credentials =
  | { kind: 'keys'; accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | { kind: 'bearer'; token: string }
  | { kind: 'sas'; sas: string }
export type CredentialSource = () => Promise<Credentials>

const override = (env: Env, name: string, fallback: string) => (customEndpointsAllowed(env) && env[name]?.trim()) || fallback

const azureApp = (env: Env) => {
  const clientId = env.RUNF9_AZURE_CLIENT_ID?.trim(), clientSecret = env.RUNF9_AZURE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  const authority = override(env, 'RUNF9_AZURE_AUTHORITY', 'https://login.microsoftonline.com').replace(/\/+$/, '')
  return { clientId, clientSecret, authorize: `${authority}/organizations/oauth2/v2.0/authorize`, token: `${authority}/organizations/oauth2/v2.0/token`, scope: 'https://storage.azure.com/user_impersonation offline_access' }
}
const googleApp = (env: Env) => {
  const clientId = env.RUNF9_GOOGLE_CLIENT_ID?.trim(), clientSecret = env.RUNF9_GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return {
    clientId, clientSecret,
    authorize: override(env, 'RUNF9_GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    token: override(env, 'RUNF9_GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
  }
}
const awsIdentity = (env: Env) => {
  const accountId = env.RUNF9_AWS_ACCOUNT_ID?.trim(), accessKeyId = env.RUNF9_AWS_ACCESS_KEY_ID?.trim(), secretAccessKey = env.RUNF9_AWS_SECRET_ACCESS_KEY?.trim()
  if (!accountId || !/^\d{12}$/.test(accountId) || !accessKeyId || !secretAccessKey) return null
  return { accountId, accessKeyId, secretAccessKey, sts: override(env, 'RUNF9_AWS_STS_ENDPOINT', 'https://sts.amazonaws.com').replace(/\/+$/, '') }
}

/** Which sign-in methods this deployment offers. */
export function signInOptions(env: Env = process.env): { azure: boolean; gcp: boolean; aws: boolean } {
  return { azure: !!azureApp(env), gcp: !!googleApp(env), aws: !!awsIdentity(env) }
}

async function post(url: string, form: Record<string, string>, env: Env): Promise<Record<string, unknown>> {
  const problem = egressProblem(url, env)
  if (problem) throw new StorageError(problem, 403)
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form), redirect: 'manual', signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  } catch { throw new StorageError('Could not reach the sign-in service.', 502) }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const code = String(data.error ?? res.status)
    throw new StorageError(code === 'invalid_grant' ? 'The sign-in has expired or was revoked. Sign in again from Organization > Cloud storage.' : `The sign-in service refused the request (${code.slice(0, 60)}).`, code === 'invalid_grant' ? 403 : 502)
  }
  return data
}

/* ─── OAuth (Azure, Google) ─────────────────────────────── */

export interface OAuthStart { url: string; verifier: string; state: string }

export function startOAuth(provider: 'azure' | 'gcp', redirectUri: string, env: Env = process.env, loginHint?: string): OAuthStart {
  const app = provider === 'azure' ? azureApp(env) : googleApp(env)
  if (!app) throw new StorageError(`Sign-in with ${provider === 'azure' ? 'Microsoft' : 'Google'} is not set up on this RunF9.`, 400)
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('base64url')
  const q = new URLSearchParams({
    client_id: app.clientId, response_type: 'code', redirect_uri: redirectUri, scope: app.scope, state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    ...(provider === 'gcp' ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' } : { prompt: 'select_account' }),
    ...(loginHint ? { login_hint: loginHint } : {}),
  })
  return { url: `${app.authorize}?${q}`, verifier, state }
}

export async function finishOAuth(provider: 'azure' | 'gcp', code: string, verifier: string, redirectUri: string, env: Env = process.env): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const app = provider === 'azure' ? azureApp(env) : googleApp(env)
  if (!app) throw new StorageError('Sign-in is not set up on this RunF9.', 400)
  const d = await post(app.token, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret, code_verifier: verifier, ...(provider === 'azure' ? { scope: app.scope } : {}) }, env)
  if (typeof d.refresh_token !== 'string' || typeof d.access_token !== 'string') throw new StorageError('The sign-in did not grant offline access. Try again and accept every permission.', 400)
  return { refreshToken: d.refresh_token, accessToken: d.access_token, expiresIn: Number(d.expires_in) || 3600 }
}

async function refreshOAuth(provider: 'azure' | 'gcp', refreshToken: string, env: Env): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string }> {
  const app = provider === 'azure' ? azureApp(env) : googleApp(env)
  if (!app) throw new StorageError('Sign-in is no longer set up on this RunF9; reconnect this storage with a key.', 400)
  const d = await post(app.token, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret, ...(provider === 'azure' ? { scope: app.scope } : {}) }, env)
  if (typeof d.access_token !== 'string') throw new StorageError('The sign-in service did not return an access token.', 502)
  return { accessToken: d.access_token, expiresIn: Number(d.expires_in) || 3600, refreshToken: typeof d.refresh_token === 'string' ? d.refresh_token : undefined }
}

/* ─── AWS role (CloudFormation + STS) ───────────────────── */

/** This organization's external ID for the AWS role trust policy: stable, unguessable, unique per firm. */
export function awsExternalId(orgId: string, env: Env = process.env): string {
  const key = env.RUNF9_ENCRYPTION_KEY || env.JWT_SECRET || 'runf9-dev-encryption-key'
  return `runf9-${createHmac('sha256', `runf9-aws-external-id:${key}`).update(orgId).digest('hex').slice(0, 32)}`
}

/** The one-click "create the role" link: a CloudFormation quick-create page with everything filled in. */
export function awsLaunchUrl(o: { orgId: string; bucket: string; region: string; prefix?: string; templateUrl: string }, env: Env = process.env): string {
  const id = awsIdentity(env)
  if (!id) throw new StorageError('Sign-in with AWS is not set up on this RunF9.', 400)
  const q = new URLSearchParams({
    templateURL: o.templateUrl, stackName: `RunF9-Storage-${o.bucket.replace(/[^A-Za-z0-9-]/g, '-')}`.slice(0, 128),
    param_RunF9AccountId: id.accountId, param_ExternalId: awsExternalId(o.orgId, env), param_BucketName: o.bucket, param_FolderPrefix: o.prefix ?? '',
  })
  return `https://console.aws.amazon.com/cloudformation/home?region=${encodeURIComponent(o.region)}#/stacks/quickcreate?${q}`
}

export const ROLE_ARN = /^arn:aws(-us-gov|-cn)?:iam::\d{12}:role\/[\w+=,.@\/-]{1,512}$/

async function assumeRole(roleArn: string, externalId: string, sessionName: string, env: Env): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: number }> {
  const id = awsIdentity(env)
  if (!id) throw new StorageError('Sign-in with AWS is no longer set up on this RunF9; reconnect this storage with a key.', 400)
  const url = new URL(`${id.sts}/`)
  for (const [k, v] of Object.entries({ Action: 'AssumeRole', Version: '2011-06-15', RoleArn: roleArn, RoleSessionName: sessionName, ExternalId: externalId, DurationSeconds: '3600' })) url.searchParams.set(k, v)
  const problem = egressProblem(url.toString(), env)
  if (problem) throw new StorageError(problem, 403)
  const headers = signV4({ method: 'GET', url, region: 'us-east-1', service: 'sts', accessKeyId: id.accessKeyId, secretAccessKey: id.secretAccessKey })
  const qs = [...url.searchParams.entries()].map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&')
  let res: Response
  try { res = await fetch(`${url.origin}${url.pathname}?${qs}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000), cache: 'no-store' }) } catch { throw new StorageError('Could not reach AWS STS.', 502) }
  const xml = await res.text()
  if (!res.ok) {
    const code = /<Code>([^<]{1,80})<\/Code>/.exec(xml)?.[1] ?? String(res.status)
    throw new StorageError(code === 'AccessDenied' ? 'AWS refused to let RunF9 use the role. Check that the CloudFormation stack finished and the role ARN is the one it created.' : `AWS STS refused the request (${code}).`, code === 'AccessDenied' ? 403 : 502)
  }
  const pick = (tag: string) => new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml)?.[1] ?? ''
  const creds = { accessKeyId: pick('AccessKeyId'), secretAccessKey: pick('SecretAccessKey'), sessionToken: pick('SessionToken'), expiration: Date.parse(pick('Expiration')) || Date.now() + 3_000_000 }
  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.sessionToken) throw new StorageError('AWS STS returned no credentials.', 502)
  return creds
}

/* ─── Credentials for a connection ──────────────────────── */

// Short-lived access tokens and role credentials, cached per connection (never stored).
const cache = new Map<string, { creds: Credentials; until: number }>()

/**
 * Where a connection's requests get their credentials. `persist` saves a rotated refresh token
 * (Microsoft issues a new one on each refresh).
 */
export function credentialSource(cacheKey: string, provider: StorageProvider, config: StorageConfig, secret: StorageSecret, persist: (secret: StorageSecret) => Promise<void>, env: Env = process.env): CredentialSource {
  const auth = config.auth ?? 'key'
  if (auth === 'key') {
    const creds: Credentials = provider === 'azure' ? { kind: 'sas', sas: secret.sas ?? '' } : { kind: 'keys', accessKeyId: secret.accessKeyId ?? '', secretAccessKey: secret.secretAccessKey ?? '' }
    return async () => creds
  }
  let current = secret
  return async () => {
    const hit = cache.get(cacheKey)
    if (hit && hit.until > Date.now() + 60_000) return hit.creds
    if (auth === 'role') {
      const r = await assumeRole(config.roleArn ?? '', config.externalId ?? '', `runf9-${cacheKey.slice(0, 40)}`, env)
      const creds: Credentials = { kind: 'keys', accessKeyId: r.accessKeyId, secretAccessKey: r.secretAccessKey, sessionToken: r.sessionToken }
      cache.set(cacheKey, { creds, until: r.expiration })
      return creds
    }
    if (provider !== 'azure' && provider !== 'gcp') throw new StorageError('This provider does not support sign-in.', 400)
    const r = await refreshOAuth(provider, current.refreshToken ?? '', env)
    if (r.refreshToken && r.refreshToken !== current.refreshToken) {
      current = { ...current, refreshToken: r.refreshToken }
      await persist(current)
    }
    const creds: Credentials = { kind: 'bearer', token: r.accessToken }
    cache.set(cacheKey, { creds, until: Date.now() + r.expiresIn * 1000 })
    return creds
  }
}

/** Seeds the cache with the access token from the sign-in itself (saves a refresh right after connecting). */
export function primeCredentials(cacheKey: string, accessToken: string, expiresIn: number) {
  cache.set(cacheKey, { creds: { kind: 'bearer', token: accessToken }, until: Date.now() + expiresIn * 1000 })
}

export function forgetCredentials(cacheKey: string) { cache.delete(cacheKey) }
