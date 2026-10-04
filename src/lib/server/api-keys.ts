// Organization API keys for integrations (Power BI, a data warehouse, a scheduling bot...).
// A key acts with a limited role (viewer or scheduler, never admin/owner), only on routes that opt in
// with api({ apiKey: true }), and is sent as "Authorization: Bearer pk_live_…". Only a SHA-256 of the
// key is stored; the full key is shown once at creation. Keys can expire and be revoked, and every
// write made with a key is in the audit log under the key's name.

import { randomUUID } from 'crypto'
import { initSchema, query, getOrganization } from '@/lib/db'
import { normalizeSettings } from './settings'
import { randomToken, sha256 } from './crypto'
import type { AuthContext } from '@/lib/auth'

export const API_KEY_ROLES = ['viewer', 'scheduler'] as const
export type ApiKeyRole = typeof API_KEY_ROLES[number]
export const KEY_PREFIX = 'pk_live_'
export const MAX_KEYS_PER_ORG = 25

export interface ApiKey {
  id: string; name: string; prefix: string; role: ApiKeyRole; createdBy: string
  createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const rowToKey = (r: Record<string, unknown>): ApiKey => ({
  id: String(r.id), name: String(r.name), prefix: String(r.prefix), role: r.role as ApiKeyRole, createdBy: String(r.created_by),
  createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at), lastUsedAt: iso(r.last_used_at), revokedAt: iso(r.revoked_at),
})

export const looksLikeApiKey = (s: string) => /^pk_live_[A-Za-z0-9_-]{40,60}$/.test(s)

export async function createApiKey(orgId: string, input: { name: string; role: ApiKeyRole; expiresInDays: number | null; createdBy: string }): Promise<{ key: ApiKey; secret: string }> {
  await initSchema()
  const secret = KEY_PREFIX + randomToken(32)
  const id = randomUUID()
  const expires = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null
  const res = await query(`INSERT INTO api_keys (id, org_id, name, prefix, key_hash, role, created_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, orgId, input.name, secret.slice(0, KEY_PREFIX.length + 6), sha256(secret), input.role, input.createdBy, expires])
  return { key: rowToKey(res.rows[0]), secret }
}

export async function listApiKeys(orgId: string): Promise<ApiKey[]> {
  await initSchema()
  const res = await query('SELECT * FROM api_keys WHERE org_id=$1 ORDER BY revoked_at IS NOT NULL, created_at DESC', [orgId])
  return res.rows.map(rowToKey)
}

export async function countActiveApiKeys(orgId: string): Promise<number> {
  await initSchema()
  const res = await query('SELECT COUNT(*)::int AS n FROM api_keys WHERE org_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())', [orgId])
  return Number(res.rows[0].n)
}

export async function revokeApiKey(orgId: string, id: string): Promise<ApiKey | null> {
  await initSchema()
  const res = await query('UPDATE api_keys SET revoked_at=NOW() WHERE id=$1 AND org_id=$2 AND revoked_at IS NULL RETURNING *', [id, orgId])
  return res.rows[0] ? rowToKey(res.rows[0]) : null
}

/** Resolves a bearer key to an authentication context, or null if unknown, revoked or expired. */
export async function resolveApiKey(secret: string): Promise<AuthContext | null> {
  if (!looksLikeApiKey(secret)) return null
  await initSchema()
  const res = await query(`SELECT k.*, o.name AS org_name, o.settings, o.plan FROM api_keys k JOIN organizations o ON o.id = k.org_id
    WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > NOW())`, [sha256(secret)])
  const r = res.rows[0]
  if (!r) return null
  if (!r.last_used_at || Date.now() - new Date(r.last_used_at).getTime() > 60_000) await query('UPDATE api_keys SET last_used_at=NOW() WHERE id=$1', [r.id])
  return {
    userId: `apikey:${r.id}`, email: `api-key:${r.name}`, name: `API key “${r.name}”`, orgId: r.org_id, orgName: r.org_name, role: r.role,
    sessionId: `apikey:${r.id}`, settings: normalizeSettings(r.settings), plan: r.plan || 'free', sessionMethod: 'api_key',
    mfaEnabled: false, mfaSetupRequired: false,
  }
}

export { getOrganization }
