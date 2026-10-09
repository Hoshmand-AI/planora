// Authentication and sessions.
//
// A session is a row in `sessions` (server-side, revocable). The cookie carries a signed JWT that
// only names the session; every request re-checks the row, so signing out, "sign out everywhere",
// removing a member or changing a password take effect immediately. Sessions end after the
// organization's idle timeout (default 12 h) or 7 days, whichever comes first.

import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { initSchema, query } from '@/lib/db'
import { normalizeSettings, type OrgSettings } from '@/lib/server/settings'
import { currentRequest } from '@/lib/server/context'

export const SESSION_COOKIE = 'planora-token'
export const SESSION_MAX_DAYS = 7
const TOUCH_EVERY_MS = 5 * 60_000

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production')
  return 'planora-dev-secret-change-in-production-2026'
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

let dummyHash: Promise<string> | null = null
/** Spends the same time as a real password check, so unknown emails can't be found by timing. */
export async function dummyPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash('planora-timing-equalizer', 12)
  await bcrypt.compare(password, await dummyHash)
}

/* ─── Sessions ─────────────────────────────────────── */

export async function createSession(userId: string, method = 'password'): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  await initSchema()
  const r = currentRequest()
  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_MAX_DAYS * 86_400_000)
  await query('INSERT INTO sessions (id, user_id, expires_at, ip, user_agent, method) VALUES ($1,$2,$3,$4,$5,$6)',
    [sessionId, userId, expiresAt.toISOString(), r?.ip ?? null, r?.userAgent?.slice(0, 300) ?? null, method])
  const token = jwt.sign({ sid: sessionId, uid: userId, typ: 'session' }, jwtSecret(), { expiresIn: `${SESSION_MAX_DAYS}d` })
  return { token, sessionId, expiresAt }
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: expiresAt,
  })
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
}

/** Revokes one session (only the given user's, when userId is passed). Returns whether a session was revoked. */
export async function revokeSession(sessionId: string, userId?: string): Promise<boolean> {
  await initSchema()
  const res = await query(`UPDATE sessions SET revoked_at=NOW() WHERE id=$1 ${userId ? 'AND user_id=$2' : ''} AND revoked_at IS NULL`, userId ? [sessionId, userId] : [sessionId])
  return (res.rowCount ?? 0) > 0
}

/** Revokes every session of a user, optionally keeping one (the current device). Returns how many. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  await initSchema()
  const res = await query('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL AND ($2::text IS NULL OR id<>$2)', [userId, exceptSessionId ?? null])
  return res.rowCount ?? 0
}

export async function listSessions(userId: string) {
  await initSchema()
  const res = await query(`SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM sessions
    WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY last_seen_at DESC LIMIT 50`, [userId])
  return res.rows.map(r => ({ id: r.id as string, createdAt: new Date(r.created_at).toISOString(), lastSeenAt: new Date(r.last_seen_at).toISOString(), ip: r.ip as string | null, userAgent: r.user_agent as string | null }))
}

/* ─── Two-step verification challenge (between password and code) ── */

export function createMfaChallenge(userId: string): string {
  return jwt.sign({ uid: userId, typ: 'mfa' }, jwtSecret(), { expiresIn: '5m' })
}

export function verifyMfaChallenge(token: string): string | null {
  try {
    const p = jwt.verify(token, jwtSecret()) as { uid?: string; typ?: string }
    return p.typ === 'mfa' && p.uid ? p.uid : null
  } catch { return null }
}

/* ─── Request authentication ───────────────────────── */

export interface AuthContext {
  userId: string
  email: string
  name: string
  orgId: string
  orgName: string
  role: string
  sessionId: string
  settings: OrgSettings
  /** Subscription plan of the organization (see entitlements.ts) */
  plan: string
  /** How this session was established: password, password+totp, password+recovery_code, sso (OIDC), saml */
  sessionMethod: string
  mfaEnabled: boolean
  /** The organization requires two-step verification and this member hasn't enrolled yet. */
  mfaSetupRequired: boolean
  /** The member confirmed their email address (undefined for API keys) */
  emailVerified?: boolean
}

/** Sessions established through the organization's identity provider: OpenID Connect ('sso') or SAML ('saml'). */
export const isFederatedMethod = (method: string) => method === 'sso' || method === 'saml'

function sessionIdFromToken(token: string): string | null {
  try {
    const p = jwt.verify(token, jwtSecret()) as { sid?: string; typ?: string }
    return p.typ === 'session' && p.sid ? p.sid : null
  } catch { return null }
}

/** Resolves the session cookie to the user, their organization and policy. Null if not signed in. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const r = currentRequest() as (ReturnType<typeof currentRequest> & { auth?: AuthContext | null }) | undefined
  if (r && r.auth !== undefined) return r.auth
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const ctx = token ? await resolveSession(token) : null
  if (r) r.auth = ctx
  return ctx
}

export async function resolveSession(token: string): Promise<AuthContext | null> {
  const sid = sessionIdFromToken(token)
  if (!sid) return null
  await initSchema()
  const res = await query(`SELECT s.id AS sid, s.last_seen_at, s.method, u.id, u.email, u.name, u.role, u.org_id, u.mfa_enabled_at, u.disabled_at, u.email_verified_at, o.name AS org_name, o.settings, o.plan
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.org_id
    WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`, [sid])
  const row = res.rows[0]
  if (!row || row.disabled_at) return null
  const settings = normalizeSettings(row.settings)
  const lastSeen = new Date(row.last_seen_at).getTime()
  if (Date.now() - lastSeen > settings.sessionIdleHours * 3_600_000) {
    await revokeSession(sid)
    return null
  }
  if (Date.now() - lastSeen > TOUCH_EVERY_MS) await query('UPDATE sessions SET last_seen_at=NOW() WHERE id=$1', [sid])
  const mfaEnabled = !!row.mfa_enabled_at
  const sessionMethod = row.method || 'password'
  const federated = isFederatedMethod(sessionMethod)
  return {
    userId: row.id, email: row.email, name: row.name, orgId: row.org_id, orgName: row.org_name, role: row.role, sessionId: sid,
    settings, plan: row.plan || 'free', sessionMethod, mfaEnabled, emailVerified: !!row.email_verified_at || federated,
    // Single sign-on sessions (OIDC or SAML) rely on the identity provider's own MFA policy.
    mfaSetupRequired: settings.requireMfa && !mfaEnabled && !federated,
  }
}
