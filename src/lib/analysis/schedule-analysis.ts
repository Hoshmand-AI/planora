// Planora's reading of an uploaded schedule: the numbers a dashboard, portfolio and report show
// first. Everything comes from the recalculated network, never from header dates in the file:
//   - forecast finish = the latest finish logic produces (a mandatory constraint can't hide a slip)
//   - variance = forecast vs baseline of the finish milestone (calendar days), with the basis stated
//   - status = from negative float, overruled constraints, variance and the required finish
// Pure, so it is unit tested.

import type { Activity } from '@/lib/db'
import type { CpmResult, ProgressMode } from '@/lib/planning/types'

export type ScheduleStatus = 'on_track' | 'attention' | 'at_risk' | 'complete'

export interface FinishMilestone {
  id: string
  code: string
  name: string
  baselineFinish: string | null
  forecastFinish: string | null
  constraint: { type: string; date: string } | null
  /** Calendar days forecast minus baseline (positive = late); null without a baseline */
  varianceDays: number | null
}

export interface RecalcDifference { code: string; name: string; fileFinish: string | null; planoraFinish: string | null; fileFloat: number | null; planoraFloat: number | null }

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
  /** Lowest total float among open activities (work days) */
  minFloat: number | null
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
const calDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY)
const isOpen = (a: Activity) => a.status !== 'complete' && !a.actualFinish
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'
const COMPLETION = /substantial|final\s+complet|project\s+complet|\bcomplet(e|ion)\b|turnover|hand\s*over|handover|occupan|certificate|\bc\s*of\s*o\b|contract\s+finish|project\s+finish|closeout/i
const FINISH_CONSTRAINTS = new Set(['MFO', 'FO', 'FNLT'])

/**
 * The contract completion milestone: a milestone with no successors, preferring one that carries a
 * finish constraint or a completion-sounding name, latest forecast first. Falls back to the
 * latest-finishing activity with no successors.
 */
export function pickFinishMilestone(activities: Activity[], hasSuccessor: Set<string>, finishOf: (a: Activity) => string | null): Activity | null {
  const ends = activities.filter(a => isWork(a) && !hasSuccessor.has(a.id))
  if (!ends.length) return null
  const rank = (a: Activity) =>
    (a.activityType === 'milestone' ? 4 : 0) + (a.constraintType && FINISH_CONSTRAINTS.has(a.constraintType) ? 2 : 0) + (COMPLETION.test(a.name) ? 1 : 0)
  return [...ends].sort((x, y) => rank(y) - rank(x) || (finishOf(y) || '').localeCompare(finishOf(x) || ''))[0]
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

  const fm = pickFinishMilestone(work, hasSucc, forecastOf)
  let finishMilestone: FinishMilestone | null = null
  if (fm) {
    const f = forecastOf(fm)
    finishMilestone = {
      id: fm.id, code: fm.activityId, name: fm.name, baselineFinish: fm.baselineFinish, forecastFinish: f,
      constraint: fm.constraintType && fm.constraintDate ? { type: fm.constraintType, date: fm.constraintDate } : null,
      varianceDays: f && fm.baselineFinish ? calDays(fm.baselineFinish, f) : null,
    }
  }

  // Variance: the finish milestone against its own baseline; else the project forecast against the
  // latest baseline finish, but only when most activities carry a baseline (a few baselined
  // activities do not describe the project's baseline finish).
  let varianceDays: number | null = null
  let varianceBasis = 'The file has no baseline dates, so variance cannot be measured.'
  const baselined = work.filter(a => a.baselineFinish)
  if (finishMilestone?.varianceDays != null) {
    varianceDays = finishMilestone.varianceDays
    varianceBasis = `${finishMilestone.code} ${finishMilestone.name}: forecast ${finishMilestone.forecastFinish} vs baseline ${finishMilestone.baselineFinish} (calendar days).`
  } else if (baselined.length && forecastFinish) {
    if (baselined.length >= work.length * 0.8) {
      const latest = baselined.map(a => a.baselineFinish!).sort().pop()!
      varianceDays = calDays(latest, forecastFinish)
      varianceBasis = `Project forecast finish ${forecastFinish} vs the latest baseline finish ${latest} (calendar days); the finish milestone has no baseline.`
    } else {
      varianceBasis = `Only ${baselined.length} of ${work.length} activities carry baseline dates, so a project variance would be misleading.`
    }
  }

  const floats = open.map(a => a.totalFloat).filter(n => Number.isFinite(n))
  const minFloat = floats.length ? Math.min(...floats) : null
  const negativeFloatCount = floats.filter(n => n < 0).length
  const violations = cpm?.violations ?? []

  const reasons: string[] = []
  let status: ScheduleStatus = 'on_track'
  const bump = (s: ScheduleStatus, why: string) => {
    reasons.push(why)
    if (s === 'at_risk' || (s === 'attention' && status === 'on_track')) status = s
  }
  if (!open.length) status = 'complete'
  else {
    if (negativeFloatCount > 0) bump('at_risk', `${negativeFloatCount} open ${negativeFloatCount === 1 ? 'activity has' : 'activities have'} negative float (lowest ${minFloat} work days).`)
    if (violations.length) bump('at_risk', `${violations.length} mandatory constraint${violations.length === 1 ? ' overrules' : 's overrule'} logic (up to ${Math.max(...violations.map(v => v.days))} work days).`)
    if (varianceDays != null && varianceDays > 14) bump('at_risk', `Forecast finish is ${varianceDays} calendar days behind baseline.`)
    else if (varianceDays != null && varianceDays > 0) bump('attention', `Forecast finish is ${varianceDays} calendar day${varianceDays === 1 ? '' : 's'} behind baseline.`)
    if (input.mustFinishBy && forecastFinish && forecastFinish > input.mustFinishBy) bump('at_risk', `Forecast finish ${forecastFinish} is after the required finish ${input.mustFinishBy}.`)
    if (input.today && forecastFinish && forecastFinish < input.today) bump('at_risk', `Forecast finish ${forecastFinish} has already passed.`)
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
    finishMilestone, varianceDays, varianceBasis, minFloat, negativeFloatCount, violations, longestPath: cpm?.longestPath ?? [],
    status, statusReasons: reasons, recalc,
  }
}
