// Near-term outlook for the dashboard overview: what is under way at the data date, and what is
// forecast to start in the two weeks after it. Pure, so it is unit tested.

import type { Activity } from '@/lib/db'

export const NEAR_TERM_DAYS = 14

export interface NearTermRow {
  activityId: string
  name: string
  earlyStart: string | null
  earlyFinish: string | null
  actualStart: string | null
  /** Remaining duration (work days): what is left, not the original duration */
  remainingDuration: number
  totalFloat: number
  isCritical: boolean
  /** Not started although its forecast start is before the window start (the data date) */
  startOverdue?: boolean
}

export interface NearTermOutlook {
  /** The data date, or today when the schedule has none */
  windowStart: string
  windowEnd: string
  basis: 'data_date' | 'today'
  /** Open activities that have started (actual start, no actual finish), lowest float first */
  inProgress: NearTermRow[]
  /** Not-started activities forecast to start on or before windowEnd */
  starting: NearTermRow[]
  /** Totals before the list limit */
  inProgressCount: number
  startingCount: number
}

const addDays = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10) + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'

function row(a: Activity, windowStart: string | null): NearTermRow {
  const r: NearTermRow = {
    activityId: a.activityId, name: a.name, earlyStart: a.earlyStart, earlyFinish: a.earlyFinish, actualStart: a.actualStart,
    remainingDuration: Number.isFinite(a.remainingDuration) ? a.remainingDuration : a.duration,
    totalFloat: a.totalFloat, isCritical: a.isCritical,
  }
  if (windowStart && a.earlyStart && a.earlyStart.slice(0, 10) < windowStart) r.startOverdue = true
  return r
}

export function nearTermOutlook(activities: Activity[], dataDate: string | null, today: string, limit = 10): NearTermOutlook {
  const windowStart = (dataDate || today).slice(0, 10)
  const windowEnd = addDays(windowStart, NEAR_TERM_DAYS)
  const open = activities.filter(a => isWork(a) && a.status !== 'complete' && !a.actualFinish)
  const started = (a: Activity) => a.status === 'in_progress' || !!a.actualStart
  const ip = open.filter(started)
    .sort((x, y) => x.totalFloat - y.totalFloat || (x.earlyFinish || '').localeCompare(y.earlyFinish || ''))
  const st = open
    .filter(a => !started(a) && !!a.earlyStart && a.earlyStart.slice(0, 10) <= windowEnd)
    .sort((x, y) => (x.earlyStart || '').localeCompare(y.earlyStart || '') || x.totalFloat - y.totalFloat)
  return {
    windowStart, windowEnd, basis: dataDate ? 'data_date' : 'today',
    inProgress: ip.slice(0, limit).map(a => row(a, null)),
    starting: st.slice(0, limit).map(a => row(a, windowStart)),
    inProgressCount: ip.length, startingCount: st.length,
  }
}
