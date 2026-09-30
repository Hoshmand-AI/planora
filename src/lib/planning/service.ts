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

/**
 * Load a firm's schedule with activities and logic, filling in dates/float Planora had to calculate
 * for files that arrived without them (older uploads are corrected on read).
 */
export async function loadScheduleData(id: string, orgId: string) {
  const { getScheduleById, getActivities, getRelationships } = await import('@/lib/db')
  const { completeSchedule } = await import('./complete-schedule')
  const schedule = await getScheduleById(id, orgId)
  if (!schedule) return null
  const [rawActivities, relationships] = await Promise.all([getActivities(id), getRelationships(id)])
  const done = completeSchedule({
    activities: rawActivities, relationships, calendars: schedule.calendars, defaultCalendarId: schedule.defaultCalendarId,
    projectStart: schedule.projectStart, projectFinish: schedule.projectFinish, dataDate: schedule.dataDate,
  })
  const warnings = done.note && !schedule.warnings.includes(done.note) ? [done.note, ...schedule.warnings] : schedule.warnings
  // Location and size for the overview: from the plan interview when this schedule was built in Planora.
  let extra: { city?: string | null; state?: string | null; sqft?: number | null; type?: string | null } = {}
  if (schedule.planId) {
    const { getPlan } = await import('@/lib/db')
    const plan = await getPlan(schedule.planId, orgId)
    const v = (k: string) => (plan?.answers[k]?.status === 'known' ? plan.answers[k].value : undefined)
    extra = { city: (v('project.city') as string) ?? null, state: (v('project.state') as string) ?? null, sqft: (v('project.gross_sqft') as number) ?? null, type: (v('project.type') as string) ?? null }
  }
  const { projectBrief } = await import('@/lib/analysis/brief')
  const completedSchedule = { ...schedule, projectStart: done.projectStart, projectFinish: done.projectFinish, criticalCount: done.activities.filter(a => a.isCritical).length, warnings }
  return {
    brief: projectBrief(completedSchedule, done.activities, extra),
    schedule: completedSchedule,
    activities: done.activities,
    relationships,
    hasLogic: done.hasLogic,
  }
}
