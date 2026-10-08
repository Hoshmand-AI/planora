import { NextResponse } from 'next/server'
import { randomUUID as uuid } from 'crypto'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { addScheduleEdits, revertScheduleEdit } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { LEVELED_SCENARIO_LABEL, levelResources } from '@/lib/planning/leveling'
import { reasonError, type ScheduleEdit } from '@/lib/planning/uploaded-edits'
import { availabilityFrom, isLevelingEdit, levelingNetworkOf, loadScheduleResources } from '@/lib/planning/resource-service'

/**
 * Save a resource leveling run as the "Leveled scenario" of an uploaded schedule.
 *   POST { mode: 'level'|'smooth', allowFinishExtension?, availability?, reason }
 *     Levels the schedule as submitted plus the non-leveling Planora edits, replaces the previous
 *     leveled scenario (its edits are reverted, kept in the record) and records one Start On or After
 *     edit per delayed activity (source 'leveling'), each with the reason. The scenario is then the
 *     basis=scenario network of every view and export. Audited.
 *   DELETE ?reason=…  removes the leveled scenario (reverts its edits). Audited.
 * The imported file is never changed. Needs schedule.write.
 */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (data.schedule.sourceType === 'generated') return NextResponse.json({ error: 'This schedule was published from a Planora plan; level the plan instead.', code: 'edit_plan_instead' }, { status: 400 })
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships, so Planora cannot recalculate it to level resources.', code: 'no_logic' }, { status: 400 })
  const b = await readBody<Record<string, unknown>>(req)
  const reasonErr = reasonError(b.reason)
  if (reasonErr) return NextResponse.json({ error: reasonErr, code: 'reason_required' }, { status: 400 })
  const reason = String(b.reason).trim().slice(0, 1000)
  const resources = await loadScheduleResources(data.schedule, auth.orgId, data.activities)
  if (!resources) return NextResponse.json({ error: 'This schedule has no resource data, so there is nothing to level.', code: 'no_resource_data' }, { status: 400 })
  const mode = b.mode === 'smooth' ? 'smooth' : 'level'
  const result = levelResources(levelingNetworkOf(data, resources), { mode, allowFinishExtension: b.allowFinishExtension === true, availability: availabilityFrom(b.availability, resources) })
  if (!result.ok) return NextResponse.json({ error: result.error, code: 'cannot_level' }, { status: 400 })

  // A new run replaces the previous leveled scenario.
  const previous = data.edits.filter(e => e.status === 'applied' && isLevelingEdit(e))
  for (const e of previous) await revertScheduleEdit(data.schedule.id, auth.orgId, e.id, auth.userId, 'Replaced by a new resource leveling run.')
  const runId = uuid()
  const at = Date.now()
  const byId = new Map(result.delays.map(d => [d.activityId, d]))
  const edits: ScheduleEdit[] = result.changes.map((change, i) => ({
    id: uuid(), change, reason: `${reason} — ${byId.get(change.activityId)?.reason ?? 'Resource leveling delay.'}`.slice(0, 1000),
    by: auth.userId, byName: auth.name, at: new Date(at + i).toISOString(), source: 'leveling', optionId: `leveling:${runId}`,
  }))
  if (edits.length) await addScheduleEdits(data.schedule.id, auth.orgId, edits)
  const after = await loadScheduleData(params.id, auth.orgId, { basis: 'scenario' })
  await audit({ action: 'schedule.level', targetType: 'schedule', targetId: data.schedule.id, detail: {
    schedule: data.schedule.name, version: data.schedule.version, scenario: LEVELED_SCENARIO_LABEL, runId, mode, allowFinishExtension: result.allowFinishExtension,
    availability: result.availability, reason, delays: result.delays.map(d => ({ code: d.code, from: d.fromStart, to: d.toStart, workDays: d.workDays })),
    replacedEdits: previous.length, finishBefore: result.before.finish, finishAfter: result.after.finish,
    overAllocatedDaysBefore: result.before.overAllocatedDays, overAllocatedDaysAfter: result.after.overAllocatedDays,
    forecastAfter: after?.analysis.forecastFinish ?? null,
  } })
  return NextResponse.json({ success: true, runId, scenario: LEVELED_SCENARIO_LABEL, added: edits.map(e => e.id), replaced: previous.length, result, editsApplied: after?.editsApplied ?? 0, forecastFinish: after?.analysis.forecastFinish ?? null })
})

export const DELETE = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const reason = (req.nextUrl.searchParams.get('reason') || '').trim()
  const reasonErr = reasonError(reason)
  if (reasonErr) return NextResponse.json({ error: reasonErr.replace('for the edit', 'for removing the leveled scenario'), code: 'reason_required' }, { status: 400 })
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const leveling = data.edits.filter(e => e.status === 'applied' && isLevelingEdit(e))
  if (!leveling.length) return NextResponse.json({ error: 'There is no leveled scenario to remove.' }, { status: 404 })
  for (const e of leveling) await revertScheduleEdit(data.schedule.id, auth.orgId, e.id, auth.userId, reason.slice(0, 1000))
  await audit({ action: 'schedule.level_revert', targetType: 'schedule', targetId: data.schedule.id, detail: {
    schedule: data.schedule.name, version: data.schedule.version, scenario: LEVELED_SCENARIO_LABEL, reverted: leveling.length, reason: reason.slice(0, 1000),
  } })
  return NextResponse.json({ success: true, reverted: leveling.length })
})
