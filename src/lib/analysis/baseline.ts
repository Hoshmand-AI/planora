// One baseline for every surface. The headline variance, the finish / contract milestone variance,
// every report table (activities, milestones, WBS roll-up, executive summary), DCMA #11 Missed Tasks
// and #14 BEI, the windows trend, the portfolio and the dashboard tile all measure against the
// baseline resolved here, per activity code, so a report never contradicts itself.
//
// Precedence:
//   (a) a Baseline upload of the update series: the one the scheduler designated
//       (PATCH /api/schedules { id, baselineScheduleId }), else the upload labelled "Baseline";
//       its forecast (or actual) dates per activity code are the baseline
//   (b) the P6 project baseline embedded in the uploaded XER (PROJECT.sum_base_proj_id, or a project
//       whose orig_proj_id points at the imported one): that project's TASK dates by task_code
//   (c) the file's own P6 target dates, only when most activities carry them and the schedule is not
//       an update whose targets merely equal the planned dates of its not-started work (P6 keeps the
//       planned dates of not-started work equal to their early dates, so they are not a baseline)
//   otherwise no baseline (variance, BEI and missed tasks are not measured).
// Dates in text are MM/DD/YYYY. Pure, so it is unit tested.

import type { Activity, Schedule } from '@/lib/db'
import { fmtDate, fmtDay } from '@/lib/format'

export type BaselineSource = 'baseline_upload' | 'p6_embedded' | 'file' | 'none'

/** The P6 project baseline carried in the same XER as the imported project (by task_code). */
export interface EmbeddedBaseline {
  projectId: string
  name: string
  dataDate: string | null
  starts: Record<string, string>
  finishes: Record<string, string>
}

/** Whether the file's own P6 target dates may serve as the baseline (decided at import, on the file's own dates). */
export interface FileTargetsAssessment {
  usable: boolean
  withTargets: number
  work: number
  /** Not-started activities whose target dates equal their planned (early) dates, of those compared */
  plannedEqual?: number
  compared?: number
  reason: string | null
}

/** Stored per upload (schedules.baseline_meta, migration 11). */
export interface BaselineMeta {
  embedded?: EmbeddedBaseline | null
  fileTargets?: FileTargetsAssessment | null
}

export interface ResolvedBaseline {
  source: BaselineSource
  /** The Baseline upload (source baseline_upload) */
  scheduleId: string | null
  label: string | null
  dataDate: string | null
  uploadedAt: string | null
  /** 0-based position of the Baseline upload in the series (by data date) */
  seriesIndex: number | null
  /** True when the scheduler chose this upload (rather than the upload labelled Baseline) */
  designated: boolean
  /** activity code -> baseline start / finish */
  starts: Record<string, string>
  finishes: Record<string, string>
  /** "Baseline: Update 0 'Baseline' uploaded MM/DD/YYYY" — printed in every report header */
  header: string
  /** Why there is no usable baseline, or a qualification of the one used */
  note: string | null
}

/** The resolved baseline without its per-activity dates (kept in the stored analysis). */
export type BaselineSummary = Omit<ResolvedBaseline, 'starts' | 'finishes'>

const isWork = (a: Pick<Activity, 'activityType'>) => a.activityType !== 'summary' && a.activityType !== 'loe'
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null)

export function summarizeBaseline(b: ResolvedBaseline): BaselineSummary {
  const { starts: _s, finishes: _f, ...rest } = b
  return rest
}

function uploadHeader(label: string, seriesIndex: number | null, uploadedAt: string | null, dataDate: string | null, designated: boolean): string {
  const name = seriesIndex == null ? `'${label}'` : `Update ${seriesIndex}${label.trim().toLowerCase() === `update ${seriesIndex}` ? '' : ` '${label}'`}`
  return `Baseline: ${name}${uploadedAt ? ` uploaded ${fmtDay(String(uploadedAt))}` : ''}${dataDate ? ` (data date ${fmtDate(dataDate)})` : ''}${designated ? ', designated by the scheduler' : ''}`
}

/**
 * The Baseline upload's dates per activity code: its forecast, or actual where the work was already
 * done. Its stored finish milestone forecast (logic-driven, unaffected by a mandatory constraint)
 * replaces the early finish of that milestone, as the headline variance has always done.
 */
export function baselineFromUpload(
  base: Pick<Schedule, 'id' | 'version' | 'dataDate' | 'uploadedAt'> & { analysis?: Schedule['analysis'] },
  activities: Activity[],
  opts: { seriesIndex?: number | null; designated?: boolean } = {},
): ResolvedBaseline | null {
  const starts: Record<string, string> = {}
  const finishes: Record<string, string> = {}
  for (const a of activities) {
    if (!isWork(a) || !a.activityId) continue
    const s = a.actualStart || a.earlyStart
    const f = a.actualFinish || a.earlyFinish
    if (s) starts[a.activityId] = day(s)!
    if (f) finishes[a.activityId] = day(f)!
  }
  const bfm = base.analysis?.finishMilestone
  if (bfm?.code && bfm.forecastFinish && bfm.code in finishes) finishes[bfm.code] = day(bfm.forecastFinish)!
  if (!Object.keys(finishes).length) return null
  const seriesIndex = opts.seriesIndex ?? null
  const designated = !!opts.designated
  return {
    source: 'baseline_upload', scheduleId: base.id, label: base.version, dataDate: base.dataDate, uploadedAt: base.uploadedAt ? String(base.uploadedAt) : null,
    seriesIndex, designated, starts, finishes, header: uploadHeader(base.version, seriesIndex, base.uploadedAt ? String(base.uploadedAt) : null, base.dataDate, designated), note: null,
  }
}

export function baselineFromEmbedded(e: EmbeddedBaseline): ResolvedBaseline | null {
  if (!e || !Object.keys(e.finishes || {}).length) return null
  return {
    source: 'p6_embedded', scheduleId: null, label: e.name, dataDate: e.dataDate, uploadedAt: null, seriesIndex: null, designated: false,
    starts: { ...e.starts }, finishes: { ...e.finishes },
    header: `Baseline: P6 project baseline "${e.name}" embedded in the uploaded XER${e.dataDate ? ` (data date ${fmtDate(e.dataDate)})` : ''}`, note: null,
  }
}

/**
 * Whether the file's own P6 target dates describe a baseline. `early` gives the file's own planned
 * (early) dates per activity id when they differ from the activity's (stored dates are Planora's
 * recalculation after import); without it the activity's early dates are used.
 */
export function assessFileTargets(activities: Activity[], early?: Map<string, { earlyStart: string | null; earlyFinish: string | null }> | null): FileTargetsAssessment {
  const work = activities.filter(isWork)
  const withT = work.filter(a => a.baselineFinish)
  if (!withT.length) return { usable: false, withTargets: 0, work: work.length, reason: 'The file has no baseline (P6 target) dates.' }
  if (withT.length < work.length * 0.8) {
    return { usable: false, withTargets: withT.length, work: work.length, reason: `Only ${withT.length} of ${work.length} activities carry P6 target dates, so they are not used as a baseline.` }
  }
  const started = work.some(a => a.actualStart || a.actualFinish || a.status !== 'not_started')
  if (started) {
    const notStarted = withT.filter(a => a.status === 'not_started' && !a.actualStart && !a.actualFinish)
    const cmp = notStarted.map(a => ({ a, e: early?.get(a.id) ?? { earlyStart: a.earlyStart, earlyFinish: a.earlyFinish } })).filter(x => x.e.earlyFinish)
    const equal = cmp.filter(x => day(x.a.baselineFinish) === day(x.e.earlyFinish) && (!x.a.baselineStart || !x.e.earlyStart || day(x.a.baselineStart) === day(x.e.earlyStart)))
    if (cmp.length >= 3 && equal.length >= cmp.length * 0.9) {
      return {
        usable: false, withTargets: withT.length, work: work.length, plannedEqual: equal.length, compared: cmp.length,
        reason: `This is an update whose P6 target dates equal the planned dates of its not-started work (${equal.length} of ${cmp.length}), so they are planned dates, not a baseline. Mark an upload of this project as Baseline, or export the P6 project baseline with the update.`,
      }
    }
    return { usable: true, withTargets: withT.length, work: work.length, plannedEqual: equal.length, compared: cmp.length, reason: null }
  }
  return { usable: true, withTargets: withT.length, work: work.length, reason: null }
}

/** Resolve the baseline by precedence: series Baseline upload, embedded P6 baseline, the file's targets, none. */
export function resolveBaseline(input: {
  activities: Activity[]
  seriesBaseline?: ResolvedBaseline | null
  meta?: BaselineMeta | null
}): ResolvedBaseline {
  if (input.seriesBaseline) return input.seriesBaseline
  const emb = input.meta?.embedded ? baselineFromEmbedded(input.meta.embedded) : null
  if (emb) return emb
  const ft = input.meta?.fileTargets ?? assessFileTargets(input.activities)
  const empty = { scheduleId: null, label: null, dataDate: null, uploadedAt: null, seriesIndex: null, designated: false, starts: {}, finishes: {} }
  if (ft.usable) return { ...empty, source: 'file', header: "Baseline: the file's own P6 target dates", note: null }
  return { ...empty, source: 'none', header: `Baseline: none. ${ft.reason ?? 'The file has no usable baseline.'}`, note: ft.reason }
}

/**
 * The activities with their baseline start / finish taken from the resolved baseline (by activity
 * code). An activity added after the baseline has none. 'file' leaves the file's targets in place;
 * 'none' clears them so no surface measures against planned dates. Idempotent.
 */
export function applyBaseline<T extends Pick<Activity, 'activityId' | 'activityType' | 'baselineStart' | 'baselineFinish'>>(activities: T[], b: Pick<ResolvedBaseline, 'source' | 'starts' | 'finishes'> | null | undefined): T[] {
  if (!b || b.source === 'file') return activities
  if (b.source === 'none') return activities.map(a => (a.baselineStart || a.baselineFinish ? { ...a, baselineStart: null, baselineFinish: null } : a))
  return activities.map(a => {
    const s = isWork(a) ? b.starts[a.activityId] ?? null : null
    const f = isWork(a) ? b.finishes[a.activityId] ?? null : null
    return s === a.baselineStart && f === a.baselineFinish ? a : { ...a, baselineStart: s, baselineFinish: f }
  })
}
