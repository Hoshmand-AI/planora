// Storage for Time Impact Analysis (migration 16): delay events with their fragnet, and immutable
// TIA runs. Every query is scoped by org_id; runs are insert-only (a trigger rejects UPDATE).

import { query, initSchema } from '@/lib/db'
import type { DelayEvent, DelayEventStatus, EvidenceRef, Fragnet, Responsibility, TiaResult, TiaRun, TiaSide } from '@/lib/analysis/tia'

const ts = (v: unknown) => new Date(String(v)).toISOString()

function rowToEvent(r: Record<string, unknown>): DelayEvent {
  return {
    id: String(r.id), scheduleId: String(r.schedule_id), title: String(r.title), description: (r.description as string) ?? null,
    responsibility: r.responsibility as Responsibility, eventStart: (r.event_start as string) ?? null, eventEnd: (r.event_end as string) ?? null,
    notifiedOn: (r.notified_on as string) ?? null, evidence: (r.evidence as EvidenceRef[]) ?? [], fragnet: (r.fragnet as Fragnet) ?? { activities: [], relationships: [] },
    status: r.status as DelayEventStatus, statusNote: (r.status_note as string) ?? null, createdBy: (r.created_by as string) ?? null,
    createdByName: (r.created_by_name as string) ?? null, updatedBy: (r.updated_by as string) ?? null, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  }
}

function rowToRun(r: Record<string, unknown>): TiaRun {
  return {
    id: String(r.id), delayEventId: String(r.delay_event_id), scheduleId: String(r.schedule_id), inputsHash: String(r.inputs_hash), resultHash: String(r.result_hash),
    engine: String(r.engine), inputs: (r.inputs as Record<string, unknown>) ?? {}, before: (r.before_result as TiaSide) ?? null, after: (r.after_result as TiaSide) ?? null,
    result: r.result as TiaResult, createdBy: (r.created_by as string) ?? null, createdByName: (r.created_by_name as string) ?? null, createdAt: ts(r.created_at),
  }
}

export async function listDelayEvents(scheduleId: string, orgId: string): Promise<(DelayEvent & { runs: number; lastRunAt: string | null })[]> {
  await initSchema()
  const res = await query(`SELECT e.*, u.name AS created_by_name, (SELECT COUNT(*) FROM tia_runs r WHERE r.delay_event_id=e.id AND r.org_id=e.org_id)::int AS runs,
    (SELECT MAX(r.created_at) FROM tia_runs r WHERE r.delay_event_id=e.id AND r.org_id=e.org_id) AS last_run_at
    FROM delay_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.schedule_id=$1 AND e.org_id=$2 ORDER BY e.created_at, e.id`, [scheduleId, orgId])
  return res.rows.map(r => ({ ...rowToEvent(r), runs: Number(r.runs), lastRunAt: r.last_run_at ? ts(r.last_run_at) : null }))
}

export async function getDelayEvent(id: string, scheduleId: string, orgId: string): Promise<DelayEvent | null> {
  await initSchema()
  const res = await query(`SELECT e.*, u.name AS created_by_name FROM delay_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id=$1 AND e.schedule_id=$2 AND e.org_id=$3`, [id, scheduleId, orgId])
  return res.rows[0] ? rowToEvent(res.rows[0]) : null
}

export async function createDelayEvent(orgId: string, e: Omit<DelayEvent, 'createdAt' | 'updatedAt' | 'createdByName' | 'status' | 'statusNote' | 'updatedBy'>): Promise<DelayEvent> {
  await initSchema()
  await query(`INSERT INTO delay_events (id, org_id, schedule_id, title, description, responsibility, event_start, event_end, notified_on, evidence, fragnet, created_by, updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
  [e.id, orgId, e.scheduleId, e.title, e.description, e.responsibility, e.eventStart, e.eventEnd, e.notifiedOn, JSON.stringify(e.evidence), JSON.stringify(e.fragnet), e.createdBy])
  return (await getDelayEvent(e.id, e.scheduleId, orgId))!
}

const COLUMNS: Record<string, string> = {
  title: 'title', description: 'description', responsibility: 'responsibility', eventStart: 'event_start', eventEnd: 'event_end', notifiedOn: 'notified_on',
  evidence: 'evidence', fragnet: 'fragnet', status: 'status', statusNote: 'status_note',
}

export async function updateDelayEvent(id: string, scheduleId: string, orgId: string, by: string, fields: Partial<Pick<DelayEvent, 'title' | 'description' | 'responsibility' | 'eventStart' | 'eventEnd' | 'notifiedOn' | 'evidence' | 'fragnet' | 'status' | 'statusNote'>>): Promise<DelayEvent | null> {
  await initSchema()
  const sets: string[] = []
  const params: unknown[] = [id, scheduleId, orgId, by]
  for (const [k, v] of Object.entries(fields)) {
    const col = COLUMNS[k]
    if (!col || v === undefined) continue
    params.push(k === 'evidence' || k === 'fragnet' ? JSON.stringify(v) : v)
    sets.push(`${col}=$${params.length}`)
  }
  await query(`UPDATE delay_events SET ${[...sets, 'updated_by=$4', 'updated_at=NOW()'].join(', ')} WHERE id=$1 AND schedule_id=$2 AND org_id=$3`, params)
  return getDelayEvent(id, scheduleId, orgId)
}

/** Deletes a delay event that has never been run (analysed events are kept as a record; reject them instead). */
export async function deleteDelayEvent(id: string, scheduleId: string, orgId: string): Promise<boolean> {
  await initSchema()
  const res = await query(`DELETE FROM delay_events e WHERE e.id=$1 AND e.schedule_id=$2 AND e.org_id=$3 AND NOT EXISTS (SELECT 1 FROM tia_runs r WHERE r.delay_event_id=e.id)`, [id, scheduleId, orgId])
  return (res.rowCount ?? 0) > 0
}

export async function addTiaRun(orgId: string, run: Omit<TiaRun, 'createdAt' | 'createdByName'>): Promise<TiaRun> {
  await initSchema()
  await query(`INSERT INTO tia_runs (id, org_id, delay_event_id, schedule_id, inputs_hash, result_hash, engine, inputs, before_result, after_result, result, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [run.id, orgId, run.delayEventId, run.scheduleId, run.inputsHash, run.resultHash, run.engine, JSON.stringify(run.inputs), JSON.stringify(run.before), JSON.stringify(run.after), JSON.stringify(run.result), run.createdBy])
  return (await getTiaRun(run.id, run.delayEventId, orgId))!
}

export async function listTiaRuns(delayEventId: string, orgId: string): Promise<TiaRun[]> {
  await initSchema()
  const res = await query(`SELECT r.*, u.name AS created_by_name FROM tia_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.delay_event_id=$1 AND r.org_id=$2 ORDER BY r.created_at DESC, r.id`, [delayEventId, orgId])
  return res.rows.map(rowToRun)
}

export async function getTiaRun(id: string, delayEventId: string, orgId: string): Promise<TiaRun | null> {
  await initSchema()
  const res = await query(`SELECT r.*, u.name AS created_by_name FROM tia_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.id=$1 AND r.delay_event_id=$2 AND r.org_id=$3`, [id, delayEventId, orgId])
  return res.rows[0] ? rowToRun(res.rows[0]) : null
}

/** Everything the organization stored for TIA on one schedule (data export). */
export async function exportTimeImpact(scheduleId: string, orgId: string) {
  const events = await listDelayEvents(scheduleId, orgId)
  const out = []
  for (const e of events) out.push({ ...e, runs: await listTiaRuns(e.id, orgId) })
  return out
}
