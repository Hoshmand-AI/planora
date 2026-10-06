// Planora's reading of an uploaded schedule: the numbers a dashboard, portfolio and report show
// first. Everything comes from the recalculated network, never from header dates in the file:
//   - forecast finish = the latest finish logic produces (a mandatory constraint can't hide a slip)
//   - variance = forecast vs baseline of the finish milestone (calendar days), with the basis stated;
//     in an update series, against the forecast in the upload marked Baseline
//   - status = from negative float, overruled constraints, variance, the required finish and
//     execution against the baseline (BEI / missed tasks)
// Dates in text are MM/DD/YYYY. Pure, so it is unit tested.

import type { Activity } from '@/lib/db'
import type { CpmResult, ProgressMode, WorkCalendar } from '@/lib/planning/types'
import { fmtDate } from '@/lib/format'
import { pickFinishCandidate } from '@/lib/analysis/finish-milestone'
import { baselineExecution, DEFAULT_DCMA_RULES } from '@/lib/analysis/dcma'

export type ScheduleStatus = 'on_track' | 'attention' | 'at_risk' | 'complete'

export interface FinishMilestone {
  id: string
  code: string
  name: string
  /** The date variance is measured against (see baselineSource) */
  baselineFinish: string | null
  /** Where baselineFinish comes from: the series' Baseline upload, or the file's own baseline (P6 target) dates */
  baselineSource?: 'baseline_upload' | 'file' | null
  forecastFinish: string | null
  constraint: { type: string; date: string } | null
  /** Calendar days forecast minus baseline (positive = late); null without a baseline */
  varianceDays: number | null
  /** True when the scheduler designated this milestone (PATCH /api/schedules finishMilestoneId) */
  designated?: boolean
}

export interface RecalcDifference { code: string; name: string; fileFinish: string | null; planoraFinish: string | null; fileFloat: number | null; planoraFloat: number | null }

/** The update series' upload marked "Baseline": its forecast finish per activity code */
export interface SeriesBaseline {
  scheduleId: string
  label: string
  dataDate: string | null
  /** activity code -> forecast (or actual) finish in that upload */
  finishes: Record<string, string>
}

export interface ScheduleAnalysis {
  version: 1
  progressMode: ProgressMode
  /** Latest finish the recalculated logic produces */
  forecastFinish: string | null
  /** Finish date written in the file header (P6 scheduled finish / MSP finish), for comparison only */
  reportedFinish: string | null
  /** Required finish the file imposes (P6 "Must Finish By"), used as the float anchor */
  mustFinishBy: string | null
  finishMilestone: FinishMilestone | null
  /** Calendar days the forecast is late (+) or early (-) against the baseline; null when unknown */
  varianceDays: number | null
  /** Plain-language statement of what the variance was measured against */
  varianceBasis: string
  /**
   * Lowest total float among open activities, in work days of THAT activity's own calendar (float is
   * never converted between calendars); minFloatAt names the activity and calendar.
   */
  minFloat: number | null
  minFloatAt?: { code: string; calendar: string } | null
  negativeFloatCount: number
  violations: CpmResult['violations']
  /** Activity ids of the longest (driving) path, start to finish */
  longestPath: string[]
  status: ScheduleStatus
  statusReasons: string[]
  /** How the file's own dates/float compare with Planora's recalculation (null when the file had none) */
  recalc: { compared: number; differing: number; samples: RecalcDifference[] } | null
}

const DAY = 86_400_000
const day = (d: string) => d.slice(0, 10)
const calDays = (from: string, to: string) => Math.round((Date.parse(day(to)) - Date.parse(day(from))) / DAY)
const isOpen = (a: Activity) => a.status !== 'complete' && !a.actualFinish
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'

/**
 * The contract completion milestone (rules in finish-milestone.ts): the designated one, else a
 * completion-named milestone (Substantial Completion first, even with successors such as a punch
 * list), else an end activity, preferring finish-constrained milestones. Interim milestones (dry-in,
 * topping out, NTP...) never beat a completion milestone.
 */
export function pickFinishMilestone(activities: Activity[], hasSuccessor: Set<string>, finishOf: (a: Activity) => string | null, designated?: string | null): Activity | null {
  return pickFinishCandidate(
    activities.filter(isWork).map(a => ({
      id: a.id, code: a.activityId, name: a.name, isMilestone: a.activityType === 'milestone', milestoneKind: a.milestoneKind ?? null,
      constraintType: a.constraintType ?? null, hasSuccessor: hasSuccessor.has(a.id), finish: finishOf(a), a,
    })),
    designated,
  )?.pick.a ?? null
}

export function analyzeSchedule(input: {
  activities: Activity[]
  /** predecessor -> successor pairs between activities in the list */
  links: { from: string; to: string }[]
  cpm: CpmResult | null
  reportedFinish: string | null
  mustFinishBy: string | null
  /** Snapshot of the file's own finish/float before recalculation, keyed by activity id */
  fileValues?: Map<string, { earlyFinish: string | null; totalFloat: number | null }> | null
  today?: string
  /** Data date (status date); enables the execution-against-baseline check (BEI / missed tasks) */
  dataDate?: string | null
  /** Contract milestone the scheduler designated (activity id or activity code) */
  finishMilestoneId?: string | null
  /** The series' Baseline upload, when this upload is a later update of the same project */
  seriesBaseline?: SeriesBaseline | null
  /** Used to name the calendar float is counted on */
  calendars?: WorkCalendar[]
  defaultCalendarId?: string | null
}): ScheduleAnalysis {
  const { activities, cpm } = input
  const work = activities.filter(isWork)
  const open = work.filter(isOpen)
  const hasSucc = new Set(input.links.map(l => l.from))
  const violationById = new Map((cpm?.violations ?? []).map(v => [v.id, v]))
  // Forecast per activity: what logic says, even where a mandatory constraint pins the displayed date.
  const forecastOf = (a: Activity): string | null => {
    if (!isOpen(a)) return a.actualFinish || a.earlyFinish
    const v = violationById.get(a.id)
    if (v && v.type === 'MFO') return v.logicDate
    return a.earlyFinish
  }
  const finishes = work.map(forecastOf).filter((d): d is string => !!d).sort()
  const forecastFinish = cpm?.logicFinish && finishes.length ? [cpm.logicFinish, finishes[finishes.length - 1]].sort()[1] : (finishes[finishes.length - 1] ?? null)

  const fm = pickFinishMilestone(work, hasSucc, forecastOf, input.finishMilestoneId)
  let finishMilestone: FinishMilestone | null = null
  if (fm) {
    const f = forecastOf(fm)
    const want = input.finishMilestoneId?.trim().toLowerCase()
    finishMilestone = {
      id: fm.id, code: fm.activityId, name: fm.name, baselineFinish: fm.baselineFinish, baselineSource: fm.baselineFinish ? 'file' : null, forecastFinish: f,
      constraint: fm.constraintType && fm.constraintDate ? { type: fm.constraintType, date: fm.constraintDate } : null,
      varianceDays: f && fm.baselineFinish ? calDays(fm.baselineFinish, f) : null,
      designated: !!want && (want === fm.id.toLowerCase() || want === fm.activityId.toLowerCase()),
    }
  }

  // Variance. In an update series with an upload marked Baseline, the finish milestone is measured
  // against that upload's forecast for the same activity code (P6 target dates move whenever the
  // project is re-baselined). Otherwise: the finish milestone against its own baseline; else the
  // project forecast against the latest baseline finish, but only when most activities carry a
  // baseline (a few baselined activities do not describe the project's baseline finish).
  let varianceDays: number | null = null
  let varianceBasis = 'The file has no baseline dates, so variance cannot be measured.'
  const baselined = work.filter(a => a.baselineFinish)
  const sb = input.seriesBaseline
  const sbFinish = sb && finishMilestone ? sb.finishes[finishMilestone.code] ?? null : null
  if (finishMilestone?.forecastFinish && sb && sbFinish) {
    finishMilestone.baselineFinish = sbFinish
    finishMilestone.baselineSource = 'baseline_upload'
    finishMilestone.varianceDays = calDays(sbFinish, finishMilestone.forecastFinish)
    varianceDays = finishMilestone.varianceDays
    varianceBasis = `${finishMilestone.code} ${finishMilestone.name}: forecast ${fmtDate(finishMilestone.forecastFinish)} vs ${fmtDate(sbFinish)} in the Baseline upload "${sb.label}"${sb.dataDate ? ` (data date ${fmtDate(sb.dataDate)})` : ''} (calendar days).`
  } else if (finishMilestone?.varianceDays != null) {
    varianceDays = finishMilestone.varianceDays
    varianceBasis = `${finishMilestone.code} ${finishMilestone.name}: forecast ${fmtDate(finishMilestone.forecastFinish)} vs baseline ${fmtDate(finishMilestone.baselineFinish)} (calendar days).`
  } else if (baselined.length && forecastFinish) {
    if (baselined.length >= work.length * 0.8) {
      const latest = baselined.map(a => a.baselineFinish!).sort().pop()!
      varianceDays = calDays(latest, forecastFinish)
      varianceBasis = `Project forecast finish ${fmtDate(forecastFinish)} vs the latest baseline finish ${fmtDate(latest)} (calendar days); the finish milestone has no baseline.`
    } else {
      varianceBasis = `Only ${baselined.length} of ${work.length} activities carry baseline dates, so a project variance would be misleading.`
    }
  }

  // An unstarted schedule (no actuals, no progress) cannot have slipped: its P6 target dates are
  // just planned dates (often copied from another version), so a difference from the recalculated
  // forecast is a planning difference, not a slip. Report it in the basis, never as variance.
  const started = work.some(a => a.actualStart || a.actualFinish || a.status !== 'not_started' || a.percentComplete > 0)
  if (!started && varianceDays != null && varianceDays !== 0 && finishMilestone?.baselineSource !== 'baseline_upload') {
    const diff = varianceDays
    varianceDays = null
    if (finishMilestone) finishMilestone.varianceDays = null
    varianceBasis = `No work has started${input.dataDate ? ` (data date ${fmtDate(input.dataDate)})` : ''}, so the file's baseline (target) dates are planned dates, not a statused baseline, and no slip is reported. ${varianceBasis.replace(/\.$/, '')}: ${Math.abs(diff)} calendar days ${diff > 0 ? 'later' : 'earlier'} by Planora's recalculation, a difference between the file's dates and its logic. Mark an upload of this project as Baseline to measure variance against it.`
  }

  // Float stays in work days of each activity's own calendar (P6 does the same): -10 on a 7-day
  // calendar is not -10 on a 5-day one, so the lowest value names its activity and calendar.
  const calName = (a: Activity) => {
    const id = a.calendarId || input.defaultCalendarId
    return (input.calendars ?? []).find(x => x.id === id)?.name ?? null
  }
  const withFloat = open.filter(a => Number.isFinite(a.totalFloat))
  const lowest = withFloat.length ? withFloat.reduce((m, a) => (a.totalFloat < m.totalFloat ? a : m)) : null
  const minFloat = lowest ? lowest.totalFloat : null
  const minFloatAt = lowest ? { code: lowest.activityId, calendar: calName(lowest) ?? 'own' } : null
  const negativeFloatCount = withFloat.filter(a => a.totalFloat < 0).length
  const violations = cpm?.violations ?? []

  const reasons: string[] = []
  let status: ScheduleStatus = 'on_track'
  const bump = (s: ScheduleStatus, why: string) => {
    reasons.push(why)
    if (s === 'at_risk' || (s === 'attention' && status === 'on_track')) status = s
  }
  if (!open.length) status = 'complete'
  else {
    if (negativeFloatCount > 0 && lowest) {
      const cal = calName(lowest)
      bump('at_risk', `${negativeFloatCount} open ${negativeFloatCount === 1 ? 'activity has' : 'activities have'} negative float (lowest ${minFloat} work days on ${lowest.activityId}, counted on ${cal ? `its "${cal}" calendar` : 'its own calendar'}).`)
    }
    if (violations.length) bump('at_risk', `${violations.length} mandatory constraint${violations.length === 1 ? ' overrules' : 's overrule'} logic (up to ${Math.max(...violations.map(v => v.days))} work days).`)
    if (varianceDays != null && varianceDays > 14) bump('at_risk', `Forecast finish is ${varianceDays} calendar days behind baseline.`)
    else if (varianceDays != null && varianceDays > 0) bump('attention', `Forecast finish is ${varianceDays} calendar day${varianceDays === 1 ? '' : 's'} behind baseline.`)
    // Required completion is compared with the contract (finish) milestone, so a required date equal
    // to Substantial Completion is met even when a punch list and Final Completion follow it.
    const completion = finishMilestone?.forecastFinish ?? forecastFinish
    if (input.mustFinishBy && completion && day(completion) > day(input.mustFinishBy)) {
      bump('at_risk', finishMilestone?.forecastFinish
        ? `${finishMilestone.code} ${finishMilestone.name} is forecast for ${fmtDate(completion)}, after the required finish ${fmtDate(input.mustFinishBy)}.`
        : `Forecast finish ${fmtDate(completion)} is after the required finish ${fmtDate(input.mustFinishBy)}.`)
    }
    if (input.today && forecastFinish && day(forecastFinish) < day(input.today)) bump('at_risk', `Forecast finish ${fmtDate(forecastFinish)} has already passed.`)
    // Execution against the baseline (DCMA #11 Missed Tasks / #14 BEI at the default thresholds).
    const ex = baselineExecution(
      work.map(a => ({ id: a.id, code: a.activityId, name: a.name, type: a.activityType, duration: a.duration, status: a.status, percentComplete: a.percentComplete, actualFinish: a.actualFinish, baselineStart: a.baselineStart, baselineFinish: a.baselineFinish })),
      input.dataDate ?? null,
    )
    if (ex) {
      const R = DEFAULT_DCMA_RULES
      if (ex.bei < R.indexTarget) bump('attention', `Baseline execution index is ${(Math.floor(ex.bei * 100) / 100).toFixed(2)}, below ${R.indexTarget.toFixed(2)}: ${ex.completed} activities complete against ${ex.due} baselined to finish by ${fmtDate(input.dataDate)}.`)
      if (ex.missed / ex.due > R.maxPct / 100) bump('attention', `${ex.missed} of ${ex.due} activities baselined to finish by ${fmtDate(input.dataDate)} finished late or not at all.`)
    }
  }

  let recalc: ScheduleAnalysis['recalc'] = null
  if (input.fileValues && input.fileValues.size) {
    const samples: RecalcDifference[] = []
    let compared = 0, differing = 0
    for (const a of open) {
      const f = input.fileValues.get(a.id)
      if (!f || (!f.earlyFinish && f.totalFloat == null)) continue
      compared++
      const finishOff = f.earlyFinish && a.earlyFinish ? Math.abs(calDays(f.earlyFinish, a.earlyFinish)) > 1 : false
      const floatOff = f.totalFloat != null ? Math.abs(f.totalFloat - a.totalFloat) > 1 : false
      if (finishOff || floatOff) {
        differing++
        if (samples.length < 10) samples.push({ code: a.activityId, name: a.name, fileFinish: f.earlyFinish, planoraFinish: a.earlyFinish, fileFloat: f.totalFloat, planoraFloat: a.totalFloat })
      }
    }
    recalc = { compared, differing, samples }
  }

  return {
    version: 1, progressMode: cpm?.progressMode ?? 'retained', forecastFinish, reportedFinish: input.reportedFinish, mustFinishBy: input.mustFinishBy,
    finishMilestone, varianceDays, varianceBasis, minFloat, minFloatAt, negativeFloatCount, violations, longestPath: cpm?.longestPath ?? [],
    status, statusReasons: reasons, recalc,
  }
}
