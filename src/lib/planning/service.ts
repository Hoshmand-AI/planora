import { getOrgHistory, type Activity, type Relationship, type Schedule } from '@/lib/db'
import { computeFirmHistory, type FirmHistory } from './history'
import type { AnalyzableSchedule, ConstraintType, ProjectType } from './types'

/** Firm history for grounding. Reads ONLY the caller's organization. */
export async function loadFirmHistory(orgId: string, projectType?: ProjectType): Promise<FirmHistory | null> {
  const { rows, calendars } = await getOrgHistory(orgId)
  if (!rows.length) return null
  const h = computeFirmHistory(rows, calendars, projectType)
  return Object.keys(h.byCategory).length ? h : { ...h, byCategory: {} }
}

const CONSTRAINTS: string[] = ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']

export function analyzableFromDb(s: Schedule, activities: Activity[], rels: Relationship[]): AnalyzableSchedule {
  return {
    dataDate: s.dataDate,
    projectStart: s.projectStart,
    projectFinish: s.projectFinish,
    calendars: s.calendars || [],
    defaultCalendarId: s.defaultCalendarId,
    links: rels.map(r => ({ from: r.predecessorId, to: r.successorId, type: r.type, lag: r.lag })),
    activities: activities.map(a => ({
      id: a.id, code: a.activityId, name: a.name, type: a.activityType, duration: a.duration, remaining: a.remainingDuration,
      percentComplete: a.percentComplete, status: a.status, calendarId: a.calendarId ?? null,
      earlyStart: a.earlyStart, earlyFinish: a.earlyFinish, lateStart: a.lateStart, lateFinish: a.lateFinish,
      actualStart: a.actualStart, actualFinish: a.actualFinish, baselineStart: a.baselineStart, baselineFinish: a.baselineFinish,
      totalFloat: a.totalFloat,
      constraint: a.constraintType && CONSTRAINTS.includes(a.constraintType) ? { type: a.constraintType as ConstraintType, date: a.constraintDate } : null,
    })),
  }
}
