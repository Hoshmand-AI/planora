// Loads what a Time Impact Analysis needs for one update (org-scoped): the update's network as loaded
// (as submitted, or the what-if scenario with Planora edits), the previous update of the same project
// for the concurrency indicators, and whether the update was recorded as accepted in the submission review.

import { getReviewState, getScheduleSeries } from '@/lib/db'
import { orderSeries } from '@/lib/analysis/compare'
import { loadScheduleData, type ScheduleBasis } from '@/lib/planning/service'
import type { TiaNetwork, TiaPrevious } from '@/lib/analysis/tia'

export async function loadTiaContext(scheduleId: string, orgId: string, basis: ScheduleBasis = 'submitted') {
  const data = await loadScheduleData(scheduleId, orgId, { basis })
  if (!data) return null
  const s = data.schedule
  const net: TiaNetwork = {
    scheduleId: s.id, scheduleName: s.name, version: s.version, activities: data.activities, relationships: data.relationships,
    calendars: s.calendars, defaultCalendarId: s.defaultCalendarId, projectStart: s.projectStart, dataDate: s.dataDate,
    mustFinishBy: data.analysis.mustFinishBy ?? null, progressMode: data.analysis.progressMode ?? 'retained', finishMilestoneId: s.finishMilestoneId ?? null,
    basis: data.basis, editsApplied: data.basis === 'scenario' ? data.editsApplied : 0,
  }
  let previous: TiaPrevious | null = null
  if (s.projectKey) {
    const series = orderSeries(await getScheduleSeries(orgId, s.projectKey))
    const idx = series.findIndex(x => x.id === s.id)
    const prev = idx > 0 ? series.slice(0, idx).reverse().find(x => !s.dataDate || !x.dataDate || x.dataDate < s.dataDate) : undefined
    const p = prev ? await loadScheduleData(prev.id, orgId).catch(() => null) : null
    if (p) previous = { scheduleId: p.schedule.id, label: `${p.schedule.name} (${p.schedule.version})`, dataDate: p.schedule.dataDate, activities: p.activities }
  }
  const review = await getReviewState(s.id, orgId).catch(() => null)
  const sub = review?.submission?.disposition ?? null
  const acceptanceNote = sub === 'approved' || sub === 'approved_as_noted'
    ? null
    : `This update is not recorded as accepted in its submission review (${sub ? sub.replace(/_/g, ' ') : 'no disposition recorded'}); a TIA is normally run on an accepted update.`
  return { data, net, previous, acceptanceNote }
}

/** Pick list for the fragnet editor: scheduled work activities and the calendars. */
export function pickList(data: NonNullable<Awaited<ReturnType<typeof loadScheduleData>>>) {
  return {
    activities: data.activities.filter(a => a.activityType === 'task' || a.activityType === 'milestone').map(a => ({
      code: a.activityId, name: a.name, type: a.activityType, status: a.status, start: a.actualStart || a.earlyStart, finish: a.actualFinish || a.earlyFinish, totalFloat: a.totalFloat,
    })).sort((x, y) => x.code.localeCompare(y.code)),
    calendars: (data.schedule.calendars || []).map(c => ({ id: c.id, name: c.name })),
    defaultCalendarId: data.schedule.defaultCalendarId,
  }
}
