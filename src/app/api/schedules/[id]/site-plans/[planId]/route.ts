import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { projectScope } from '@/lib/rag/scope'
import { registerKey } from '@/lib/server/register'
import { deletePlan, getPlan, updatePlan } from '@/lib/server/site-plans'
import { fitPlan, parseControls, parseLevel, parseRooms, type PlanControl, type PlanRoom } from '@/lib/site/plan'

/**
 * One drawing of a level.
 *   PATCH  { level?, rooms?: [{ name, x, y }], controls?: [{ x, y, lat, lng }], sort? }   → { plan, placed }
 *   DELETE → { success }   (captures pinned on it keep their level and room)
 * `controls` are two or three points of the drawing matched to the ground; an empty list removes the placement.
 */
export const PATCH = api<{ id: string; planId: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const key = registerKey(schedule)
  const before = await getPlan(auth.orgId, key, params.planId)
  if (!before) throw new ApiError(404, 'No such drawing in this project.')
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw new ApiError(400, 'Send the changes as JSON.')
  const patch: { level?: string; rooms?: PlanRoom[]; controls?: PlanControl[]; sort?: number } = {}
  if (body.level !== undefined) { const r = parseLevel(body.level); if ('error' in r) throw new ApiError(400, r.error, 'invalid_plan'); patch.level = r.level }
  if (body.rooms !== undefined) { const r = parseRooms(body.rooms); if ('error' in r) throw new ApiError(400, r.error, 'invalid_plan'); patch.rooms = r.rooms }
  if (body.controls !== undefined) {
    const r = parseControls(body.controls)
    if ('error' in r) throw new ApiError(400, r.error, 'invalid_plan')
    if (r.controls.length && !fitPlan({ controls: r.controls, width: before.width, height: before.height })) {
      throw new ApiError(400, 'Those points do not place the drawing: they are too close together, in one line, or mirrored. Match points far apart, such as two opposite corners of the building.', 'invalid_plan')
    }
    patch.controls = r.controls
  }
  if (body.sort !== undefined) { const n = Number(body.sort); if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new ApiError(400, 'The order must be a whole number.', 'invalid_plan'); patch.sort = n }
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to change.', 'invalid_plan')
  const plan = await updatePlan(auth.orgId, key, params.planId, patch)
  if (!plan) throw new ApiError(404, 'No such drawing in this project.')
  await audit({ action: 'site.plan_updated', targetType: 'schedule', targetId: schedule.id, detail: {
    schedule: schedule.name, planId: plan.id, level: plan.level, changed: Object.keys(patch), rooms: plan.rooms.length, placed: plan.controls.length >= 2,
  } })
  return json({ plan, placed: !!fitPlan(plan) })
})

export const DELETE = api<{ id: string; planId: string }>({ permission: 'schedule.write' }, async (_req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const key = registerKey(schedule)
  const plan = await getPlan(auth.orgId, key, params.planId)
  if (!plan || !(await deletePlan(auth.orgId, key, plan.id))) throw new ApiError(404, 'No such drawing in this project.')
  await audit({ action: 'site.plan_deleted', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, planId: plan.id, level: plan.level, rooms: plan.rooms.length } })
  return json({ success: true })
})
