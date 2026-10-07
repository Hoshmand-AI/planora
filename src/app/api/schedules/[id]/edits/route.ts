import { NextResponse } from 'next/server'
import { randomUUID as uuid } from 'crypto'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { addScheduleEdits, revertScheduleEdit } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { applyScheduleEdits, reasonError, validateEditChange, type ScheduleEdit } from '@/lib/planning/uploaded-edits'

// Edits build the what-if scenario, so this route always works on it (validation against the edited
// network, forecasts with the edits). The schedule as submitted is unchanged and stays the default
// basis of every other view, analysis and export.
const SCENARIO = { basis: 'scenario' as const }

/**
 * Edits made in Planora to an uploaded schedule (override layer; the imported file is not changed).
 *   GET                       → { edits (active, as applied), reverted, editedActivityIds, forecastFinish (scenario), submittedForecastFinish, minFloat }
 *   POST { change | changes[], reason, source?: 'manual'|'recovery', optionId? }
 *        change: { kind: 'duration', activityId, remaining }
 *              | { kind: 'link_set', predecessorId, successorId, type: FS|SS|FF|SF, lag }
 *              | { kind: 'link_remove', predecessorId, successorId }
 *              | { kind: 'constraint', activityId, constraint: { type, date } | null }
 *        Activities by Planora id or activity code. Every edit needs a reason and is audited.
 *   DELETE ?editId=…&reason=… → revert one edit (kept in the record as reverted).
 * Writing needs schedule.write (owner, admin, scheduler); reviewers and viewers can read only.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId, SCENARIO)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(summary(data))
})

export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId, SCENARIO)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (data.schedule.sourceType === 'generated') return NextResponse.json({ error: 'This schedule was published from a Planora plan; edit the plan instead (Plan → Schedule).', code: 'edit_plan_instead' }, { status: 400 })
  const b = await readBody<Record<string, unknown>>(req)
  const reasonErr = reasonError(b.reason)
  if (reasonErr) return NextResponse.json({ error: reasonErr, code: 'reason_required' }, { status: 400 })
  const raw = Array.isArray(b.changes) ? b.changes : b.change ? [b.change] : []
  if (!raw.length || raw.length > 50) return NextResponse.json({ error: 'Send one edit as change, or up to 50 as changes.' }, { status: 400 })
  const reason = String(b.reason).trim().slice(0, 1000)
  const source = b.source === 'recovery' ? 'recovery' : 'manual'
  const optionId = typeof b.optionId === 'string' ? b.optionId.slice(0, 200) : null

  // Validate each change against the network as the earlier changes of this request leave it.
  let acts = data.activities, rels = data.relationships
  const edits: ScheduleEdit[] = []
  const at = new Date()
  for (const [i, r] of raw.entries()) {
    const v = validateEditChange(r, acts, rels)
    if ('error' in v) return NextResponse.json({ error: raw.length > 1 ? `Edit ${i + 1}: ${v.error}` : v.error, code: 'invalid_edit' }, { status: 400 })
    // Distinct, ordered timestamps so the edits replay in the order given.
    const e: ScheduleEdit = { id: uuid(), change: v.change, reason, by: auth.userId, byName: auth.name, at: new Date(at.getTime() + i).toISOString(), source, optionId }
    const next = applyScheduleEdits(acts, rels, [e])
    acts = next.activities; rels = next.relationships
    edits.push(e)
  }
  await addScheduleEdits(data.schedule.id, auth.orgId, edits)
  const after = await loadScheduleData(params.id, auth.orgId, SCENARIO)
  const byId = new Map((after?.edits ?? []).map(e => [e.id, e]))
  for (const e of edits) {
    const a = byId.get(e.id)
    await audit({ action: 'schedule.edit', targetType: 'schedule', targetId: data.schedule.id, detail: {
      schedule: data.schedule.name, version: data.schedule.version, editId: e.id, kind: e.change.kind, what: a?.label ?? null, before: a?.before ?? null, after: a?.after ?? null,
      reason, source, optionId, forecastBefore: data.analysis.forecastFinish, forecastAfter: after?.analysis.forecastFinish ?? null,
    } })
  }
  return NextResponse.json({ success: true, added: edits.map(e => e.id), ...(after ? summary(after) : {}) })
})

export const DELETE = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const editId = req.nextUrl.searchParams.get('editId') || ''
  const reason = (req.nextUrl.searchParams.get('reason') || '').trim()
  const reasonErr = reasonError(reason)
  if (reasonErr) return NextResponse.json({ error: reasonErr.replace('for the edit', 'for reverting the edit'), code: 'reason_required' }, { status: 400 })
  const data = await loadScheduleData(params.id, auth.orgId, SCENARIO)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const edit = data.edits.find(e => e.id === editId)
  if (!edit || !(await revertScheduleEdit(data.schedule.id, auth.orgId, editId, auth.userId, reason.slice(0, 1000)))) return NextResponse.json({ error: 'No active edit with that id.' }, { status: 404 })
  const after = await loadScheduleData(params.id, auth.orgId, SCENARIO)
  await audit({ action: 'schedule.edit_revert', targetType: 'schedule', targetId: data.schedule.id, detail: {
    schedule: data.schedule.name, version: data.schedule.version, editId, kind: edit.change.kind, what: edit.label, before: edit.before, after: edit.after,
    originalReason: edit.reason, reason: reason.slice(0, 1000), forecastBefore: data.analysis.forecastFinish, forecastAfter: after?.analysis.forecastFinish ?? null,
  } })
  return NextResponse.json({ success: true, ...(after ? summary(after) : {}) })
})

function summary(data: NonNullable<Awaited<ReturnType<typeof loadScheduleData>>>) {
  return {
    edits: data.edits, reverted: data.revertedEdits, editedActivityIds: data.editedActivityIds,
    basis: 'scenario' as const, scenarioName: data.editsApplied ? `With Planora edits (${data.editsApplied})` : null,
    forecastFinish: data.analysis.forecastFinish, minFloat: data.analysis.minFloat,
    // The stored headline is the schedule as submitted.
    submittedForecastFinish: data.submittedForecastFinish,
    editable: data.schedule.sourceType !== 'generated',
    // Pick list for the edit form: open work activities with what an edit would change.
    activities: data.activities.filter(a => a.activityType === 'task' || a.activityType === 'milestone').map(a => ({
      id: a.id, code: a.activityId, name: a.name, type: a.activityType, status: a.status,
      remaining: a.status === 'in_progress' ? a.remainingDuration : a.duration, constraint: a.constraintType ? `${a.constraintType} ${a.constraintDate ?? ''}`.trim() : null,
    })),
    relationships: data.relationships.map(r => ({ predecessorId: r.predecessorId, successorId: r.successorId, type: r.type, lag: r.lag })),
  }
}
