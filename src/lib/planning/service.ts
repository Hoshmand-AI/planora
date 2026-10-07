import { getOrgHistory, type Activity, type Relationship, type Schedule } from '@/lib/db'
import { applyBaseline, baselineFromUpload, resolveBaseline, type ResolvedBaseline } from '@/lib/analysis/baseline'
import { orderSeries } from '@/lib/analysis/compare'
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

type SeriesMember = { id: string; version: string; dataDate: string | null; baselineScheduleId?: string | null }

/**
 * The series' Baseline upload for `current` (never `current` itself, never dated after it): the
 * earlier upload the scheduler designated (PATCH /api/schedules { baselineScheduleId }), else the
 * upload labelled Baseline. The upload labelled Baseline has none unless one was designated.
 */
export function pickSeriesBaseline(current: SeriesMember, series: Schedule[]): Schedule | null {
  const notLater = (s: Schedule) => s.id !== current.id && (!s.dataDate || !current.dataDate || s.dataDate <= current.dataDate)
  if (current.baselineScheduleId) {
    const chosen = series.find(s => s.id === current.baselineScheduleId && notLater(s))
    if (chosen) return chosen
  }
  if (isBaselineVersion(current.version)) return null
  return series.find(s => notLater(s) && isBaselineVersion(s.version)) ?? null
}

/**
 * Pure: the series' Baseline upload for `current` (see pickSeriesBaseline) resolved to per-activity
 * baseline dates (baselineFromUpload), with the header every report prints.
 */
export function seriesBaselineFrom(
  current: SeriesMember,
  series: Schedule[],
  activitiesOf: (scheduleId: string) => Activity[],
): ResolvedBaseline | null {
  const base = pickSeriesBaseline(current, series)
  if (!base) return null
  const ordered = orderSeries(series)
  const idx = ordered.findIndex(s => s.id === base.id)
  return baselineFromUpload(base, activitiesOf(base.id), { seriesIndex: idx >= 0 ? idx : null, designated: !!current.baselineScheduleId && current.baselineScheduleId === base.id })
}

/** Loads the series' Baseline upload (firm-scoped) for an upload; null when there is none. */
export async function loadSeriesBaseline(orgId: string, current: SeriesMember & { projectKey?: string | null }): Promise<ResolvedBaseline | null> {
  if (!current.projectKey) return null
  const { getScheduleSeries, getActivities } = await import('@/lib/db')
  const series = await getScheduleSeries(orgId, current.projectKey)
  const base = pickSeriesBaseline(current, series)
  if (!base) return null
  const acts = await getActivities(base.id)
  return seriesBaselineFrom(current, series, id => (id === base.id ? acts : []))
}

/**
 * Load a firm's schedule with activities and logic, filling in dates/float Planora had to calculate
 * for files that arrived without them (older uploads are corrected on read). Edits made in Planora
 * (schedule_edits, an override layer) are applied to the imported network before the recalculation,
 * so every view, export and analysis works on the edited schedule; `edits` lists them.
 */
export async function loadScheduleData(id: string, orgId: string) {
  const { getScheduleById, getActivities, getRelationships, getScheduleEdits } = await import('@/lib/db')
  const { completeSchedule } = await import('./complete-schedule')
  const { applyScheduleEdits } = await import('./uploaded-edits')
  const schedule = await getScheduleById(id, orgId)
  if (!schedule) return null
  const [importedActivities, importedRelationships, seriesBaseline, storedEdits] = await Promise.all([
    getActivities(id), getRelationships(id), loadSeriesBaseline(orgId, schedule).catch(() => null),
    schedule.sourceType === 'generated' ? Promise.resolve([]) : getScheduleEdits(id, orgId).catch(() => []),
  ])
  const activeEdits = storedEdits.filter(e => !e.revertedAt)
  const edited = applyScheduleEdits(importedActivities, importedRelationships, activeEdits)
  const rawActivities = activeEdits.length ? edited.activities : importedActivities
  // The one baseline every view, report, DCMA check and trend measures against (baseline.ts).
  const baseline = resolveBaseline({ activities: rawActivities, seriesBaseline, meta: schedule.baselineMeta ?? null })
  const relationships = activeEdits.length ? edited.relationships : importedRelationships
  const prior = schedule.analysis ?? null
  // Older uploads stored the file's header finish as projectFinish; keep it as the reported finish.
  const reportedFinish = prior ? prior.reportedFinish : schedule.projectFinish
  const done = completeSchedule({
    activities: rawActivities, relationships, calendars: schedule.calendars, defaultCalendarId: schedule.defaultCalendarId,
    projectStart: schedule.projectStart, projectFinish: reportedFinish, dataDate: schedule.dataDate,
    mustFinishBy: prior?.mustFinishBy ?? null, progressMode: prior?.progressMode ?? 'retained',
  })
  const { analyzeSchedule } = await import('@/lib/analysis/schedule-analysis')
  // Activities with the resolved baseline's dates (the file's own targets stay in fileActivities for exports).
  const fileActivities = done.activities
  const activities = applyBaseline(fileActivities, baseline)
  const analysis = analyzeSchedule({
    activities, links: relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm,
    reportedFinish, mustFinishBy: prior?.mustFinishBy ?? null, fileValues: done.fileValues ?? null, today: new Date().toISOString().slice(0, 10),
    dataDate: schedule.dataDate, finishMilestoneId: schedule.finishMilestoneId ?? null, baseline,
    calendars: schedule.calendars, defaultCalendarId: schedule.defaultCalendarId, fileProgressMode: prior?.fileProgressMode ?? null,
  })
  // After the first upload the stored dates are Planora's own recalculation, so a fresh comparison
  // would compare Planora with itself; the upload-time comparison with the file stays authoritative.
  if (prior) analysis.recalc = prior.recalc ?? analysis.recalc
  const criticalCount = activities.filter(a => a.isCritical).length
  if (!prior || prior.forecastFinish !== analysis.forecastFinish || prior.varianceDays !== analysis.varianceDays || prior.status !== analysis.status
    || prior.finishMilestone?.code !== analysis.finishMilestone?.code || prior.varianceBasis !== analysis.varianceBasis || (prior.statusReasons ?? []).join('\n') !== analysis.statusReasons.join('\n')
    || prior.baseline?.header !== analysis.baseline?.header) {
    const { updateScheduleAnalysis } = await import('@/lib/db')
    await updateScheduleAnalysis(schedule.id, orgId, { analysis, projectFinish: analysis.forecastFinish, varianceDays: analysis.varianceDays, criticalCount }).catch(() => {})
  }
  const warnings = importNotes(schedule.warnings, done.note, !!prior, analysis.recalc)
  // Location and size for the overview: from the plan interview when this schedule was built in Planora.
  let extra: { city?: string | null; state?: string | null; sqft?: number | null; type?: string | null; valueMusd?: number | null } = {}
  if (schedule.planId) {
    const { getPlan } = await import('@/lib/db')
    const plan = await getPlan(schedule.planId, orgId)
    const v = (k: string) => (plan?.answers[k]?.status === 'known' ? plan.answers[k].value : undefined)
    extra = { city: (v('project.city') as string) ?? null, state: (v('project.state') as string) ?? null, sqft: (v('project.gross_sqft') as number) ?? null, type: (v('project.type') as string) ?? null, valueMusd: Number(v('project.value_musd')) || null }
  }
  const { projectBrief } = await import('@/lib/analysis/brief')
  const completedSchedule = { ...schedule, projectStart: done.projectStart, projectFinish: analysis.forecastFinish, varianceDays: analysis.varianceDays, criticalCount, warnings, analysis }
  return {
    brief: projectBrief(completedSchedule, activities, extra),
    schedule: completedSchedule,
    /** Activities with baseline dates from the resolved baseline (every analysis surface uses these) */
    activities,
    /** The same activities with the file's own baseline (P6 target) dates, for exports of the file */
    fileActivities,
    /** The baseline every surface measures against, with its per-activity dates */
    baseline,
    relationships,
    hasLogic: done.hasLogic,
    analysis,
    cpm: done.cpm,
    /** Active edits made in Planora, in order, as applied (with before/after) */
    edits: edited.applied,
    /** Reverted edits, kept for the record */
    revertedEdits: storedEdits.filter(e => e.revertedAt),
    editedActivityIds: edited.editedActivityIds,
  }
}

/** The (edited) network of loaded schedule data, for what-if recalculation. */
export function networkOf(data: NonNullable<Awaited<ReturnType<typeof loadScheduleData>>>) {
  return {
    activities: data.activities, relationships: data.relationships, calendars: data.schedule.calendars, defaultCalendarId: data.schedule.defaultCalendarId,
    projectStart: data.schedule.projectStart, dataDate: data.schedule.dataDate, mustFinishBy: data.analysis.mustFinishBy ?? null, progressMode: data.analysis.progressMode ?? 'retained',
  }
}

/**
 * The trend of a series is measured against ONE baseline: the one `anchorId`'s upload resolves to
 * (when that is a Baseline upload or an embedded P6 baseline). Every update on or after that
 * baseline's data date gets its per-activity baseline dates from it, so BEI and missed tasks in the
 * trend use the same baseline as the anchor's headline, tables and DCMA checks.
 */
export function remeasureSeries<T extends { schedule: { id: string; dataDate: string | null }; activities: Activity[]; baseline: ResolvedBaseline }>(updates: T[], anchorId: string): T[] {
  const anchor = updates.find(u => u.schedule.id === anchorId)?.baseline
  if (!anchor || (anchor.source !== 'baseline_upload' && anchor.source !== 'p6_embedded')) return updates
  return updates.map(u => {
    if (u.baseline.scheduleId === anchor.scheduleId && u.baseline.source === anchor.source && u.baseline.header === anchor.header) return u
    if (anchor.dataDate && u.schedule.dataDate && u.schedule.dataDate < anchor.dataDate) return u
    return { ...u, activities: applyBaseline(u.activities, anchor), baseline: anchor }
  })
}

/** Most updates a windows analysis loads (each is recalculated several times). */
export const MAX_WINDOW_UPDATES = 36

/**
 * The update series of `schedule` (same project key, org-scoped), ordered by data date, each loaded
 * and recalculated; capped at the latest MAX_WINDOW_UPDATES uploads. A schedule outside a series
 * returns just itself.
 */
export async function loadSeriesUpdates(orgId: string, schedule: { id: string; projectKey?: string | null }) {
  const { getScheduleSeries, getScheduleById } = await import('@/lib/db')
  const series = orderSeries(schedule.projectKey ? await getScheduleSeries(orgId, schedule.projectKey) : [await getScheduleById(schedule.id, orgId)].filter((s): s is Schedule => !!s))
  const truncated = series.length > MAX_WINDOW_UPDATES
  const picked = series.slice(-MAX_WINDOW_UPDATES)
  const loaded = []
  for (const s of picked) {
    const d = await loadScheduleData(s.id, orgId)
    if (d) loaded.push(d)
  }
  return { updates: remeasureSeries(loaded, schedule.id), truncated, total: series.length }
}
