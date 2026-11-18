// The four figures at the top of the Daily Brief, in the app and in the email: forecast finish, required finish
// with the difference in days, percent complete, and the alerts to act on today. One function, so the two never
// disagree. Every value is read from the brief as it was calculated; a figure that does not exist is worded
// ("Not set"), never filled with a number. Pure: no database access.

import { fmtDate } from '@/lib/format'
import type { DailyBrief } from './daily-brief'

export interface BriefFigure {
  id: 'forecast' | 'required' | 'complete' | 'alerts'
  label: string
  /** The figure, or the words that say there is none */
  value: string
  /** A short line under the label: the difference in days, the count behind the percentage */
  note: string | null
  /** True when the figure does not exist and `value` says so */
  missing: boolean
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export function briefFigures(brief: Pick<DailyBrief, 'headline'> & { progress?: DailyBrief['progress'] }, alerts: readonly { level: string }[]): BriefFigure[] {
  const h = brief.headline
  // The difference is the brief's own count (calendar days). A required date that has passed with the work
  // unfinished is counted to the brief's day, so it reads "overdue", not "late" against a forecast that has passed too.
  const gap = h.daysBehind == null || !h.required ? null
    : h.daysBehind === 0 ? 'Forecast is on this date'
      : h.daysBehind < 0 ? `Forecast is ${days(-h.daysBehind)} early`
        : h.forecast && h.forecast <= h.required ? `${days(h.daysBehind)} overdue` : `Forecast is ${days(h.daysBehind)} late`
  const p = brief.progress
  const act = alerts.filter(a => a.level === 'act').length
  return [
    { id: 'forecast', label: 'Forecast finish', value: h.forecast ? fmtDate(h.forecast) : 'Not calculated', note: null, missing: !h.forecast },
    { id: 'required', label: 'Required finish', value: h.required ? fmtDate(h.required) : 'Not set', note: gap, missing: !h.required },
    { id: 'complete', label: 'Complete, by duration', value: p?.percentComplete == null ? 'Not available' : `${p.percentComplete}%`, note: p && p.total > 0 ? `${p.finished} of ${p.total} activities finished` : null, missing: p?.percentComplete == null },
    { id: 'alerts', label: 'Alerts to act on today', value: alerts.length ? `${act} of ${alerts.length}` : 'None', note: null, missing: false },
  ]
}
