import { getOrgHistory, type Activity, type Relationship, type Schedule } from '@/lib/db'
import type { SeriesBaseline } from '@/lib/analysis/schedule-analysis'
import { computeFirmHistory, type FirmHistory } from './history'
import { importNotes } from '@/lib/analysis/recalc-warning'
import { CONSTRAINT_TYPES, type AnalyzableSchedule, type ConstraintType, type ProjectType } from './types'

/** Firm history for grounding. Reads ONLY the caller's organization. */
export async function loadFirmHistory(orgId: string, projectType?: ProjectType): Promise<FirmHistory | null> {
  const { rows, calendars } = await getOrgHistory(orgId)
  if (!rows.length) return null
  const h = computeFirmHistory(rows, calendars, projectType)
  return Object.keys(h.byCategory).length ? h : { ...h, byCategory: {} }
}

const CONSTRAINTS: readonly string[] = CONSTRAINT_TYPES

/**
 * @param resourceCounts resource assignments per source id (P6 task_id) when the source file carries
 *   them (XER TASKRSRC); lets DCMA #10 assess resource loading instead of reporting "no resource data".
 */
export function analyzableFromDb(s: Schedule, activities: Activity[], rels: Relationship[], resourceCounts?: Record<string, number> | null): AnalyzableSchedule {
  return {
    dataDate: s.dataDate,
    projectStart: s.projectStart,
    projectFinish: s.projectFinish,
    mustFinishBy: s.analysis?.mustFinishBy ?? null,
    finishMilestoneId: s.finishMilestoneId ?? null,
    calendars: s.calendars || [],
    defaultCalendarId: s.defaultCalendarId,
    links: rels.map(r => ({ from: r.predecessorId, to: r.successorId, type: r.type, lag: r.lag })),
    activities: activities.map(a => ({
      id: a.id, code: a.activityId, name: a.name, type: a.activityType, duration: a.duration, remaining: a.remainingDuration,
      percentComplete: a.percentComplete, status: a.status, calendarId: a.calendarId ?? null,
      earlyStart: a.earlyStart, earlyFinish: a.earlyFinish, lateStart: a.lateStart, lateFinish: a.lateFinish,
      actualStart: a.actualStart, actualFinish: a.actualFinish, baselineStart: a.baselineStart, baselineFinish: a.baselineFinish,
      totalFloat: a.totalFloat, milestoneKind: a.milestoneKind ?? null,
      constraint: a.constraintType && CONSTRAINTS.includes(a.constraintType) ? { type: a.constraintType as ConstraintType, date: a.constraintDate } : null,
      ...(resourceCounts ? { resourceCount: (a.sourceId && resourceCounts[a.sourceId]) || 0 } : {}),
    })),
  }
}

/** An upload is "the Baseline" of its series when its version label says so (the first upload is labelled Baseline). */
export const isBaselineVersion = (version: string | null | undefined) => /^\s*baseline\s*$/i.test(version || '')

/** The series' upload marked Baseline (not `current` itself, and not dated after it). */
export function pickSeriesBaseline(current: { id: string; version: string; dataDate: string | null }, series: Schedule[]): Schedule | null {
  if (isBaselineVersion(current.version)) return null
  return series.find(s => s.id !== current.id && isBaselineVersion(s.version) && (!s.dataDate || !current.dataDate || s.dataDate <= current.dataDate)) ?? null
}

/**
 * Pure: pick the series' Baseline upload for `current` (another upload of the same project, marked
 * Baseline, with a data date no later than the current one) and its forecast finish per activity code.
 */
export function seriesBaselineFrom(
  current: { id: string; version: string; dataDate: string | null },
  series: Schedule[],
  activitiesOf: (scheduleId: string) => Activity[],
): SeriesBaseline | null {
  const base = pickSeriesBaseline(current, series)
  if (!base) return null
  const finishes: Record<string, string> = {}
  for (const a of activitiesOf(base.id)) {
    if (a.activityType === 'summary' || a.activityType === 'loe') continue
    const f = a.actualFinish || a.earlyFinish
    if (a.activityId && f) finishes[a.activityId] = f
  }
  // The Baseline's own analysis holds its logic-driven finish milestone forecast (a mandatory
  // constraint can pin the stored early finish).
  const bfm = base.analysis?.finishMilestone
  if (bfm?.code && bfm.forecastFinish) finishes[bfm.code] = bfm.forecastFinish
  return Object.keys(finishes).length ? { scheduleId: base.id, label: base.version, dataDate: base.dataDate, finishes } : null
}

/** Loads the series' Baseline upload (firm-scoped) for an update; null when there is none. */
export async function loadSeriesBaseline(orgId: string, current: { id: string; version: string; dataDate: string | null; projectKey?: string | null }): Promise<SeriesBaseline | null> {
  if (!current.projectKey || isBaselineVersion(current.version)) return null
  const { getScheduleSeries, getActivities } = await import('@/lib/db')
  const series = await getScheduleSeries(orgId, current.projectKey)
  const base = pickSeriesBaseline(current, series)
  if (!base) return null
  const acts = await getActivities(base.id)
  return seriesBaselineFrom(current, series, id => (id === base.id ? acts : []))
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
  const [rawActivities, relationships, seriesBaseline] = await Promise.all([
    getActivities(id), getRelationships(id), loadSeriesBaseline(orgId, schedule).catch(() => null),
  ])
  const prior = schedule.analysis ?? null
  // Older uploads stored the file's header finish as projectFinish; keep it as the reported finish.
  const reportedFinish = prior ? prior.reportedFinish : schedule.projectFinish
  const done = completeSchedule({
    activities: rawActivities, relationships, calendars: schedule.calendars, defaultCalendarId: schedule.defaultCalendarId,
    projectStart: schedule.projectStart, projectFinish: reportedFinish, dataDate: schedule.dataDate,
    mustFinishBy: prior?.mustFinishBy ?? null, progressMode: prior?.progressMode ?? 'retained',
  })
  const { analyzeSchedule } = await import('@/lib/analysis/schedule-analysis')
  const analysis = analyzeSchedule({
    activities: done.activities, links: relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm,
    reportedFinish, mustFinishBy: prior?.mustFinishBy ?? null, fileValues: done.fileValues ?? null, today: new Date().toISOString().slice(0, 10),
    dataDate: schedule.dataDate, finishMilestoneId: schedule.finishMilestoneId ?? null, seriesBaseline,
    calendars: schedule.calendars, defaultCalendarId: schedule.defaultCalendarId,
  })
  // After the first upload the stored dates are Planora's own recalculation, so a fresh comparison
  // would compare Planora with itself; the upload-time comparison with the file stays authoritative.
  if (prior) analysis.recalc = prior.recalc ?? analysis.recalc
  const criticalCount = done.activities.filter(a => a.isCritical).length
  if (!prior || prior.forecastFinish !== analysis.forecastFinish || prior.varianceDays !== analysis.varianceDays || prior.status !== analysis.status
    || prior.finishMilestone?.code !== analysis.finishMilestone?.code || prior.varianceBasis !== analysis.varianceBasis || (prior.statusReasons ?? []).join('\n') !== analysis.statusReasons.join('\n')) {
    const { updateScheduleAnalysis } = await import('@/lib/db')
    await updateScheduleAnalysis(schedule.id, orgId, { analysis, projectFinish: analysis.forecastFinish, varianceDays: analysis.varianceDays, criticalCount }).catch(() => {})
  }
  const warnings = importNotes(schedule.warnings, done.note, !!prior, analysis.recalc)
  // Location and size for the overview: from the plan interview when this schedule was built in Planora.
  let extra: { city?: string | null; state?: string | null; sqft?: number | null; type?: string | null } = {}
  if (schedule.planId) {
    const { getPlan } = await import('@/lib/db')
    const plan = await getPlan(schedule.planId, orgId)
    const v = (k: string) => (plan?.answers[k]?.status === 'known' ? plan.answers[k].value : undefined)
    extra = { city: (v('project.city') as string) ?? null, state: (v('project.state') as string) ?? null, sqft: (v('project.gross_sqft') as number) ?? null, type: (v('project.type') as string) ?? null }
  }
  const { projectBrief } = await import('@/lib/analysis/brief')
  const completedSchedule = { ...schedule, projectStart: done.projectStart, projectFinish: analysis.forecastFinish, varianceDays: analysis.varianceDays, criticalCount, warnings, analysis }
  return {
    brief: projectBrief(completedSchedule, done.activities, extra),
    schedule: completedSchedule,
    activities: done.activities,
    relationships,
    hasLogic: done.hasLogic,
    analysis,
    cpm: done.cpm,
  }
}
