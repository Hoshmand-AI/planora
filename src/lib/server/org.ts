// Organization membership lifecycle: invitations, role changes, offboarding, ownership transfer.

import { randomUUID } from 'crypto'
import { initSchema, query, withTransaction } from '@/lib/db'
import { randomToken, sha256 } from './crypto'
import { isRole, type Role } from './permissions'
import { ApiError } from './api'
import { NEW_ORGANIZATION_SETTINGS } from './settings'

/**
 * Stores the defaults for a newly created organization (AI off until an admin opts in). Values the
 * organization already has are kept.
 */
export async function applyNewOrganizationDefaults(orgId: string) {
  await initSchema()
  await query('UPDATE organizations SET settings = $2::jsonb || settings WHERE id=$1', [orgId, JSON.stringify(NEW_ORGANIZATION_SETTINGS)])
}

export const INVITE_DAYS = 7

export interface Invitation {
  id: string; orgId: string; email: string; role: Role; invitedBy: string
  createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null
}

const rowToInvite = (r: Record<string, unknown>): Invitation => ({
  id: String(r.id), orgId: String(r.org_id), email: String(r.email), role: r.role as Role, invitedBy: String(r.invited_by),
  createdAt: new Date(r.created_at as string).toISOString(), expiresAt: new Date(r.expires_at as string).toISOString(),
  acceptedAt: r.accepted_at ? new Date(r.accepted_at as string).toISOString() : null, revokedAt: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : null,
})

/** Creates an invitation and returns the one-time token (only its hash is stored). */
export async function createInvitation(orgId: string, email: string, role: Role, invitedBy: string): Promise<{ invitation: Invitation; token: string }> {
  await initSchema()
  const normalized = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new ApiError(400, 'Enter a valid email address.')
  const existing = await query('SELECT org_id FROM users WHERE LOWER(email)=$1', [normalized])
  if (existing.rows[0]) {
    throw new ApiError(409, existing.rows[0].org_id === orgId ? 'That person is already a member.' : 'That email already has a Planora account in another organization. They need to use a different work email, or close that account first.')
  }
  await query('UPDATE invitations SET revoked_at=NOW() WHERE org_id=$1 AND LOWER(email)=$2 AND accepted_at IS NULL AND revoked_at IS NULL', [orgId, normalized])
  const token = randomToken(24)
  const res = await query(`INSERT INTO invitations (id, org_id, email, role, token_hash, invited_by, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6, NOW() + make_interval(days => $7)) RETURNING *`,
    [randomUUID(), orgId, normalized, role, sha256(token), invitedBy, INVITE_DAYS])
  return { invitation: rowToInvite(res.rows[0]), token }
}

export async function listInvitations(orgId: string): Promise<Invitation[]> {
  await initSchema()
  const res = await query('SELECT * FROM invitations WHERE org_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC', [orgId])
  return res.rows.map(rowToInvite)
}

export async function revokeInvitation(orgId: string, id: string): Promise<boolean> {
  await initSchema()
  const res = await query('UPDATE invitations SET revoked_at=NOW() WHERE id=$1 AND org_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL', [id, orgId])
  return (res.rowCount ?? 0) > 0
}

/** A usable (not expired, revoked or accepted) invitation for this token, with the organization name. */
export async function findInvitation(token: string): Promise<(Invitation & { orgName: string }) | null> {
  if (!token || token.length > 100) return null
  await initSchema()
  const res = await query(`SELECT i.*, o.name AS org_name FROM invitations i JOIN organizations o ON o.id=i.org_id
    WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()`, [sha256(token)])
  return res.rows[0] ? { ...rowToInvite(res.rows[0]), orgName: String(res.rows[0].org_name) } : null
}

export async function markInvitationAccepted(id: string) {
  await query('UPDATE invitations SET accepted_at=NOW() WHERE id=$1', [id])
}

async function ownerCount(orgId: string, q = query): Promise<number> {
  const res = await q(`SELECT COUNT(*)::int AS n FROM users WHERE org_id=$1 AND role='owner' AND disabled_at IS NULL`, [orgId])
  return Number(res.rows[0].n)
}

export async function changeRole(orgId: string, userId: string, role: string): Promise<{ from: string; to: Role }> {
  if (!isRole(role)) throw new ApiError(400, 'Unknown role.')
  await initSchema()
  return withTransaction(async q => {
    const cur = await q('SELECT role FROM users WHERE id=$1 AND org_id=$2 AND disabled_at IS NULL FOR UPDATE', [userId, orgId])
    if (!cur.rows[0]) throw new ApiError(404, 'Member not found.')
    const from = String(cur.rows[0].role)
    if (from === 'owner' && role !== 'owner' && await ownerCount(orgId, q) <= 1) throw new ApiError(400, 'An organization needs at least one owner. Transfer ownership first.')
    await q('UPDATE users SET role=$3 WHERE id=$1 AND org_id=$2', [userId, orgId, role])
    return { from, to: role }
  })
}

/** Offboarding: the account is disabled and signed out everywhere; the firm keeps all its project data. */
export async function removeMember(orgId: string, userId: string): Promise<{ email: string; role: string }> {
  await initSchema()
  return withTransaction(async q => {
    const cur = await q('SELECT email, role FROM users WHERE id=$1 AND org_id=$2 AND disabled_at IS NULL FOR UPDATE', [userId, orgId])
    if (!cur.rows[0]) throw new ApiError(404, 'Member not found.')
    if (cur.rows[0].role === 'owner' && await ownerCount(orgId, q) <= 1) throw new ApiError(400, "You can't remove the only owner. Transfer ownership first.")
    await q('UPDATE users SET disabled_at=NOW() WHERE id=$1', [userId])
    await q('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [userId])
    return { email: String(cur.rows[0].email), role: String(cur.rows[0].role) }
  })
}

export async function transferOwnership(orgId: string, fromUserId: string, toUserId: string) {
  await initSchema()
  return withTransaction(async q => {
    const to = await q('SELECT id FROM users WHERE id=$1 AND org_id=$2 AND disabled_at IS NULL', [toUserId, orgId])
    if (!to.rows[0]) throw new ApiError(404, 'Member not found.')
    if (toUserId === fromUserId) throw new ApiError(400, 'You already own this organization.')
    await q(`UPDATE users SET role='owner' WHERE id=$1`, [toUserId])
    await q(`UPDATE users SET role='admin' WHERE id=$1 AND org_id=$2`, [fromUserId, orgId])
  })
}
