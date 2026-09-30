// Uploaded files don't always carry calculated results: an unscheduled P6 export, a spreadsheet of
// durations and predecessors, or a PDF. Without this step every activity reads as "0 float,
// critical" and the finish is unknown. When the file has logic we run our own CPM to fill the
// gaps; when it has none we say so instead of implying a critical path.

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, CpmActivity, WorkCalendar } from './types'
import { runCpm } from './cpm'
import { defaultCalendar } from './calendar'

export interface CompletionResult {
  activities: Activity[]
  projectStart: string | null
  projectFinish: string | null
  /** What Planora did, in plain language (shown to the user), or null if nothing was needed */
  note: string | null
  hasLogic: boolean
}

const CSTR = new Set(['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'])

export function needsCompletion(activities: Activity[], projectFinish: string | null): boolean {
  const work = activities.filter(a => a.activityType !== 'summary')
  if (!work.length) return false
  const noFloat = work.every(a => !a.totalFloat)
  const noDates = work.filter(a => a.earlyStart && a.earlyFinish).length < work.length * 0.5
  return noFloat || noDates || !projectFinish
}

export function completeSchedule(input: {
  activities: Activity[]
  relationships: Relationship[]
  calendars: WorkCalendar[]
  defaultCalendarId: string | null
  projectStart: string | null
  projectFinish: string | null
  dataDate: string | null
}): CompletionResult {
  const { relationships, calendars } = input
  const activities = input.activities.map(a => ({ ...a }))
  const hasLogic = relationships.length > 0
  const earliest = activities.map(a => a.actualStart || a.earlyStart).filter((d): d is string => !!d).sort()[0] || null
  const latest = activities.map(a => a.actualFinish || a.earlyFinish).filter((d): d is string => !!d).sort().pop() || null

  if (!needsCompletion(activities, input.projectFinish)) {
    return { activities, projectStart: input.projectStart, projectFinish: input.projectFinish, note: null, hasLogic }
  }

  if (!hasLogic) {
    // No relationships: float and the critical path cannot be known. Don't call everything critical.
    for (const a of activities) a.isCritical = false
    return {
      activities, projectStart: input.projectStart || earliest, projectFinish: input.projectFinish || latest, hasLogic,
      note: 'This file has no activity relationships, so float and the critical path cannot be calculated. Dates are shown as listed in the file.',
    }
  }

  const projectStart = input.projectStart || input.dataDate || earliest || new Date().toISOString().slice(0, 10)
  const cals = calendars.length ? calendars : [defaultCalendar()]
  const work = activities.filter(a => a.activityType !== 'summary' && a.activityType !== 'loe')
  const ids = new Set(work.map(a => a.id))
  const cpmActs: CpmActivity[] = work.map(a => ({
    id: a.id, code: a.activityId, name: a.name,
    duration: a.activityType === 'milestone' ? 0 : Math.max(0, Math.round(a.duration)),
    remaining: a.status === 'in_progress' ? Math.max(0, Math.round(a.remainingDuration)) : undefined,
    type: a.activityType === 'milestone' ? 'milestone' : 'task',
    calendarId: a.calendarId || input.defaultCalendarId || cals[0].id,
    constraint: a.constraintType && CSTR.has(a.constraintType) && a.constraintDate ? { type: a.constraintType as ConstraintType, date: a.constraintDate } : undefined,
    actualStart: a.actualStart, actualFinish: a.actualFinish,
  }))
  const res = runCpm({
    projectStart, dataDate: input.dataDate || projectStart, activities: cpmActs,
    links: relationships.filter(r => ids.has(r.predecessorId) && ids.has(r.successorId)).map(r => ({ from: r.predecessorId, to: r.successorId, type: r.type, lag: r.lag })),
    calendars: cals, defaultCalendarId: input.defaultCalendarId || cals[0].id,
  })
  let filled = 0
  for (const a of work) {
    const t = res.times[a.id]
    if (!t) continue
    if (!a.earlyStart) a.earlyStart = t.earlyStart
    if (!a.earlyFinish) a.earlyFinish = t.earlyFinish
    a.lateStart = t.lateStart
    a.lateFinish = t.lateFinish
    a.totalFloat = t.totalFloat
    a.freeFloat = t.freeFloat
    a.isCritical = t.critical && a.status !== 'complete'
    filled++
  }
  return {
    activities, projectStart, projectFinish: input.projectFinish || res.projectFinish, hasLogic,
    note: `The file did not include calculated dates or float, so Planora scheduled ${filled} activities from their durations, logic and calendars (critical path and float are Planora's calculation).`,
  }
}
