// The project register: risks, issues, PCOs, change requests, change orders and contract amendments.
// Every query is bounded by the organization and the project (the update series of a schedule the
// caller can see; callers resolve that schedule with getScheduleById first, which applies workspace walls).

import { randomUUID } from 'crypto'
import { initSchema, query } from '@/lib/db'
import { REGISTER_KINDS, type RegisterItem, type RegisterKind } from '@/lib/analysis/daily-brief'

export const MAX_REGISTER_ITEMS = 500
/** The key a project's register is filed under: the update series, else the schedule itself. */
export const registerKey = (s: { id: string; projectKey?: string | null }) => s.projectKey || `schedule:${s.id}`

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : '')
function rowToItem(r: Record<string, unknown>): RegisterItem & { closedAt: string | null; updatedAt: string } {
  return {
    id: String(r.id), kind: r.kind as RegisterKind, title: String(r.title), detail: (r.detail as string) ?? null, status: r.status === 'closed' ? 'closed' : 'open',
    owner: (r.owner as string) ?? null, dueDate: (r.due_date as string) ?? null, impactDays: r.impact_days == null ? null : Number(r.impact_days),
    activityCodes: Array.isArray(r.activity_codes) ? (r.activity_codes as unknown[]).map(String) : [],
    sourceDocumentId: (r.source_document_id as string) ?? null, sourceQuote: (r.source_quote as string) ?? null,
    createdAt: iso(r.created_at), createdByName: (r.created_by_name as string) ?? null, updatedAt: iso(r.updated_at), closedAt: r.closed_at ? iso(r.closed_at) : null,
  }
}

export async function listRegister(orgId: string, key: string) {
  await initSchema()
  const res = await query(`SELECT * FROM project_items WHERE org_id=$1 AND project_key=$2 ORDER BY (status='open') DESC, created_at DESC LIMIT ${MAX_REGISTER_ITEMS}`, [orgId, key])
  return res.rows.map(rowToItem)
}

export interface RegisterFields {
  kind?: RegisterKind; title?: string; detail?: string | null; status?: 'open' | 'closed'; owner?: string | null; dueDate?: string | null
  impactDays?: number | null; activityCodes?: string[]; sourceDocumentId?: string | null; sourceQuote?: string | null
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Validates a create (all = true) or an update; returns the clean fields or a message for the user. */
export function parseRegisterFields(b: Record<string, unknown>, all: boolean): { fields: RegisterFields } | { error: string } {
  const f: RegisterFields = {}
  if (all || b.kind !== undefined) {
    if (!REGISTER_KINDS.includes(b.kind as RegisterKind)) return { error: `Kind must be one of: ${REGISTER_KINDS.join(', ')}.` }
    f.kind = b.kind as RegisterKind
  }
  if (all || b.title !== undefined) {
    const t = text(b.title, 200)
    if (!t || t.length < 3) return { error: 'Give the item a title (at least 3 characters).' }
    f.title = t
  }
  if (b.detail !== undefined) f.detail = text(b.detail, 4000)
  if (b.owner !== undefined) f.owner = text(b.owner, 120)
  if (b.status !== undefined) { if (b.status !== 'open' && b.status !== 'closed') return { error: 'Status must be open or closed.' }; f.status = b.status }
  if (b.dueDate !== undefined) { if (b.dueDate !== null && b.dueDate !== '' && !isDay(b.dueDate)) return { error: 'Due date must be a date (YYYY-MM-DD).' }; f.dueDate = b.dueDate ? String(b.dueDate) : null }
  if (b.impactDays !== undefined) {
    if (b.impactDays === null || b.impactDays === '') f.impactDays = null
    else { const n = Number(b.impactDays); if (!Number.isFinite(n) || n < -1000 || n > 1000) return { error: 'Schedule impact must be a number of work days between -1000 and 1000.' }; f.impactDays = Math.round(n) }
  }
  if (b.activityCodes !== undefined) {
    if (!Array.isArray(b.activityCodes)) return { error: 'Activities must be a list of activity IDs.' }
    f.activityCodes = [...new Set(b.activityCodes.map(x => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, 30)
  }
  if (b.sourceDocumentId !== undefined) f.sourceDocumentId = text(b.sourceDocumentId, 80)
  if (b.sourceQuote !== undefined) f.sourceQuote = text(b.sourceQuote, 600)
  return { fields: f }
}

export async function createRegisterItem(orgId: string, key: string, scheduleId: string, f: RegisterFields, by: { userId: string; name: string }) {
  await initSchema()
  const count = await query('SELECT COUNT(*)::int AS n FROM project_items WHERE org_id=$1 AND project_key=$2', [orgId, key])
  if (Number(count.rows[0]?.n) >= MAX_REGISTER_ITEMS) return null
  const res = await query(`INSERT INTO project_items (id, org_id, project_key, schedule_id, kind, title, detail, owner, due_date, impact_days, activity_codes, source_document_id, source_quote, created_by, created_by_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [randomUUID(), orgId, key, scheduleId, f.kind, f.title, f.detail ?? null, f.owner ?? null, f.dueDate ?? null, f.impactDays ?? null, JSON.stringify(f.activityCodes ?? []), f.sourceDocumentId ?? null, f.sourceQuote ?? null, by.userId, by.name])
  return rowToItem(res.rows[0])
}

export async function updateRegisterItem(orgId: string, key: string, id: string, f: RegisterFields) {
  await initSchema()
  const cur = await query('SELECT * FROM project_items WHERE id=$1 AND org_id=$2 AND project_key=$3', [id, orgId, key])
  if (!cur.rows[0]) return null
  const c = rowToItem(cur.rows[0])
  const n = { ...c, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) } as typeof c
  const res = await query(`UPDATE project_items SET kind=$4, title=$5, detail=$6, status=$7, owner=$8, due_date=$9, impact_days=$10, activity_codes=$11, updated_at=NOW(),
      closed_at = CASE WHEN $7='closed' THEN COALESCE(closed_at, NOW()) ELSE NULL END
    WHERE id=$1 AND org_id=$2 AND project_key=$3 RETURNING *`,
    [id, orgId, key, n.kind, n.title, n.detail ?? null, n.status, n.owner ?? null, n.dueDate ?? null, n.impactDays ?? null, JSON.stringify(n.activityCodes ?? [])])
  return { before: c, after: rowToItem(res.rows[0]) }
}

export async function deleteRegisterItem(orgId: string, key: string, id: string) {
  await initSchema()
  const res = await query('DELETE FROM project_items WHERE id=$1 AND org_id=$2 AND project_key=$3 RETURNING *', [id, orgId, key])
  return res.rows[0] ? rowToItem(res.rows[0]) : null
}
