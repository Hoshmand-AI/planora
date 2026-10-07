import { getOrgHistory, type Activity, type Relationship, type Schedule } from '@/lib/db'
import type { ScheduleAnalysis, SeriesBaseline } from '@/lib/analysis/schedule-analysis'
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
export { contractTarget, FINISH_DATE_CONSTRAINTS, trackedMilestones, type ContractTarget } from './contract-target'
import { contractTarget } from './contract-target'

/**
 * Which network an output is built on. 'submitted' (the default everywhere) is the schedule exactly as
 * the contractor submitted it, recalculated by Planora; 'scenario' applies the edits made in Planora
 * (schedule_edits, an override layer) as a named what-if scenario. Status, variance, the portfolio
 * and the stored headline are always as submitted.
 */
export type ScheduleBasis = 'submitted' | 'scenario'

/** The basis a request asks for: ?basis=scenario (or scenario=1); anything else is as submitted. */
export function basisFrom(params: URLSearchParams | Record<string, unknown> | null | undefined): ScheduleBasis {
  if (!params) return 'submitted'
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : params[k])
  const b = get('basis'), sc = get('scenario')
  return b === 'scenario' || sc === '1' || sc === 'true' || sc === true ? 'scenario' : 'submitted'
}

/** The basis in words, for report headers and XLSX provenance: "as submitted" | "with N Planora edits". */
export function basisLabel(basis: ScheduleBasis, editsApplied: number): string {
  return basis === 'scenario' && editsApplied > 0 ? `with ${editsApplied} Planora edit${editsApplied === 1 ? '' : 's'}` : 'as submitted'
}

/** What a reader must know about the basis (edits exist), else null. */
export function basisWarning(basis: ScheduleBasis, editsApplied: number, who = 'this schedule'): string | null {
  if (!editsApplied) return null
  const n = `${editsApplied} Planora edit${editsApplied === 1 ? '' : 's'}`
  return basis === 'scenario'
    ? `Basis: ${who} with ${n} applied (a what-if scenario). These figures are not the schedule as submitted.`
    : `Basis: ${who} as submitted. ${n} ${editsApplied === 1 ? 'is' : 'are'} not applied; choose "With Planora edits" (basis=scenario) to see the scenario.`
}

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
 * By default the network is the schedule AS SUBMITTED. With { basis: 'scenario' } the edits made in
 * Planora (schedule_edits, an override layer) are applied before the recalculation, as a named what-if
 * scenario. Either way `edits` lists the active edits (as they apply to the imported network) so the
 * UI can offer the scenario; only the as-submitted analysis is stored as the schedule's headline.
 */
export async function loadScheduleData(id: string, orgId: string, opts: { basis?: ScheduleBasis } = {}) {
  const basis: ScheduleBasis = opts.basis === 'scenario' ? 'scenario' : 'submitted'
  const { getScheduleById, getActivities, getRelationships, getScheduleEdits } = await import('@/lib/db')
  const { completeSchedule } = await import('./complete-schedule')
  const { applyScheduleEdits } = await import('./uploaded-edits')
  const schedule = await getScheduleById(id, orgId)
  if (!schedule) return null
  // The commercial cloud does not process a schedule marked classified (marked before this rule, or
  // through a path that skipped it): every view, analysis and export is refused with 409.
  if (schedule.classification === 'classified') {
    const [{ classifiedCloudRefusal, CLASSIFIED_CLOUD_CODE }, { deploymentKind }, { ApiError }] = await Promise.all([import('@/lib/server/classification'), import('@/lib/llm/provider'), import('@/lib/server/api')])
    const refusal = classifiedCloudRefusal('classified', deploymentKind())
    if (refusal) throw new ApiError(409, refusal, CLASSIFIED_CLOUD_CODE)
  }
  const [importedActivities, importedRelationships, seriesBaseline, storedEdits] = await Promise.all([
    getActivities(id), getRelationships(id), loadSeriesBaseline(orgId, schedule).catch(() => null),
    schedule.sourceType === 'generated' ? Promise.resolve([]) : getScheduleEdits(id, orgId).catch(() => []),
  ])
  const activeEdits = storedEdits.filter(e => !e.revertedAt)
  const edited = applyScheduleEdits(importedActivities, importedRelationships, activeEdits)
  const editsApplied = edited.applied.filter(e => e.status === 'applied').length
  const useEdits = basis === 'scenario' && activeEdits.length > 0
  const rawActivities = useEdits ? edited.activities : importedActivities
  const relationships = useEdits ? edited.relationships : importedRelationships
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
    calendars: schedule.calendars, defaultCalendarId: schedule.defaultCalendarId, fileProgressMode: prior?.fileProgressMode ?? null,
  })
  // After the first upload the stored dates are Planora's own recalculation, so a fresh comparison
  // would compare Planora with itself; the upload-time comparison with the file stays authoritative.
  if (prior) analysis.recalc = prior.recalc ?? analysis.recalc
  const criticalCount = done.activities.filter(a => a.isCritical).length
  // Only the as-submitted analysis is the schedule's stored headline (lists, portfolio, dashboard status).
  if (basis === 'submitted' && (!prior || prior.forecastFinish !== analysis.forecastFinish || prior.varianceDays !== analysis.varianceDays || prior.status !== analysis.status
    || prior.finishMilestone?.code !== analysis.finishMilestone?.code || prior.varianceBasis !== analysis.varianceBasis || (prior.statusReasons ?? []).join('\n') !== analysis.statusReasons.join('\n'))) {
    const { updateScheduleAnalysis } = await import('@/lib/db')
    await updateScheduleAnalysis(schedule.id, orgId, { analysis, projectFinish: analysis.forecastFinish, varianceDays: analysis.varianceDays, criticalCount }).catch(() => {})
  }
  const warnings = importNotes(schedule.warnings, done.note, !!prior, analysis.recalc)
  const bw = basisWarning(basis, editsApplied)
  if (bw) warnings.unshift(bw)
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
    brief: projectBrief(completedSchedule, done.activities, extra),
    schedule: completedSchedule,
    activities: done.activities,
    relationships,
    hasLogic: done.hasLogic,
    analysis,
    cpm: done.cpm,
    /** 'submitted' (the file as submitted) or 'scenario' (with the Planora edits applied) */
    basis,
    /** Forecast finish of the schedule as submitted (the stored headline when the scenario was loaded) */
    submittedForecastFinish: basis === 'submitted' ? analysis.forecastFinish : prior?.forecastFinish ?? null,
    /** Edits that apply to the imported network: the scenario's size, whichever basis was loaded */
    editsApplied,
    /** Active edits made in Planora, in order, as they apply to the imported network (with before/after) */
    edits: edited.applied,
    /** Reverted edits, kept for the record */
    revertedEdits: storedEdits.filter(e => e.revertedAt),
    /** Activities the loaded network has edited (empty as submitted) */
    editedActivityIds: useEdits ? edited.editedActivityIds : [],
    /** Activities the scenario edits, whichever basis was loaded */
    scenarioActivityIds: edited.editedActivityIds,
  }
}

/** The network of loaded schedule data (as loaded: submitted or scenario) and its contract target, for what-if recalculation. */
export function networkOf(data: NonNullable<Awaited<ReturnType<typeof loadScheduleData>>>) {
  return {
    activities: data.activities, relationships: data.relationships, calendars: data.schedule.calendars, defaultCalendarId: data.schedule.defaultCalendarId,
    projectStart: data.schedule.projectStart, dataDate: data.schedule.dataDate, mustFinishBy: data.analysis.mustFinishBy ?? null, progressMode: data.analysis.progressMode ?? 'retained',
    contract: contractTarget(data.analysis),
  }
}

/** Most updates a windows analysis loads (each is recalculated several times). */
export const MAX_WINDOW_UPDATES = 36

/**
 * The update series of `schedule` (same project key, org-scoped), ordered by data date, each loaded
 * and recalculated; capped at the latest MAX_WINDOW_UPDATES uploads. A schedule outside a series
 * returns just itself.
 */
export async function loadSeriesUpdates(orgId: string, schedule: { id: string; projectKey?: string | null }, opts: { basis?: ScheduleBasis } = {}) {
  const { getScheduleSeries, getScheduleById } = await import('@/lib/db')
  const { orderSeries } = await import('@/lib/analysis/compare')
  const series = orderSeries(schedule.projectKey ? await getScheduleSeries(orgId, schedule.projectKey) : [await getScheduleById(schedule.id, orgId)].filter((s): s is Schedule => !!s))
  const truncated = series.length > MAX_WINDOW_UPDATES
  const picked = series.slice(-MAX_WINDOW_UPDATES)
  const loaded = []
  for (const s of picked) {
    const d = await loadScheduleData(s.id, orgId, opts)
    if (d) loaded.push(d)
  }
  return { updates: loaded, truncated, total: series.length }
}
