// Private beta administration (platform operators only, see signup-policy.ts).
//
// Beta invitations let a NEW firm onto Planora: single-use, for one email address, expiring after
// BETA_INVITE_DAYS, with only the SHA-256 of the token stored. Accepting one creates a new
// organization owned by the invitee. Operators can also revoke (and restore) a person's beta access;
// revoking signs them out everywhere.
//
// These tables and queries span organizations on purpose: they are the operator's view of who is in
// the beta, reachable only through /api/platform/beta, which returns 404 to everyone who isn't a
// platform operator.

import { randomUUID } from 'crypto'
import { initSchema, query, withTransaction } from '@/lib/db'
import { randomToken, sha256 } from './crypto'
import { ApiError } from './api'
import type { AuthContext } from '@/lib/auth'
import { BETA_SIGNIN_MESSAGE, isPlatformAdmin, mayUsePlanora } from './signup-policy'
import { emailConfigured } from './email'
import { auditQuietly } from './audit'

export const BETA_INVITE_DAYS = 14

export type BetaInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface BetaInvite {
  id: string; email: string; company: string | null; createdByEmail: string | null
  createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null
  acceptedOrgId: string | null; acceptedOrgName?: string | null; status: BetaInviteStatus
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

function rowToInvite(r: Record<string, unknown>): BetaInvite {
  const expiresAt = iso(r.expires_at)!
  const status: BetaInviteStatus = r.accepted_at ? 'accepted' : r.revoked_at ? 'revoked' : new Date(expiresAt) <= new Date() ? 'expired' : 'pending'
  return {
    id: String(r.id), email: String(r.email), company: (r.company as string) || null, createdByEmail: (r.created_by_email as string) || null,
    createdAt: iso(r.created_at)!, expiresAt, acceptedAt: iso(r.accepted_at), revokedAt: iso(r.revoked_at),
    acceptedOrgId: (r.accepted_org_id as string) || null, ...(r.org_name !== undefined ? { acceptedOrgName: (r.org_name as string) || null } : {}), status,
  }
}

/**
 * Platform-operator check for the beta admin endpoints and page. Everyone else gets a 404, so the
 * endpoint's existence isn't revealed. Operators must have a confirmed email (when email delivery is
 * configured, as for every action that reaches outside an account).
 */
export function requirePlatformAdmin(auth: AuthContext): void {
  if (!isPlatformAdmin(auth.email)) throw new ApiError(404, 'Not found.', 'not_found')
  if (auth.emailVerified === false && emailConfigured()) {
    throw new ApiError(403, 'Confirm your email address first: use the link we sent you, or resend it from Account → Profile.', 'email_unverified')
  }
}

/**
 * The private-beta sign-in gate for password, OpenID Connect and SAML sign-in (session checks apply
 * the same rule in auth.ts). Refusals are audited in the person's organization.
 */
export async function assertBetaAccess(user: { id: string; email: string; orgId: string; betaAccessAt: string | null; betaRevokedAt: string | null }, method: string): Promise<void> {
  if (mayUsePlanora(user)) return
  await auditQuietly({
    orgId: user.orgId, action: 'auth.login_refused_beta', targetType: 'user', targetId: user.id, actor: { id: null, email: user.email },
    detail: { method, reason: user.betaRevokedAt ? 'beta_access_revoked' : 'no_beta_access' },
  })
  throw new ApiError(403, BETA_SIGNIN_MESSAGE, 'beta_access_required')
}

/** Creates a beta invitation and returns the one-time token (only its hash is stored). */
export async function createBetaInvite(email: string, company: string | null, by: { id: string; email: string }): Promise<{ invite: BetaInvite; token: string }> {
  await initSchema()
  const normalized = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) || normalized.length > 254) throw new ApiError(400, 'Enter a valid email address.')
  const existing = await query('SELECT id FROM users WHERE LOWER(email)=$1', [normalized])
  if (existing.rows[0]) throw new ApiError(409, 'That email already has a Planora account. To let them back in, restore their beta access below.')
  const name = company?.trim().slice(0, 160) || null
  // One live invitation per address: a new one replaces any pending one.
  await query('UPDATE beta_invites SET revoked_at=NOW() WHERE LOWER(email)=$1 AND accepted_at IS NULL AND revoked_at IS NULL', [normalized])
  const token = randomToken(24)
  const res = await query(`INSERT INTO beta_invites (id, email, company, token_hash, created_by, created_by_email, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6, NOW() + make_interval(days => $7)) RETURNING *`,
    [randomUUID(), normalized, name, sha256(token), by.id, by.email, BETA_INVITE_DAYS])
  return { invite: rowToInvite(res.rows[0]), token }
}

export async function listBetaInvites(): Promise<BetaInvite[]> {
  await initSchema()
  const res = await query(`SELECT b.*, o.name AS org_name FROM beta_invites b LEFT JOIN organizations o ON o.id = b.accepted_org_id
    ORDER BY b.created_at DESC LIMIT 300`)
  return res.rows.map(rowToInvite)
}

/** Revokes a pending invitation. Returns its email, or null if there was nothing to revoke. */
export async function revokeBetaInvite(id: string): Promise<string | null> {
  await initSchema()
  const res = await query('UPDATE beta_invites SET revoked_at=NOW() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email', [id])
  return res.rows[0] ? String(res.rows[0].email) : null
}

/** A usable (not expired, revoked or accepted) beta invitation for this token. */
export async function findBetaInvite(token: string): Promise<BetaInvite | null> {
  if (!token || token.length > 100) return null
  await initSchema()
  const res = await query('SELECT * FROM beta_invites WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()', [sha256(token)])
  return res.rows[0] ? rowToInvite(res.rows[0]) : null
}

/** Marks the invitation used by the account it created (single use: only a still-usable invitation is updated). */
export async function markBetaInviteAccepted(id: string, userId: string, orgId: string): Promise<boolean> {
  const res = await query('UPDATE beta_invites SET accepted_at=NOW(), accepted_user_id=$2, accepted_org_id=$3 WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL', [id, userId, orgId])
  return (res.rowCount ?? 0) > 0
}

export interface BetaUser {
  id: string; email: string; name: string; role: string; orgId: string; orgName: string; createdAt: string
  betaAccessAt: string | null; betaRevokedAt: string | null; betaAccessVia: string | null; disabled: boolean
  platformAdmin: boolean; hasAccess: boolean
}

/** Every account on the instance with its beta status (newest first). */
export async function listBetaUsers(limit = 500): Promise<BetaUser[]> {
  await initSchema()
  const res = await query(`SELECT u.id, u.email, u.name, u.role, u.org_id, u.created_at, u.beta_access_at, u.beta_revoked_at, u.beta_access_via, u.disabled_at, o.name AS org_name
    FROM users u JOIN organizations o ON o.id = u.org_id ORDER BY u.created_at DESC LIMIT $1`, [limit])
  return res.rows.map(r => {
    const betaAccessAt = iso(r.beta_access_at), betaRevokedAt = iso(r.beta_revoked_at)
    return {
      id: String(r.id), email: String(r.email), name: String(r.name), role: String(r.role), orgId: String(r.org_id), orgName: String(r.org_name),
      createdAt: iso(r.created_at)!, betaAccessAt, betaRevokedAt, betaAccessVia: (r.beta_access_via as string) || null, disabled: !!r.disabled_at,
      platformAdmin: isPlatformAdmin(String(r.email)), hasAccess: !!betaAccessAt && !betaRevokedAt,
    }
  })
}

/** Revokes a person's beta access and signs them out everywhere. */
export async function revokeBetaAccess(userId: string): Promise<{ email: string; orgId: string; sessionsRevoked: number }> {
  await initSchema()
  return withTransaction(async q => {
    const cur = await q('SELECT email, org_id, beta_revoked_at FROM users WHERE id=$1 FOR UPDATE', [userId])
    const row = cur.rows[0]
    if (!row) throw new ApiError(404, 'Person not found.')
    if (isPlatformAdmin(String(row.email))) throw new ApiError(400, 'Platform operators always have access. Remove them from PLANORA_PLATFORM_ADMINS first.')
    if (row.beta_revoked_at) throw new ApiError(409, 'Their beta access is already revoked.')
    await q('UPDATE users SET beta_revoked_at=NOW() WHERE id=$1', [userId])
    const s = await q('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [userId])
    return { email: String(row.email), orgId: String(row.org_id), sessionsRevoked: s.rowCount ?? 0 }
  })
}

/** Gives a person beta access again (or for the first time). */
export async function restoreBetaAccess(userId: string): Promise<{ email: string; orgId: string }> {
  await initSchema()
  const res = await query(`UPDATE users SET beta_revoked_at=NULL, beta_access_at=COALESCE(beta_access_at, NOW()), beta_access_via=COALESCE(beta_access_via, 'restored')
    WHERE id=$1 AND (beta_revoked_at IS NOT NULL OR beta_access_at IS NULL) RETURNING email, org_id`, [userId])
  if (!res.rows[0]) throw new ApiError(409, 'They already have beta access, or the person was not found.')
  return { email: String(res.rows[0].email), orgId: String(res.rows[0].org_id) }
}
