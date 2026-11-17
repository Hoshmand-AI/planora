import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { getScheduleById, getScheduleSeries, setScheduleBaseline } from '@/lib/db'
import { orderSeries } from '@/lib/analysis/compare'
import { loadScheduleData } from '@/lib/planning/service'
import { registerKey } from '@/lib/server/register'
import { getScheduleRoles, setScheduleRoles } from '@/lib/server/schedule-roles'
import { fmtDate } from '@/lib/format'

/**
 * The uploads a project keeps to compare against.
 *   GET  → { baseline, comparison, series, canEdit }
 *   PUT  { baselineScheduleId?: id | null, comparisonScheduleId?: id | null }   → the same shape
 * The baseline is the upload every update is measured against (variance, BEI, missed tasks, reports, the trend);
 * it is applied to every upload of the project dated on or after it, and to each new upload as it arrives.
 * The comparison schedule (for example last month's update) is what "what changed" compares with unless another
 * is picked. Both must be uploads of this project. Changing either needs schedule.write and is audited.
 */
type Row = { id: string; version: string; dataDate: string | null }
const row = (s: { id: string; version: string; dataDate: string | null }): Row => ({ id: s.id, version: s.version, dataDate: s.dataDate })

async function load(orgId: string, id: string) {
  const schedule = await getScheduleById(id, orgId)
  if (!schedule) throw new ApiError(404, 'Not found')
  const series = orderSeries(schedule.projectKey ? await getScheduleSeries(orgId, schedule.projectKey, schedule.workspaceId ?? null) : [schedule])
  const key = registerKey(schedule)
  const roles = await getScheduleRoles(orgId, key)
  return { schedule, series, key, roles }
}
const view = (series: Row[], roles: { baselineScheduleId: string | null; comparisonScheduleId: string | null }, canEdit: boolean) => ({
  baseline: series.find(s => s.id === roles.baselineScheduleId) ?? null,
  comparison: series.find(s => s.id === roles.comparisonScheduleId) ?? null,
  series, canEdit,
})

export const GET = api<{ id: string }>({ permission: 'read' }, async (_req, { params, auth }) => {
  const { series, roles } = await load(auth.orgId, params.id)
  return json(view(series.map(row), roles, can(auth.role, 'schedule.write')))
})

export const PUT = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { schedule, series, key, roles } = await load(auth.orgId, params.id)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw new ApiError(400, 'Send the choice as JSON.')
  const pick = (field: 'baselineScheduleId' | 'comparisonScheduleId', what: string): string | null | undefined => {
    if (!(field in body)) return undefined
    const raw = body[field]
    if (raw === null || raw === '') return null
    const hit = typeof raw === 'string' ? series.find(s => s.id === raw) : undefined
    if (!hit) throw new ApiError(400, `The ${what} must be an upload of this project.`, 'invalid_schedule_role')
    return hit.id
  }
  const baseline = pick('baselineScheduleId', 'baseline'), comparison = pick('comparisonScheduleId', 'comparison schedule')
  if (baseline === undefined && comparison === undefined) throw new ApiError(400, 'Nothing to change.')
  const next = { baselineScheduleId: baseline === undefined ? roles.baselineScheduleId : baseline, comparisonScheduleId: comparison === undefined ? roles.comparisonScheduleId : comparison }
  await setScheduleRoles(auth.orgId, key, next, auth.userId)

  if (baseline !== undefined && baseline !== roles.baselineScheduleId) {
    // Every upload dated on or after the baseline is measured against it; one dated before it, or the baseline
    // itself, is not. Clearing the baseline returns each upload to the one labelled Baseline, if any.
    const base = series.find(s => s.id === baseline) ?? null
    const touched: string[] = []
    for (const u of series) {
      const applies = !!base && u.id !== base.id && (!base.dataDate || !u.dataDate || base.dataDate <= u.dataDate)
      const want = applies ? base!.id : null
      if ((u.baselineScheduleId ?? null) === want) continue
      // Only this project's own designation is replaced: an upload measured against some other chosen upload keeps it.
      if (!applies && (u.baselineScheduleId ?? null) !== roles.baselineScheduleId) continue
      await setScheduleBaseline(u.id, auth.orgId, want)
      touched.push(u.id)
    }
    // Recalculate so the stored headline of each upload (lists, the portfolio) reflects the new baseline.
    for (const id of touched.slice(0, 40)) await loadScheduleData(id, auth.orgId).catch(() => null)
    await audit({ action: 'schedule.project_baseline', targetType: 'schedule', targetId: schedule.id, detail: {
      name: schedule.name, before: roles.baselineScheduleId, after: baseline, baseline: base ? { version: base.version, dataDate: base.dataDate ? fmtDate(base.dataDate) : null } : null, uploadsRemeasured: touched.length,
    } })
  }
  if (comparison !== undefined && comparison !== roles.comparisonScheduleId) {
    const c = series.find(s => s.id === comparison) ?? null
    await audit({ action: 'schedule.project_comparison', targetType: 'schedule', targetId: schedule.id, detail: {
      name: schedule.name, before: roles.comparisonScheduleId, after: comparison, comparison: c ? { version: c.version, dataDate: c.dataDate ? fmtDate(c.dataDate) : null } : null,
    } })
  }
  return json(view(series.map(row), next, true))
})
