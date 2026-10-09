// Every API route is wrapped by api(): one place that assigns a request id, rejects cross-site
// writes, authenticates, enforces the organization's MFA policy and the route's RBAC permission,
// applies per-user (or per-API-key) rate limits, logs a structured access line and turns unexpected errors into a
// safe response that carries the request id (no stack traces leave the server).

import { randomUUID } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext, type AuthContext } from '@/lib/auth'
import { runWithRequest, clientIp, currentRequest, type RequestInfo } from './context'
import { can, type Permission } from './permissions'
import { hit, LIMITS } from './rate-limit'
import { log, errorFields } from './log'
import { maybeRunMaintenance } from './maintenance'
import { StalePlanError } from '@/lib/db'
import { entitlementsFor } from './entitlements'
import { resolveApiKey } from './api-keys'
import { classificationResolver } from './classification'

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) { super(message) }
}

/** Thrown when a write is based on a stale copy (optimistic locking). */
export class ConflictError extends ApiError {
  constructor(message = 'This was changed by someone else since you opened it. Reload to see the latest version, then try again.') {
    super(409, message, 'conflict')
  }
}

type RouteContext = { params?: Record<string, string> | Promise<Record<string, string>> }
type Ctx<P> = { params: P; auth: AuthContext }
type PublicCtx<P> = { params: P; auth: AuthContext | null }

interface Options {
  /** Permission the caller's role must have. */
  permission: Permission
  /** Allow members who still need to enroll in MFA (only the enrollment endpoints). */
  allowMfaSetup?: boolean
  /** Also accept an organization API key (Authorization: Bearer pk_live_…). Off unless a route opts in. */
  apiKey?: boolean
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Cross-site request forgery defence (in addition to SameSite=Lax cookies): browsers send Origin
 * and Sec-Fetch-Site on writes; a write from another site is rejected. Non-browser clients send
 * neither and must still present a valid session cookie.
 */
export function crossSiteWrite(req: Request): boolean {
  if (!WRITE.has(req.method)) return false
  const site = req.headers.get('sec-fetch-site')
  if (site === 'cross-site') return true
  const origin = req.headers.get('origin')
  if (!origin || origin === 'null') return origin === 'null'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  try { return new URL(origin).host !== host } catch { return true }
}

function requestInfo(req: NextRequest): RequestInfo {
  let path = '/'
  try { path = new URL(req.url).pathname } catch { /* keep default */ }
  return {
    requestId: req.headers.get('x-request-id')?.slice(0, 64) || randomUUID(),
    method: req.method, path, ip: clientIp(req.headers), userAgent: req.headers.get('user-agent'),
  }
}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === 'number' ? { status: init } : init)
}

function errorResponse(err: unknown): Response {
  const r = currentRequest()
  if (err instanceof StalePlanError) err = new ConflictError()
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, code: err.code, ...(err.extra || {}), requestId: r?.requestId }, {
      status: err.status, headers: err.status === 429 && err.extra?.retryAfterSec ? { 'Retry-After': String(err.extra.retryAfterSec) } : undefined,
    })
  }
  log('error', 'unhandled error', errorFields(err))
  return NextResponse.json({ error: 'Something went wrong on our side. Try again; if it keeps happening, contact support with this reference.', requestId: r?.requestId }, { status: 500 })
}

async function finish(info: RequestInfo, started: number, run: () => Promise<Response>): Promise<Response> {
  let res: Response
  try { res = await run() } catch (err) { res = errorResponse(err) }
  res.headers.set('x-request-id', info.requestId)
  res.headers.set('Cache-Control', res.headers.get('Cache-Control') || 'no-store')
  const ms = Date.now() - started
  log(res.status >= 500 ? 'error' : res.status >= 400 ? 'warn' : 'info', 'request', { status: res.status, ms })
  return res
}

/** Authenticated route with a required permission. */
export function api<P = Record<string, string>>(opts: Options, handler: (req: NextRequest, ctx: Ctx<P>) => Promise<Response>) {
  return async (req: NextRequest, routeCtx: RouteContext = {}): Promise<Response> => {
    const info = requestInfo(req)
    const started = Date.now()
    return runWithRequest(info, () => finish(info, started, async () => {
      if (crossSiteWrite(req)) throw new ApiError(403, 'Cross-site request blocked.', 'csrf')
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '')?.[1]
      let auth: AuthContext | null
      if (bearer) {
        if (!opts.apiKey) throw new ApiError(403, 'API keys can\'t be used on this endpoint. See docs/API.md for the endpoints that accept them.', 'api_key_not_allowed')
        auth = await resolveApiKey(bearer)
        if (!auth) throw new ApiError(401, 'Invalid, expired or revoked API key.', 'invalid_api_key')
      } else {
        auth = await getAuthContext()
      }
      if (!auth) throw new ApiError(401, 'Unauthorized', 'unauthenticated')
      Object.assign(info, { userId: auth.userId, email: auth.email, name: auth.name, orgId: auth.orgId, role: auth.role, aiEnabled: auth.settings.aiEnabled, aiDailyLimit: Math.min(auth.settings.aiDailyLimit, entitlementsFor(auth.plan).aiPerDay), plan: auth.plan })
      // CUI / classified projects: the model provider checks this before calling a cloud model.
      info.dataClassification = classificationResolver(req, info.path, auth.orgId)
      // Ethical walls: which workspaces' schedules and plans this caller may see. Resolved lazily,
      // once, and applied by every schedule/plan read in src/lib/db.ts.
      info.workspaceAccess = workspaceAccessFor(auth)
      if (auth.mfaSetupRequired && !opts.allowMfaSetup) {
        throw new ApiError(403, 'Your organization requires two-step verification. Set it up under Account → Security to continue.', 'mfa_setup_required')
      }
      if (!can(auth.role, opts.permission)) {
        throw new ApiError(403, `Your role (${auth.role}) can't do this. Ask an admin of your organization for access.`, 'forbidden')
      }
      const rl = await hit(`api:user:${auth.userId}`, LIMITS.apiPerUser.limit, LIMITS.apiPerUser.windowSec)
      if (!rl.ok) throw new ApiError(429, 'Too many requests. Slow down and try again shortly.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
      await maybeRunMaintenance()
      const params = (await routeCtx.params) as P
      return handler(req, { params, auth })
    }))
  }
}

/** Memoized workspace access for one request (workspaces.ts is loaded lazily: it imports ApiError from here). */
function workspaceAccessFor(auth: AuthContext): NonNullable<RequestInfo['workspaceAccess']> {
  let p: ReturnType<NonNullable<RequestInfo['workspaceAccess']>> | null = null
  return () => (p ??= import('./workspaces').then(m => m.resolveWorkspaceAccess(auth)).catch(err => { p = null; throw err }))
}

/** Route that works signed in or out (sign-in, health). Still gets request ids, CSRF checks, logging. */
export function publicApi<P = Record<string, string>>(handler: (req: NextRequest, ctx: PublicCtx<P>) => Promise<Response>, opts: { csrf?: boolean; optionalAuth?: boolean } = {}) {
  return async (req: NextRequest, routeCtx: RouteContext = {}): Promise<Response> => {
    const info = requestInfo(req)
    const started = Date.now()
    return runWithRequest(info, () => finish(info, started, async () => {
      if (opts.csrf !== false && crossSiteWrite(req)) throw new ApiError(403, 'Cross-site request blocked.', 'csrf')
      const auth = opts.optionalAuth === false ? null : await getAuthContext().catch(() => null)
      if (auth) Object.assign(info, { userId: auth.userId, email: auth.email, name: auth.name, orgId: auth.orgId, role: auth.role })
      const params = (await routeCtx.params) as P
      return handler(req, { params, auth })
    }))
  }
}

/* ─── SCIM 2.0 provisioning endpoints ───────────────── */

/** SCIM error (RFC 7644 §3.12): status plus an optional scimType such as invalidFilter, uniqueness, mutability. */
export class ScimError extends ApiError {
  constructor(status: number, detail: string, public scimType?: string) { super(status, detail, scimType) }
}

export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
export const SCIM_CONTENT_TYPE = 'application/scim+json'

export function scimJson(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new NextResponse(JSON.stringify(data), { status, headers: { 'Content-Type': SCIM_CONTENT_TYPE, ...headers } })
}

function scimErrorResponse(err: unknown): Response {
  const r = currentRequest()
  if (err instanceof ApiError) {
    const scimType = err instanceof ScimError ? err.scimType : undefined
    return scimJson({ schemas: [SCIM_ERROR_SCHEMA], status: String(err.status), ...(scimType ? { scimType } : {}), detail: err.message }, err.status,
      err.status === 401 ? { 'WWW-Authenticate': 'Bearer realm="planora-scim"' } : err.status === 429 && err.extra?.retryAfterSec ? { 'Retry-After': String(err.extra.retryAfterSec) } : {})
  }
  log('error', 'unhandled scim error', errorFields(err))
  return scimJson({ schemas: [SCIM_ERROR_SCHEMA], status: '500', detail: `Internal error (reference ${r?.requestId}).` }, 500)
}

export interface ScimContext { orgId: string; tokenId: string; tokenName: string; plan: string }
type ScimCtx<P> = { params: P; scim: ScimContext }

/**
 * SCIM 2.0 route (src/app/api/scim/v2/…): authenticated only by an organization SCIM token
 * (Authorization: Bearer scim_…), never by a session cookie or API key, and every handler operates
 * on that token's organization only. Enterprise plan (same entitlement as SSO). Errors use the SCIM
 * error schema. Request ids, logging and rate limits as for api().
 */
export function scimApi<P = Record<string, string>>(handler: (req: NextRequest, ctx: ScimCtx<P>) => Promise<Response>) {
  return async (req: NextRequest, routeCtx: RouteContext = {}): Promise<Response> => {
    const info = requestInfo(req)
    const started = Date.now()
    return runWithRequest(info, () => finish(info, started, async () => {
      try {
        const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '')?.[1]
        if (!bearer) throw new ScimError(401, 'A SCIM bearer token is required (Organization → SCIM provisioning).')
        const { resolveScimToken } = await import('./scim')
        const scim = await resolveScimToken(bearer)
        if (!scim) throw new ScimError(401, 'Invalid or revoked SCIM token.')
        Object.assign(info, { orgId: scim.orgId, userId: `scim:${scim.tokenId}`, email: `scim-token:${scim.tokenName}`, name: `SCIM token “${scim.tokenName}”`, plan: scim.plan })
        if (!entitlementsFor(scim.plan).sso) throw new ScimError(403, 'SCIM provisioning is part of the Enterprise plan.')
        const rl = await hit(`scim:token:${scim.tokenId}`, LIMITS.apiPerUser.limit, LIMITS.apiPerUser.windowSec)
        if (!rl.ok) throw new ScimError(429, 'Too many requests. Slow down and try again shortly.')
        await maybeRunMaintenance()
        const params = (await routeCtx.params) as P
        return await handler(req, { params, scim })
      } catch (err) {
        return scimErrorResponse(err)
      }
    }))
  }
}

/** Reads a SCIM JSON body; malformed JSON is a SCIM 400 invalidSyntax. */
export async function scimBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text()
  if (text.length > 256 * 1024) throw new ScimError(413, 'Request body too large.')
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
    return v as T
  } catch { throw new ScimError(400, 'Request body must be a JSON object.', 'invalidSyntax') }
}

/** Reads a JSON body; a malformed body is a 400, not a 500. */
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T } catch { throw new ApiError(400, 'Request body must be valid JSON.', 'bad_json') }
}
