// What the recent changes made in RunF9 did to the schedule: which activities were changed in the last
// few days, and which activities moved because of the edits (the schedule with the edits against the
// file as submitted). The Schedule tab and the Daily Brief highlight these while the changes are recent.

import { loadScheduleData } from '@/lib/planning/service'
import type { ScheduleEditChange } from '@/lib/planning/uploaded-edits'

/** Changes stay highlighted for this many days. */
export const HIGHLIGHT_DAYS = 7
export const MAX_MOVED = 200

export interface ChangeImpact {
  windowDays: number
  /** Activities an edit touched directly in the window, newest first */
  changed: { id: string; code: string; name: string; what: string; before: string; after: string; by: string; at: string; reason: string }[]
  /** Open activities whose dates differ from the schedule as submitted, largest move first */
  moved: { id: string; code: string; name: string; startDays: number; finishDays: number }[]
  movedCount: number
  /** Project finish with the edits against the finish as submitted (calendar days; + is later) */
  finishMovedDays: number | null
}

const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null)
const diff = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
const touched = (c: ScheduleEditChange): string[] => ('activityId' in c ? [c.activityId] : [c.predecessorId, c.successorId])

export async function loadChangeImpact(scheduleId: string, orgId: string, now = Date.now()): Promise<ChangeImpact | null> {
  const data = await loadScheduleData(scheduleId, orgId, { basis: 'scenario' })
  if (!data) return null
  const empty: ChangeImpact = { windowDays: HIGHLIGHT_DAYS, changed: [], moved: [], movedCount: 0, finishMovedDays: null }
  const since = now - HIGHLIGHT_DAYS * 86_400_000
  const recent = data.edits.filter(e => e.status === 'applied' && Date.parse(e.at) >= since).reverse()
  if (!recent.length) return empty
  const byId = new Map(data.activities.map(a => [a.id, a]))
  const seen = new Set<string>()
  const changed: ChangeImpact['changed'] = []
  for (const e of recent) for (const id of touched(e.change)) {
    const a = byId.get(id)
    if (!a || seen.has(id)) continue
    seen.add(id)
    changed.push({ id, code: a.activityId, name: a.name, what: e.label, before: e.before, after: e.after, by: e.byName || 'Member', at: e.at, reason: e.reason })
  }
  const submitted = await loadScheduleData(scheduleId, orgId, { basis: 'submitted' })
  if (!submitted) return { ...empty, changed }
  const was = new Map(submitted.activities.map(a => [a.id, a]))
  const moved: ChangeImpact['moved'] = []
  for (const a of data.activities) {
    const b = was.get(a.id)
    if (!b || a.activityType === 'summary' || a.activityType === 'loe' || b.status === 'complete') continue
    const s0 = day(b.actualStart ?? b.earlyStart), s1 = day(a.actualStart ?? a.earlyStart), f0 = day(b.actualFinish ?? b.earlyFinish), f1 = day(a.actualFinish ?? a.earlyFinish)
    const startDays = s0 && s1 ? diff(s0, s1) : 0, finishDays = f0 && f1 ? diff(f0, f1) : 0
    if (startDays || finishDays) moved.push({ id: a.id, code: a.activityId, name: a.name, startDays, finishDays })
  }
  moved.sort((x, y) => Math.abs(y.finishDays) - Math.abs(x.finishDays) || Math.abs(y.startDays) - Math.abs(x.startDays))
  const f0 = day(submitted.analysis.forecastFinish), f1 = day(data.analysis.forecastFinish)
  return { windowDays: HIGHLIGHT_DAYS, changed, moved: moved.slice(0, MAX_MOVED), movedCount: moved.length, finishMovedDays: f0 && f1 ? diff(f0, f1) : null }
}
