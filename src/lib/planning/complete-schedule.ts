// Planora recalculates every uploaded schedule that has logic, instead of trusting the dates and
// float written in the file: a reviewer needs to know whether the contractor's float is real, and
// mixing the file's early dates with Planora's late dates produced inconsistent float. The file's
// own finish and float are kept as a snapshot so the differences can be shown. Files without
// logic keep their listed dates and make no critical-path claims.

import type { Activity, Relationship } from '@/lib/db'
import { CONSTRAINT_TYPES, type ConstraintType, type CpmActivity, type CpmResult, type ProgressMode, type WorkCalendar } from './types'
import { runCpm } from './cpm'
import { defaultCalendar } from './calendar'

export interface CompletionResult {
  activities: Activity[]
  projectStart: string | null
  /** Forecast finish: Planora's logic-driven finish when it recalculated, else the file's */
  projectFinish: string | null
  /** What Planora did, in plain language (shown to the user), or null if nothing was needed */
  note: string | null
  hasLogic: boolean
  cpm: CpmResult | null
  /** The file's own early finish and float per activity id, when the file carried calculated values */
  fileValues: Map<string, { earlyFinish: string | null; totalFloat: number | null }> | null
}

const CSTR = new Set<string>(CONSTRAINT_TYPES)

/** True when the file arrived without usable calculated dates/float. */
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
  /** Required finish from the file (P6 Must Finish By); float is measured against it */
  mustFinishBy?: string | null
  progressMode?: ProgressMode
}): CompletionResult {
  const { relationships, calendars } = input
  const activities = input.activities.map(a => ({ ...a }))
  const hasLogic = relationships.length > 0
  const earliest = activities.map(a => a.actualStart || a.earlyStart).filter((d): d is string => !!d).sort()[0] || null
  const latest = activities.map(a => a.actualFinish || a.earlyFinish).filter((d): d is string => !!d).sort().pop() || null
  const fileHadResults = !needsCompletion(activities, input.projectFinish)

  if (!hasLogic) {
    if (fileHadResults) return { activities, projectStart: input.projectStart, projectFinish: input.projectFinish || latest, note: null, hasLogic, cpm: null, fileValues: null }
    // No relationships: float and the critical path cannot be known. Don't call everything critical.
    for (const a of activities) a.isCritical = false
    return {
      activities, projectStart: input.projectStart || earliest, projectFinish: input.projectFinish || latest, hasLogic, cpm: null, fileValues: null,
      note: 'This file has no activity relationships, so float and the critical path cannot be calculated. Dates are shown as listed in the file.',
    }
  }

  const projectStart = input.projectStart || earliest || input.dataDate || new Date().toISOString().slice(0, 10)
  const cals = calendars.length ? calendars : [defaultCalendar()]
  const work = activities.filter(a => a.activityType !== 'summary' && a.activityType !== 'loe')
  const ids = new Set(work.map(a => a.id))
  const fileValues = fileHadResults
    ? new Map(work.map(a => [a.id, { earlyFinish: a.earlyFinish, totalFloat: Number.isFinite(a.totalFloat) ? a.totalFloat : null }]))
    : null
  const cpmActs: CpmActivity[] = work.map(a => ({
    id: a.id, code: a.activityId, name: a.name,
    duration: a.activityType === 'milestone' ? 0 : Math.max(0, Math.round(a.duration)),
    remaining: a.status === 'in_progress' ? Math.max(0, Math.round(a.remainingDuration)) : undefined,
    type: a.activityType === 'milestone' ? 'milestone' : 'task',
    milestoneKind: a.activityType === 'milestone' && a.milestoneKind ? a.milestoneKind : undefined,
    calendarId: a.calendarId || input.defaultCalendarId || cals[0].id,
    constraint: a.constraintType && CSTR.has(a.constraintType) && a.constraintDate ? { type: a.constraintType as ConstraintType, date: a.constraintDate } : undefined,
    actualStart: a.actualStart, actualFinish: a.actualFinish,
  }))
  let res: CpmResult
  try {
    res = runCpm({
      projectStart, dataDate: input.dataDate || projectStart, activities: cpmActs,
      links: relationships.filter(r => ids.has(r.predecessorId) && ids.has(r.successorId)).map(r => ({ from: r.predecessorId, to: r.successorId, type: r.type, lag: r.lag })),
      calendars: cals, defaultCalendarId: input.defaultCalendarId || cals[0].id,
      mustFinishBy: input.mustFinishBy || undefined, progressMode: input.progressMode ?? 'retained',
    })
  } catch {
    return { activities, projectStart: input.projectStart || earliest, projectFinish: input.projectFinish || latest, hasLogic, cpm: null, fileValues: null, note: 'Planora could not recalculate this schedule; dates are shown as listed in the file.' }
  }
  let filled = 0
  for (const a of work) {
    const t = res.times[a.id]
    if (!t) continue
    a.earlyStart = t.earlyStart
    a.earlyFinish = t.earlyFinish
    a.lateStart = t.lateStart
    a.lateFinish = t.lateFinish
    a.totalFloat = t.totalFloat
    a.freeFloat = t.freeFloat
    a.isCritical = t.critical && a.status !== 'complete'
    filled++
  }
  const mode = res.progressMode === 'retained' ? 'retained logic' : 'progress override'
  const note = fileHadResults
    ? `Planora recalculated all ${filled} activities from their durations, logic, calendars and constraints (${mode}) instead of using the dates and float stored in the file; differences from the file are listed in the analysis.`
    : `The file did not include calculated dates or float, so Planora scheduled ${filled} activities from their durations, logic and calendars (${mode}; critical path and float are Planora's calculation).`
  return { activities, projectStart, projectFinish: res.logicFinish, hasLogic, cpm: res, fileValues, note }
}
