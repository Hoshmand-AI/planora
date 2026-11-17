// Site plans in the database: a drawing per level, its rooms and its matched points. Every statement is scoped
// by org_id and by the project (its update series inside its workspace), like the project's captures.

import { createHash, randomUUID } from 'crypto'
import { initSchema, query, withTransaction } from '@/lib/db'
import { imageSize, sniffMedia } from '@/lib/site/capture'
import { MAX_PLANS_PER_PROJECT, MAX_PLAN_BYTES, MAX_PLAN_PIXELS_SIDE, type PlanControl, type PlanRoom, type SitePlan } from '@/lib/site/plan'

export class PlanRejected extends Error {
  constructor(message: string, public code: 'unsupported_media' | 'too_large' | 'plans_full') { super(message) }
}

/** Checks a drawing's bytes: an image (JPEG, PNG or WebP) of a readable size. The type comes from the bytes. */
export function checkPlanImage(bytes: Buffer): { contentType: string; width: number; height: number; sha256: string } {
  const sniffed = sniffMedia(bytes)
  if (!sniffed || sniffed.kind !== 'photo') throw new PlanRejected('A drawing is sent as a picture (JPEG, PNG or WebP). Export the sheet as an image, or take a screenshot of it.', 'unsupported_media')
  if (bytes.length > MAX_PLAN_BYTES) throw new PlanRejected('This drawing is too large. Export it at a lower resolution.', 'too_large')
  const size = imageSize(bytes, sniffed.contentType)
  if (!size || size.width < 50 || size.height < 50 || size.width > MAX_PLAN_PIXELS_SIDE || size.height > MAX_PLAN_PIXELS_SIDE) throw new PlanRejected(`A drawing can be up to ${MAX_PLAN_PIXELS_SIDE.toLocaleString('en-US')} pixels on its long side. Export it at a lower resolution.`, 'too_large')
  return { contentType: sniffed.contentType, width: size.width, height: size.height, sha256: createHash('sha256').update(bytes).digest('hex') }
}

const PLAN_COLS = 'id, level, width, height, controls, rooms, sort, updated_at'
const rowToPlan = (r: Record<string, unknown>): SitePlan => ({
  id: String(r.id), level: String(r.level), width: Number(r.width), height: Number(r.height),
  controls: Array.isArray(r.controls) ? (r.controls as PlanControl[]) : [], rooms: Array.isArray(r.rooms) ? (r.rooms as PlanRoom[]) : [],
  sort: Number(r.sort ?? 0), updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : '',
})

/** The project's drawings, in their set order (never the picture bytes). */
export async function listPlans(orgId: string, key: string): Promise<SitePlan[]> {
  await initSchema()
  const res = await query(`SELECT ${PLAN_COLS} FROM site_plans WHERE org_id=$1 AND project_key=$2 ORDER BY sort, created_at, id`, [orgId, key])
  return res.rows.map(rowToPlan)
}

export async function getPlan(orgId: string, key: string, id: string): Promise<SitePlan | null> {
  await initSchema()
  const res = await query(`SELECT ${PLAN_COLS} FROM site_plans WHERE org_id=$1 AND project_key=$2 AND id=$3`, [orgId, key, id])
  return res.rows[0] ? rowToPlan(res.rows[0]) : null
}

/** Stores a drawing for a level. Throws PlanRejected when the project already holds the most it can. */
export async function createPlan(orgId: string, key: string, level: string, bytes: Buffer, by: { userId: string; name: string }, classification: string | null): Promise<SitePlan> {
  const img = checkPlanImage(bytes)
  const id = randomUUID()
  await withTransaction(async q => {
    const count = await q('SELECT COUNT(*)::int AS n, COALESCE(MAX(sort), -1)::int AS last FROM site_plans WHERE org_id=$1 AND project_key=$2', [orgId, key])
    if (Number(count.rows[0]?.n) >= MAX_PLANS_PER_PROJECT) throw new PlanRejected(`A project holds up to ${MAX_PLANS_PER_PROJECT} drawings. Delete one first.`, 'plans_full')
    await q(`INSERT INTO site_plans (id, org_id, project_key, level, content_type, size_bytes, sha256, width, height, content, sort, classification, created_by, created_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, orgId, key, level, img.contentType, bytes.length, img.sha256, img.width, img.height, bytes, Number(count.rows[0]?.last) + 1, classification, by.userId, by.name])
  })
  return (await getPlan(orgId, key, id))!
}

/** Changes a drawing's level name, rooms, matched points or place in the order. Null when it is not in this project. */
export async function updatePlan(orgId: string, key: string, id: string, patch: { level?: string; rooms?: PlanRoom[]; controls?: PlanControl[]; sort?: number }): Promise<SitePlan | null> {
  await initSchema()
  const res = await query(
    `UPDATE site_plans SET level=COALESCE($4, level), rooms=COALESCE($5::jsonb, rooms), controls=COALESCE($6::jsonb, controls), sort=COALESCE($7, sort), updated_at=NOW()
     WHERE org_id=$1 AND project_key=$2 AND id=$3 RETURNING ${PLAN_COLS}`,
    [orgId, key, id, patch.level ?? null, patch.rooms ? JSON.stringify(patch.rooms) : null, patch.controls ? JSON.stringify(patch.controls) : null, patch.sort ?? null])
  return res.rows[0] ? rowToPlan(res.rows[0]) : null
}

/** Deletes a drawing. Captures pinned on it keep their level and room and lose the pin. */
export async function deletePlan(orgId: string, key: string, id: string): Promise<boolean> {
  return withTransaction(async q => {
    const del = await q('DELETE FROM site_plans WHERE org_id=$1 AND project_key=$2 AND id=$3', [orgId, key, id])
    if (!del.rowCount) return false
    await q('UPDATE site_captures SET plan_id=NULL, plan_x=NULL, plan_y=NULL WHERE org_id=$1 AND project_key=$2 AND plan_id=$3', [orgId, key, id])
    return true
  })
}

/** A drawing's picture, with its bytes. */
export async function getPlanImage(orgId: string, key: string, id: string): Promise<{ contentType: string; bytes: Buffer; sha256: string } | null> {
  await initSchema()
  const res = await query('SELECT content_type, content, sha256 FROM site_plans WHERE org_id=$1 AND project_key=$2 AND id=$3', [orgId, key, id])
  const r = res.rows[0]
  return r ? { contentType: String(r.content_type), bytes: r.content as Buffer, sha256: String(r.sha256) } : null
}

/** Everything about the organization's drawings except the picture bytes (their size and SHA-256 are listed). */
export async function exportPlans(orgId: string) {
  await initSchema()
  return (await query('SELECT id, project_key, level, content_type, size_bytes, sha256, width, height, controls, rooms, sort, classification, created_by, created_by_name, created_at, updated_at FROM site_plans WHERE org_id=$1 ORDER BY created_at', [orgId])).rows
}
