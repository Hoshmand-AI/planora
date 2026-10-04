// Tamper-evident audit log. Every material event is appended to audit_events with the actor, time,
// client, request id and detail. Records are hash-chained per organization
// (hash = SHA-256(prev_hash + canonical record)), and a database trigger rejects UPDATE, DELETE and
// TRUNCATE, so any edit or removal is both blocked and detectable by verifyAuditChain.

import { createHash, randomUUID } from 'crypto'
import { query, withTransaction, initSchema } from '@/lib/db'
import { currentRequest } from './context'
import { log, errorFields } from './log'

export const GENESIS = '0'.repeat(64)
export const SYSTEM_ORG = '__system__'

export interface AuditInput {
  action: string
  orgId?: string
  targetType?: string
  targetId?: string
  detail?: Record<string, unknown>
  actor?: { id?: string | null; email?: string | null }
}

export interface AuditEvent {
  seq: number; id: string; orgId: string; at: string; actorId: string | null; actorEmail: string | null
  action: string; targetType: string | null; targetId: string | null; detail: Record<string, unknown>
  ip: string | null; userAgent: string | null; requestId: string | null; prevHash: string; hash: string
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
}

export function eventHash(prevHash: string, e: Omit<AuditEvent, 'seq' | 'prevHash' | 'hash'>): string {
  const body = canonical({ id: e.id, orgId: e.orgId, at: e.at, actorId: e.actorId, actorEmail: e.actorEmail, action: e.action, targetType: e.targetType, targetId: e.targetId, detail: e.detail, ip: e.ip, userAgent: e.userAgent, requestId: e.requestId })
  return createHash('sha256').update(prevHash + body).digest('hex')
}

const lockKey = (orgId: string) => `audit:${orgId}`

/** Appends events (atomically, in order). Throws on failure: callers decide whether the action may proceed. */
export async function appendAudit(inputs: AuditInput[]): Promise<void> {
  if (!inputs.length) return
  const r = currentRequest()
  const byOrg = new Map<string, AuditInput[]>()
  for (const i of inputs) {
    const org = i.orgId || r?.orgId || SYSTEM_ORG
    byOrg.set(org, [...(byOrg.get(org) || []), i])
  }
  for (const [orgId, list] of byOrg) {
    const written: { id: string; action: string; at: string; targetType: string | null; targetId: string | null; detail: Record<string, unknown>; actorEmail: string | null }[] = []
    await withTransaction(async q => {
      await q('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(orgId)])
      const last = await q('SELECT hash FROM audit_events WHERE org_id=$1 ORDER BY seq DESC LIMIT 1', [orgId])
      let prev: string = last.rows[0]?.hash || GENESIS
      for (const i of list) {
        const e = {
          id: randomUUID(), orgId, at: new Date().toISOString(),
          actorId: i.actor ? i.actor.id ?? null : r?.userId ?? null,
          actorEmail: i.actor ? i.actor.email ?? null : r?.email ?? null,
          action: i.action, targetType: i.targetType ?? null, targetId: i.targetId ?? null,
          // Normalize to what JSONB stores (drops undefined) so the hash recomputes identically on read.
          detail: JSON.parse(JSON.stringify(i.detail ?? {})) as Record<string, unknown>,
          ip: r?.ip ?? null, userAgent: r?.userAgent?.slice(0, 300) ?? null, requestId: r?.requestId ?? null,
        }
        const hash = eventHash(prev, e)
        await q(`INSERT INTO audit_events (id, org_id, at, actor_id, actor_email, action, target_type, target_id, detail, ip, user_agent, request_id, prev_hash, hash)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [e.id, e.orgId, e.at, e.actorId, e.actorEmail, e.action, e.targetType, e.targetId, JSON.stringify(e.detail), e.ip, e.userAgent, e.requestId, prev, hash])
        prev = hash
        written.push(e)
      }
    })
    // Webhooks and security alerts go out after the record is committed, never blocking the request.
    if (orgId !== SYSTEM_ORG) {
      const { dispatchEvents } = await import('./webhooks')
      dispatchEvents(orgId, written)
    }
  }
}

export const audit = (input: AuditInput) => appendAudit([input])

/** For events that must never block the user (e.g. failed sign-in noise): logs instead of throwing. */
export async function auditQuietly(input: AuditInput) {
  try { await audit(input) } catch (err) { log('error', 'audit write failed', { action: input.action, ...errorFields(err) }) }
}

function rowToEvent(r: Record<string, unknown>): AuditEvent {
  return {
    seq: Number(r.seq), id: String(r.id), orgId: String(r.org_id), at: new Date(r.at as string).toISOString(),
    actorId: (r.actor_id as string) ?? null, actorEmail: (r.actor_email as string) ?? null, action: String(r.action),
    targetType: (r.target_type as string) ?? null, targetId: (r.target_id as string) ?? null, detail: (r.detail as Record<string, unknown>) || {},
    ip: (r.ip as string) ?? null, userAgent: (r.user_agent as string) ?? null, requestId: (r.request_id as string) ?? null,
    prevHash: String(r.prev_hash), hash: String(r.hash),
  }
}

export async function listAudit(orgId: string, f: { targetType?: string; targetId?: string; action?: string; actorId?: string; beforeSeq?: number; limit?: number } = {}): Promise<AuditEvent[]> {
  await initSchema()
  const where = ['org_id=$1']
  const vals: unknown[] = [orgId]
  const add = (sql: string, v: unknown) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)) }
  if (f.targetType) add('target_type=?', f.targetType)
  if (f.targetId) add('target_id=?', f.targetId)
  if (f.action) add('action LIKE ?', `${f.action}%`)
  if (f.actorId) add('actor_id=?', f.actorId)
  if (f.beforeSeq) add('seq<?', f.beforeSeq)
  vals.push(Math.min(Math.max(f.limit ?? 200, 1), 5000))
  const res = await query(`SELECT * FROM audit_events WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT $${vals.length}`, vals)
  return res.rows.map(rowToEvent)
}

/** Recomputes the whole chain for an organization. Any edited, inserted or removed record breaks it. */
export async function verifyAuditChain(orgId: string): Promise<{ ok: boolean; count: number; lastHash: string; brokenAt?: { seq: number; reason: string } }> {
  await initSchema()
  let prev = GENESIS, count = 0, after = 0
  for (;;) {
    const res = await query('SELECT * FROM audit_events WHERE org_id=$1 AND seq>$2 ORDER BY seq ASC LIMIT 2000', [orgId, after])
    if (!res.rows.length) break
    for (const row of res.rows) {
      const e = rowToEvent(row)
      if (e.prevHash !== prev) return { ok: false, count, lastHash: prev, brokenAt: { seq: e.seq, reason: 'Link to the previous record does not match (a record was removed or inserted).' } }
      if (eventHash(prev, e) !== e.hash) return { ok: false, count, lastHash: prev, brokenAt: { seq: e.seq, reason: 'Record content does not match its hash (the record was modified).' } }
      prev = e.hash; count++; after = e.seq
    }
  }
  return { ok: true, count, lastHash: prev }
}
