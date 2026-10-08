import { NextResponse } from 'next/server'
import { api, body as readBody } from '@/lib/server/api'
import { basisFrom, basisWarning, loadScheduleData } from '@/lib/planning/service'
import { analyzeResources } from '@/lib/analysis/resources'
import { levelResources, loadActivitiesOf } from '@/lib/planning/leveling'
import { availabilityFrom, bucketFrom, isLevelingEdit, levelingNetworkOf, loadActivitiesOfData, loadScheduleResources } from '@/lib/planning/resource-service'

/**
 * Resource analysis of an uploaded schedule: per-resource loading (actual units before the data date,
 * remaining units after, spread over each activity's calendar), peak vs available, histograms and
 * over-allocated periods with the activities contributing. Resources come from the stored file (P6
 * RSRC / TASKRSRC, MS Project Resources / Assignments, spreadsheet resource columns); a file without
 * them gives state "no_resource_data" (nothing is invented).
 *   GET ?bucket=day|week|month (week) &resource=<id> (histogram of one resource; all for week / month)
 *       &availability={"<resourceId>": unitsPerDay} (what-if staffing) &basis=scenario (with Planora edits)
 *   POST { mode: 'level'|'smooth', allowFinishExtension?, availability?, resource?, bucket? }
 *       → a leveling PREVIEW on the schedule as submitted plus the non-leveling Planora edits: before /
 *         after finish and contract milestones, the delays it would introduce, what remains
 *         over-allocated, and the leveled loading. Nothing is stored; save it with
 *         POST /api/schedules/{id}/resources/level.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const sp = req.nextUrl.searchParams
  const data = await loadScheduleData(params.id, auth.orgId, { basis: basisFrom(sp) })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const resources = await loadScheduleResources(data.schedule, auth.orgId, data.activities)
  const bucket = bucketFrom(sp.get('bucket'))
  let raw: unknown = null
  try { raw = JSON.parse(sp.get('availability') || 'null') } catch { raw = null }
  const availability = availabilityFrom(raw, resources)
  const resource = sp.get('resource')
  const first = resources?.resources[0]?.id
  const histogramFor = resource ? [resource] : bucket === 'day' ? (first ? [first] : []) : 'all'
  const analysis = analyzeResources({
    activities: loadActivitiesOfData(data), calendars: data.schedule.calendars, defaultCalendarId: data.schedule.defaultCalendarId,
    dataDate: data.schedule.dataDate, data: resources, availability,
  }, { bucket, histogramFor })
  return NextResponse.json({ ...analysis, ...context(data), availability })
})

export const POST = api<{ id: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships, so Planora cannot recalculate it to level resources.', code: 'no_logic' }, { status: 400 })
  const b = await readBody<Record<string, unknown>>(req)
  const resources = await loadScheduleResources(data.schedule, auth.orgId, data.activities)
  const net = levelingNetworkOf(data, resources)
  const result = levelResources(net, {
    mode: b.mode === 'smooth' ? 'smooth' : 'level', allowFinishExtension: b.allowFinishExtension === true,
    availability: availabilityFrom(b.availability, resources),
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: 'cannot_level' }, { status: 400 })
  const resource = typeof b.resource === 'string' ? b.resource : null
  const after = net.run(new Map(result.changes.map(c => [c.activityId, c.constraint!.date])))
  const leveled = after ? analyzeResources({
    activities: loadActivitiesOf(net, after), calendars: net.calendars, defaultCalendarId: net.defaultCalendarId, dataDate: net.dataDate, data: resources, availability: result.availability,
  }, { bucket: bucketFrom(b.bucket), histogramFor: resource ? [resource] : [] }) : null
  return NextResponse.json({ result, leveled, ...context(data) })
})

function context(data: NonNullable<Awaited<ReturnType<typeof loadScheduleData>>>) {
  return {
    basis: data.basis, editsApplied: data.editsApplied, basisNote: basisWarning(data.basis, data.editsApplied),
    levelingEdits: data.edits.filter(e => e.status === 'applied' && isLevelingEdit(e)).length,
    editable: data.schedule.sourceType !== 'generated', hasLogic: !!data.cpm,
    schedule: { id: data.schedule.id, name: data.schedule.name, version: data.schedule.version, dataDate: data.schedule.dataDate },
  }
}
