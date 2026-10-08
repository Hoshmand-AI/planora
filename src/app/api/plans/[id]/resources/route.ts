import { api, json, body as readBody, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { analyzeResources } from '@/lib/analysis/resources'
import { levelResources, loadActivitiesOf, planLevelingNetwork } from '@/lib/planning/leveling'
import { availabilityFrom, bucketFrom } from '@/lib/planning/resource-service'
import { loadPlanContext } from '../context'

/**
 * Resource analysis and leveling of a plan built in Planora. A plan carries resources only when they
 * were given to it (GeneratedSchedule.resources); Planora's generator does not invent crews, so most
 * plans answer state "no_resource_data".
 *   GET ?bucket=day|week|month &resource=<id> &availability={"<resourceId>": unitsPerDay}
 *   POST { mode: 'level'|'smooth', allowFinishExtension?, availability?, resource?, bucket? }
 *     → the leveled scenario of the plan (before / after finish and milestone targets, delays as
 *       Start On or After dates, remaining over-allocations). Plans are changed through plan edits,
 *       so the scenario is returned, not stored; the run is audited.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const { plan } = await loadPlanContext(req, params.id, auth)
  if (!plan.generated?.cpm) throw new ApiError(400, 'Generate the schedule first.')
  const sp = req.nextUrl.searchParams
  const g = plan.generated
  const net = planLevelingNetwork(g)
  const run = net.run(new Map())
  if (!run) throw new ApiError(400, 'Planora could not recalculate this plan.')
  let raw: unknown = null
  try { raw = JSON.parse(sp.get('availability') || 'null') } catch { raw = null }
  const availability = availabilityFrom(raw, g.resources ?? null)
  const bucket = bucketFrom(sp.get('bucket'))
  const resource = sp.get('resource')
  const first = g.resources?.resources[0]?.id
  const analysis = analyzeResources({ activities: loadActivitiesOf(net, run), calendars: g.calendars, defaultCalendarId: g.defaultCalendarId, dataDate: g.dataDate, data: g.resources, availability },
    { bucket, histogramFor: resource ? [resource] : bucket === 'day' ? (first ? [first] : []) : 'all' })
  return json({ ...analysis, availability, basis: 'submitted', editsApplied: 0, levelingEdits: 0, editable: false, hasLogic: true, plan: { id: plan.id, name: plan.name } })
})

export const POST = api<{ id: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const { plan } = await loadPlanContext(req, params.id, auth)
  if (!plan.generated?.cpm) throw new ApiError(400, 'Generate the schedule first.')
  const b = await readBody<Record<string, unknown>>(req)
  const g = plan.generated
  const net = planLevelingNetwork(g)
  const result = levelResources(net, { mode: b.mode === 'smooth' ? 'smooth' : 'level', allowFinishExtension: b.allowFinishExtension === true, availability: availabilityFrom(b.availability, g.resources ?? null) })
  if (!result.ok) throw new ApiError(400, result.error || 'Planora could not level this plan.')
  const after = net.run(new Map(result.changes.map(c => [c.activityId, c.constraint!.date])))
  const resource = typeof b.resource === 'string' ? b.resource : null
  const leveled = after ? analyzeResources({ activities: loadActivitiesOf(net, after), calendars: g.calendars, defaultCalendarId: g.defaultCalendarId, dataDate: g.dataDate, data: g.resources, availability: result.availability },
    { bucket: bucketFrom(b.bucket), histogramFor: resource ? [resource] : [] }) : null
  if (result.delays.length || Object.keys(result.availability).length) {
    await audit({ action: 'plan.level', targetType: 'plan', targetId: plan.id, detail: {
      plan: plan.name, version: plan.version, mode: result.mode, allowFinishExtension: result.allowFinishExtension, availability: result.availability,
      delays: result.delays.length, finishBefore: result.before.finish, finishAfter: result.after.finish,
    } })
  }
  return json({ result, leveled, basis: 'submitted', editable: false })
})
