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
  /** Forecast as scheduled (constraints honoured): the date shown on the activity */
  scheduledFinish?: string | null
  /** Logic-driven forecast (mandatory constraints relaxed) */
  logicFinish?: string | null
  /**
   * What forecastFinish (and so variance, the required-finish check and CPLI) is measured on:
   * 'logic' when a mandatory constraint on or upstream of this milestone overrules logic.
   */
  basis?: 'scheduled' | 'logic'
  /** The overruled mandatory constraint on (or upstream of) this milestone, when basis is 'logic' */
  heldBy?: { code: string; name: string; type: 'MSO' | 'MFO'; constraintDate: string; logicDate: string; days: number } | null
}

/** A constraint the driving path is traced through (it, not logic, sets that activity's date) */
export interface DrivingConstraint { id: string; code: string; type: string; date: string; effect: 'later' | 'earlier' | 'start' }

export const FINISH_LABELS = {
  scheduled: 'Forecast (as scheduled, constraints honoured)',
  logic: 'Logic-driven (mandatory constraints relaxed)',
} as const

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
  /** The file's own out-of-sequence progress option (P6 SCHEDOPTIONS), when it states one */
  fileProgressMode?: ProgressMode | null
  /**
   * Headline forecast finish: the later of the scheduled and the logic-driven finish (a mandatory
   * constraint can't hide a slip); forecastBasis says which one it is.
   */
  forecastFinish: string | null
  forecastBasis?: 'scheduled' | 'logic'
  /** FINISH_LABELS.scheduled: latest finish with every constraint honoured (the dates shown on activities) */
  scheduledFinish?: string | null
  /** FINISH_LABELS.logic: latest finish logic produces with mandatory constraints relaxed */
  logicFinish?: string | null
  /**
   * Logic-driven dates of open activities where they are later than the scheduled ones (an
   * overruled mandatory constraint on or upstream of them): milestone tables, next milestones and
   * driving tasks show these.
   */
  logicDates?: Record<string, { start: string; finish: string }>
  /**
   * The driving path to present: the logic path when a mandatory constraint hides a later finish,
   * else the scheduled longest path, traced back through constraints that hold activities
   * (flagged in `constraints`; effect 'start' = the path starts at a constrained activity).
   */
  drivingPath?: { basis: 'scheduled' | 'logic'; ids: string[]; constraints: DrivingConstraint[]; openEnd?: { id: string; code: string } | null }
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
  /** The file's own progress option (kept in the analysis so a later change can be compared with it) */
  fileProgressMode?: ProgressMode | null
}): ScheduleAnalysis {
  const { activities, cpm } = input
  const work = activities.filter(isWork)
  const open = work.filter(isOpen)
  const hasSucc = new Set(input.links.map(l => l.from))
  const violationById = new Map((cpm?.violations ?? []).map(v => [v.id, v]))
  // Forecast per activity: what logic says, even where a mandatory constraint on it or upstream of
  // it pins the displayed date earlier (cpm.logicTimes); a constraint that holds work later stands.
  const logicTimes = cpm?.logicTimes
  const logicDates: Record<string, { start: string; finish: string }> = {}
  for (const a of work) {
    if (!isOpen(a)) continue
    const l = logicTimes?.[a.id]
    const v = violationById.get(a.id)
    const lf = l?.earlyFinish ?? (!logicTimes && v ? (v.logicFinish ?? (v.type === 'MFO' ? v.logicDate : null)) : null)
    if (lf && a.earlyFinish && lf > a.earlyFinish) {
      const ls = l?.earlyStart ?? v?.logicStart ?? a.earlyStart ?? lf
      logicDates[a.id] = { start: a.actualStart || (a.earlyStart && a.earlyStart > ls ? a.earlyStart : ls), finish: lf }
    }
  }
  const forecastOf = (a: Activity): string | null => {
    if (!isOpen(a)) return a.actualFinish || a.earlyFinish
    return logicDates[a.id]?.finish ?? a.earlyFinish
  }
  const finishes = work.map(forecastOf).filter((d): d is string => !!d).sort()
  const forecastFinish = cpm?.logicFinish && finishes.length ? [cpm.logicFinish, finishes[finishes.length - 1]].sort()[1] : (finishes[finishes.length - 1] ?? null)
  const scheduledFinish = cpm?.projectFinish ?? work.map(a => (isOpen(a) ? a.earlyFinish : a.actualFinish || a.earlyFinish)).filter((d): d is string => !!d).sort().pop() ?? null
  const logicFinish = cpm?.logicFinish ?? forecastFinish
  const forecastBasis: 'scheduled' | 'logic' = forecastFinish && scheduledFinish && forecastFinish > scheduledFinish && (cpm?.violations.length ?? 0) > 0 ? 'logic' : 'scheduled'

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
      scheduledFinish: isOpen(fm) ? fm.earlyFinish : fm.actualFinish || fm.earlyFinish,
      logicFinish: isOpen(fm) ? (logicTimes?.[fm.id]?.earlyFinish ?? f) : f,
      basis: logicDates[fm.id] ? 'logic' : 'scheduled',
      heldBy: logicDates[fm.id] ? heldByOf(fm.id, input.links, cpm?.violations ?? [], work) : null,
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

  // State the basis when an overruled mandatory constraint holds the milestone's scheduled date.
  if (finishMilestone?.basis === 'logic' && finishMilestone.heldBy) {
    const h = finishMilestone.heldBy
    varianceBasis = `${varianceBasis} Measured on the logic-driven date ${fmtDate(finishMilestone.forecastFinish)} (${FINISH_LABELS.logic.toLowerCase()}); as scheduled it shows ${fmtDate(finishMilestone.scheduledFinish)} only because the ${h.type === 'MFO' ? 'Mandatory Finish' : 'Mandatory Start'} ${fmtDate(h.constraintDate)} on ${h.code === finishMilestone.code ? 'it' : `${h.code} ${h.name}`} overrules logic by ${h.days} work day${h.days === 1 ? '' : 's'}.`
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

  // The driving path to present (traced through constraints) and the findings on it.
  const byId = new Map(work.map(a => [a.id, a]))
  const trace = cpm?.drivingTrace ?? { basis: 'scheduled' as const, path: cpm?.longestPath ?? [], constraints: [] }
  const drivingConstraints: DrivingConstraint[] = trace.constraints.map(c => ({ ...c, code: byId.get(c.id)?.activityId ?? c.id }))
  const firstOpen = trace.path.map(id => byId.get(id)).find((a): a is Activity => !!a && isOpen(a))
  const startConstraint = firstOpen && firstOpen.constraintType && firstOpen.constraintDate && !drivingConstraints.some(c => c.id === firstOpen.id)
    && !(firstOpen.actualStart && START_TYPES.has(normType(firstOpen.constraintType)))
    ? { id: firstOpen.id, code: firstOpen.activityId, type: normType(firstOpen.constraintType), date: firstOpen.constraintDate, effect: 'start' as const }
    : null
  if (startConstraint) drivingConstraints.unshift(startConstraint)
  const endAct = trace.path.length ? byId.get(trace.path[trace.path.length - 1]) : undefined
  const openEnd = endAct && isOpen(endAct) && endAct.activityType !== 'milestone' && !hasSucc.has(endAct.id) && endAct.id !== finishMilestone?.id
    ? { id: endAct.id, code: endAct.activityId } : null
  const drivingPath: NonNullable<ScheduleAnalysis['drivingPath']> = { basis: trace.basis, ids: trace.path, constraints: drivingConstraints, openEnd }

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
    if (finishMilestone?.basis === 'logic' && finishMilestone.heldBy) {
      const h = finishMilestone.heldBy
      bump('at_risk', `${finishMilestone.code} ${finishMilestone.name}: ${FINISH_LABELS.logic.toLowerCase()} ${fmtDate(finishMilestone.logicFinish)}; ${FINISH_LABELS.scheduled.toLowerCase()} ${fmtDate(finishMilestone.scheduledFinish)}, held by the ${h.type === 'MFO' ? 'Mandatory Finish' : 'Mandatory Start'} ${fmtDate(h.constraintDate)} on ${h.code === finishMilestone.code ? 'the milestone itself' : h.code}.`)
    }
    for (const c of drivingConstraints.slice(0, 3)) {
      const label = CONSTRAINT_NAMES[c.type] ?? c.type
      bump('attention', c.effect === 'start'
        ? `The driving path starts at ${c.code}, which carries a ${label} constraint ${fmtDate(c.date)}: a typed date, not logic, may be driving the finish.`
        : `The driving path is traced through ${c.code}, whose ${label} constraint ${fmtDate(c.date)} holds it ${c.effect} than logic; the longest path stops there in P6.`)
    }
    if (openEnd) bump('attention', `${openEnd.code} has no successor but drives the project finish (an open end): tie it to the completion milestone.`)
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
      if (ex.bei < R.indexTarget) bump('attention', `Baseline execution index is ${(Math.floor(ex.bei * 100) / 100).toFixed(2)}, below ${R.indexTarget.toFixed(2)}: ${ex.completed} activities complete against ${ex.due} baselined to finish before ${fmtDate(input.dataDate)}.`)
      if (ex.missed / ex.due > R.maxPct / 100) bump('attention', `${ex.missed} of ${ex.due} activities baselined to finish before ${fmtDate(input.dataDate)} finished late or not at all.`)
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
    version: 1, progressMode: cpm?.progressMode ?? 'retained', fileProgressMode: input.fileProgressMode ?? null, forecastFinish, reportedFinish: input.reportedFinish, mustFinishBy: input.mustFinishBy,
    forecastBasis, scheduledFinish, logicFinish, logicDates, drivingPath,
    finishMilestone, varianceDays, varianceBasis, minFloat, minFloatAt, negativeFloatCount, violations, longestPath: cpm?.longestPath ?? [],
    status, statusReasons: reasons, recalc,
  }
}

const CONSTRAINT_NAMES: Record<string, string> = {
  SNET: 'Start On or After', SNLT: 'Start On or Before', FNET: 'Finish On or After', FNLT: 'Finish On or Before',
  SO: 'Start On', FO: 'Finish On', MSO: 'Mandatory Start', MFO: 'Mandatory Finish',
}
const START_TYPES = new Set(['SNET', 'SNLT', 'SO', 'MSO'])
const normType = (t: string) => {
  const u = t.toUpperCase().replace(/^CS_/, '')
  return ({ MANDSTART: 'MSO', MANDFIN: 'MFO', MANDFINISH: 'MFO', MEOA: 'FNET', MEOB: 'FNLT', MSOA: 'SNET', MSOB: 'SNLT', MEO: 'FO' } as Record<string, string>)[u] ?? u
}

/**
 * The overruled mandatory constraint that holds an activity's scheduled date: on the activity itself,
 * else the upstream one whose logic date is latest.
 */
function heldByOf(id: string, links: { from: string; to: string }[], violations: CpmResult['violations'], work: Activity[]): FinishMilestone['heldBy'] {
  if (!violations.length) return null
  const vById = new Map(violations.map(v => [v.id, v]))
  const own = vById.get(id)
  let v = own
  if (!v) {
    const preds = new Map<string, string[]>()
    for (const l of links) preds.set(l.to, [...(preds.get(l.to) ?? []), l.from])
    const seen = new Set<string>()
    const stack = [...(preds.get(id) ?? [])]
    const found: CpmResult['violations'] = []
    while (stack.length) {
      const cur = stack.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      const hit = vById.get(cur)
      if (hit) found.push(hit)
      stack.push(...(preds.get(cur) ?? []))
    }
    v = found.sort((a, b) => (b.logicFinish ?? b.logicDate).localeCompare(a.logicFinish ?? a.logicDate))[0]
  }
  if (!v) return null
  const a = work.find(x => x.id === v!.id)
  return { code: a?.activityId ?? v.id, name: a?.name ?? '', type: v.type, constraintDate: v.constraintDate, logicDate: v.logicFinish ?? v.logicDate, days: v.days }
}
