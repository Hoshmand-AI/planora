// What the "Critical activities" number on the dashboard can honestly say. A count of 0 is only a
// finding when RunF9 calculated the network; a file without logic (or one RunF9 could not
// calculate) has no critical path at all, and the dashboard must say why instead of showing 0.

import type { Activity } from '@/lib/db'
import { fmtDate } from '@/lib/format'

export interface CriticalPathStatus {
  /** false when the critical path cannot be determined (the count is then not shown) */
  determined: boolean
  /** open activities on the critical path (total float <= 0), as calculated */
  count: number
  /** Short line under the number */
  label: string
  /** Why, in a sentence (null when the count speaks for itself) */
  detail: string | null
  /** Activities missing a predecessor or a successor, not counting the project's start and finish */
  openEnds: number
}

const isWork = (a: Pick<Activity, 'activityType'>) => a.activityType !== 'summary' && a.activityType !== 'loe'

export function criticalPathStatus(input: {
  activities: Pick<Activity, 'id' | 'activityType' | 'status' | 'actualFinish' | 'isCritical' | 'earlyStart' | 'earlyFinish'>[]
  links: { from: string; to: string }[]
  /** true when RunF9 recalculated the network (CPM ran) */
  calculated: boolean
  mustFinishBy?: string | null
  /** lowest total float among open activities (work days) */
  minFloat?: number | null
}): CriticalPathStatus {
  const work = input.activities.filter(isWork)
  const ids = new Set(work.map(a => a.id))
  const links = input.links.filter(l => ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
  const hasPred = new Set(links.map(l => l.to))
  const hasSucc = new Set(links.map(l => l.from))
  const noPred = work.filter(a => !hasPred.has(a.id))
  const noSucc = work.filter(a => !hasSucc.has(a.id))
  // The project's own start and finish are allowed one open end each (DCMA #1 counts the rest).
  const startOk = noPred.some(a => a.activityType === 'milestone') ? 1 : noPred.length ? 1 : 0
  const finishOk = noSucc.some(a => a.activityType === 'milestone') ? 1 : noSucc.length ? 1 : 0
  const missing = new Set([...noPred, ...noSucc].map(a => a.id)).size
  const openEnds = links.length ? Math.max(0, missing - startOk - finishOk) : work.length
  const open = work.filter(a => a.status !== 'complete' && !a.actualFinish)
  const count = open.filter(a => a.isCritical).length
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  if (!work.length) return { determined: true, count: 0, label: 'no activities', detail: null, openEnds: 0 }
  if (!open.length) return { determined: true, count: 0, label: 'all work is complete', detail: null, openEnds }
  if (!links.length) {
    return {
      determined: false, count: 0, label: 'No logic links found', openEnds,
      detail: `The file has no relationships between its ${plural(work.length, 'activity', 'activities')}, so float and the critical path cannot be calculated.`,
    }
  }
  if (!input.calculated) {
    return {
      determined: false, count: 0, label: "Critical path can't be determined", openEnds,
      detail: 'RunF9 could not recalculate this schedule (see the calculation notes), so the float in the file is not confirmed and no critical path is claimed.',
    }
  }
  const endsNote = openEnds > 0 && openEnds >= Math.max(2, Math.round(work.length * 0.05))
    ? ` ${plural(openEnds, 'activity is', 'activities are')} missing a predecessor or successor (open ends), so float elsewhere may be overstated.`
    : ''
  if (count === 0) {
    const why = input.mustFinishBy && input.minFloat != null && input.minFloat > 0
      ? `The required finish ${fmtDate(input.mustFinishBy)} leaves every open activity at least ${input.minFloat} work days of float, so none is at zero float.`
      : 'No open activity has zero or negative total float.'
    return { determined: true, count, label: 'none at zero float', detail: `${why}${endsNote}`, openEnds }
  }
  return { determined: true, count, label: `of ${open.length} open`, detail: endsNote.trim() || null, openEnds }
}
