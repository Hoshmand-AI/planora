// Project inbox: the connection between a project and the email and meetings about it.
//
// A member creates an inbox for a project and gets an address (POST /api/inbound) and a token. A mail
// rule or automation (Microsoft Power Automate, Zapier, n8n, a mail server hook) or a meeting recorder
// posts each email, transcript or daily report there; it becomes a project document, and the Daily
// Brief reads it the same morning.
//
// Tokens: shown once; only a SHA-256 is stored. A token acts on one project of one organization, as
// the member who created it: their workspace access still decides what the inbox can reach, and the
// inbox stops working when their account is disabled. It can add documents only; it reads nothing.
// CUI and classified projects have no inbox.

import { randomUUID } from 'crypto'
import { initSchema, query } from '@/lib/db'
import { randomToken, sha256 } from './crypto'

export const INBOX_TOKEN_PREFIX = 'inbox_'
export const MAX_INBOXES_PER_PROJECT = 5
/** Largest message an inbox accepts (the text of an email or a transcript; attachments are not read). */
export const MAX_INBOUND_BYTES = 2 * 1024 * 1024
export const INBOX_LIMITS = { perInbox: { limit: 120, windowSec: 60 * 60 }, perOrg: { limit: 600, windowSec: 60 * 60 }, badTokenPerIp: { limit: 30, windowSec: 15 * 60 } }

export interface ProjectInbox { id: string; name: string; prefix: string; createdBy: string; createdAt: string; lastUsedAt: string | null; received: number; revokedAt: string | null }

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const rowToInbox = (r: Record<string, unknown>): ProjectInbox => ({
  id: String(r.id), name: String(r.name), prefix: String(r.prefix), createdBy: String(r.created_by),
  createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at), received: Number(r.received_count || 0), revokedAt: iso(r.revoked_at),
})

export const looksLikeInboxToken = (s: string) => /^inbox_[A-Za-z0-9_-]{40,60}$/.test(s)

export async function listInboxes(orgId: string, projectKey: string): Promise<ProjectInbox[]> {
  await initSchema()
  const res = await query('SELECT * FROM project_inboxes WHERE org_id=$1 AND project_key=$2 ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 50', [orgId, projectKey])
  return res.rows.map(rowToInbox)
}

export async function createInbox(orgId: string, i: { projectKey: string; scheduleId: string; name: string; createdBy: string }): Promise<{ inbox: ProjectInbox; secret: string } | { error: string }> {
  await initSchema()
  const n = await query('SELECT COUNT(*)::int AS n FROM project_inboxes WHERE org_id=$1 AND project_key=$2 AND revoked_at IS NULL', [orgId, i.projectKey])
  if (Number(n.rows[0]?.n || 0) >= MAX_INBOXES_PER_PROJECT) return { error: `A project can have ${MAX_INBOXES_PER_PROJECT} inboxes. Turn one off first.` }
  const secret = INBOX_TOKEN_PREFIX + randomToken(32)
  const res = await query('INSERT INTO project_inboxes (id, org_id, project_key, schedule_id, name, prefix, token_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [randomUUID(), orgId, i.projectKey, i.scheduleId, i.name, secret.slice(0, INBOX_TOKEN_PREFIX.length + 6), sha256(secret), i.createdBy])
  return { inbox: rowToInbox(res.rows[0]), secret }
}

export async function revokeInbox(orgId: string, projectKey: string, id: string): Promise<ProjectInbox | null> {
  await initSchema()
  const res = await query('UPDATE project_inboxes SET revoked_at=NOW() WHERE id=$1 AND org_id=$2 AND project_key=$3 AND revoked_at IS NULL RETURNING *', [id, orgId, projectKey])
  return res.rows[0] ? rowToInbox(res.rows[0]) : null
}

export interface ResolvedInbox { id: string; orgId: string; projectKey: string; scheduleId: string; name: string; createdBy: string }

/** The inbox a token belongs to; null for an unknown, malformed or turned-off token. */
export async function resolveInboxToken(secret: string): Promise<ResolvedInbox | null> {
  if (!looksLikeInboxToken(secret)) return null
  await initSchema()
  const res = await query('SELECT id, org_id, project_key, schedule_id, name, created_by FROM project_inboxes WHERE token_hash=$1 AND revoked_at IS NULL', [sha256(secret)])
  const r = res.rows[0]
  return r ? { id: String(r.id), orgId: String(r.org_id), projectKey: String(r.project_key), scheduleId: String(r.schedule_id), name: String(r.name), createdBy: String(r.created_by) } : null
}

export async function markInboxUsed(orgId: string, id: string): Promise<void> {
  await query('UPDATE project_inboxes SET last_used_at=NOW(), received_count=received_count+1 WHERE id=$1 AND org_id=$2', [id, orgId])
}
