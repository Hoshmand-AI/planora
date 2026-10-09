// Resource leveling and smoothing as a labelled what-if scenario.
//
// Deterministic serial heuristic. Repeatedly: recalculate the network (Planora's CPM, every calendar,
// lag, constraint and the data date), load the resources, take the EARLIEST over-allocated day (ties:
// resource code) and resolve it by delaying ONE not-started activity working on that resource that
// day. Who waits is decided by priority: the activity with the least total float keeps the resource,
// then the earliest late start, then the activity code (so the result never depends on input order);
// the lowest-priority candidate is delayed first. A delayed activity starts at the first work day
// after the conflict on which it fits within every resource limit it uses (a later day when none
// fits). The delay is a Start On or After (SNET) date, so it is an ordinary schedule edit that P6 and
// MS Project understand, and logic carries it to the successors.
//
// Within float first: a delay is kept only when the finish and every contract milestone stay where
// they were. Smoothing stops there. Leveling with "allow the finish to extend" then delays the
// lowest-priority candidate anyway when nothing fits within float. Work in progress, complete work,
// milestones and activities held by any constraint other than SNET are never moved; actuals and the
// data date are never touched. What-if staffing changes availability (analysis/resources.ts) and re-runs.
// Pure: no database access.

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, GeneratedSchedule, WorkCalendar } from './types'
import type { ResourceData } from './resource-types'
import type { ScheduleEditChange } from './uploaded-edits'
import type { NetworkInput } from './uploaded-recovery'
import { analyzeResources, buildLoading, demandOn, overOn, type LoadActivity, type Loading, type OverAllocationPeriod, type ResourceLoad } from '@/lib/analysis/resources'
import { compileCalendar, defaultCalendar, fromDayNumber, toDayNumber } from './calendar'
import { applyScheduleEdits } from './uploaded-edits'
import { completeSchedule } from './complete-schedule'
import { runCpm } from './cpm'

export const LEVELED_SCENARIO_LABEL = 'Leveled scenario'
export type LevelingMode = 'level' | 'smooth'

export interface LevelActivity extends LoadActivity {
  constraint?: { type: ConstraintType | string; date: string } | null
}

/** One recalculation of the network with leveling delays (SNET dates by activity id). */
export interface ScheduleRun {
  /** Logic-driven project finish */
  finish: string | null
  times: Record<string, { earlyStart: string; earlyFinish: string; lateStart: string; totalFloat: number }>
  /** Forecast date of each reported milestone */
  milestoneDates: Record<string, string | null>
}

export interface LevelingNetwork {
  activities: LevelActivity[]
  calendars: WorkCalendar[]
  defaultCalendarId?: string | null
  dataDate?: string | null
  data: ResourceData | null | undefined
  /** Contract milestones reported before / after (the finish is always reported) */
  milestones: { id: string; code: string; name: string; required?: string | null }[]
  run(delays: ReadonlyMap<string, string>): ScheduleRun | null
}

export interface LevelingOptions {
  mode?: LevelingMode
  /** Leveling only: delay beyond float (moving the finish) when nothing fits within float */
  allowFinishExtension?: boolean
  /** What-if staffing: available units per work day by resource id */
  availability?: Record<string, number>
  maxIterations?: number
  /** Most network recalculations one run may use (a deterministic work budget); default 600 */
  maxRuns?: number
}

export interface LevelingDelay {
  activityId: string
  code: string
  name: string
  fromStart: string
  toStart: string
  /** Work days on the activity's calendar */
  workDays: number
  calendarDays: number
  /** Total float before leveling (work days) */
  floatBefore: number
  withinFloat: boolean
  resources: string[]
  /** The SNET date of the scenario edit */
  snet: string
  reason: string
}

export interface LevelingSide {
  finish: string | null
  milestones: { id: string; code: string; name: string; required: string | null; date: string | null }[]
  overAllocatedDays: number
  periods: number
}

export interface LevelingResult {
  ok: boolean
  error?: string
  label: string
  mode: LevelingMode
  allowFinishExtension: boolean
  availability: Record<string, number>
  before: LevelingSide
  after: LevelingSide
  /** Calendar days the finish moves (positive = later) */
  finishChangeDays: number
  delays: LevelingDelay[]
  /** Activities that moved only because a delayed predecessor moved them */
  knockOn: { activityId: string; code: string; calendarDays: number }[]
  /** Over-allocations left after leveling */
  remaining: OverAllocationPeriod[]
  /** Conflicts leveling could not resolve, and why */
  unresolved: { resourceCode: string; date: string; reason: string }[]
  /** Scenario edits (SNET constraints) that reproduce the leveled schedule */
  changes: Extract<ScheduleEditChange, { kind: 'constraint' }>[]
  iterations: number
  stoppedEarly: boolean
  assumptions: string[]
}

const EPS = 1e-6
const calDays = (a: string, b: string) => toDayNumber(b) - toDayNumber(a)

function emptySide(): LevelingSide { return { finish: null, milestones: [], overAllocatedDays: 0, periods: 0 } }

export function levelResources(net: LevelingNetwork, opts: LevelingOptions = {}): LevelingResult {
  const mode: LevelingMode = opts.mode === 'smooth' ? 'smooth' : 'level'
  const allowExtend = mode === 'level' && !!opts.allowFinishExtension
  const availability = opts.availability ?? {}
  const maxIter = opts.maxIterations ?? 400
  const maxRuns = opts.maxRuns ?? 600
  let runs = 0
  const label = LEVELED_SCENARIO_LABEL
  const fail = (error: string): LevelingResult => ({ ok: false, error, label, mode, allowFinishExtension: allowExtend, availability, before: emptySide(), after: emptySide(), finishChangeDays: 0, delays: [], knockOn: [], remaining: [], unresolved: [], changes: [], iterations: 0, stoppedEarly: false, assumptions: [] })
  const base = net.run(new Map())
  if (!base || !base.finish) return fail('Planora could not recalculate this schedule (no activity relationships), so it cannot be leveled.')
  const cals = net.calendars.length ? net.calendars : [defaultCalendar()]
  const calById = new Map(cals.map(c => [c.id, c]))
  const defCal = (net.defaultCalendarId && calById.get(net.defaultCalendarId)) || cals[0]
  const calOf = (a: LevelActivity) => compileCalendar((a.calendarId && calById.get(a.calendarId)) || defCal)
  const byId = new Map(net.activities.map(a => [a.id, a]))
  const dataDay = net.dataDate ? toDayNumber(net.dataDate) : NaN

  const loadInput = (run: ScheduleRun) => ({
    activities: net.activities.map(a => ({ ...a, start: run.times[a.id]?.earlyStart ?? null, finish: run.times[a.id]?.earlyFinish ?? null })),
    calendars: net.calendars, defaultCalendarId: net.defaultCalendarId, dataDate: net.dataDate, data: net.data, availability,
  })
  const side = (run: ScheduleRun): LevelingSide => {
    const a = analyzeResources(loadInput(run), { histogramFor: [] })
    return {
      finish: run.finish,
      milestones: net.milestones.map(m => ({ id: m.id, code: m.code, name: m.name, required: m.required ?? null, date: run.milestoneDates[m.id] ?? null })),
      overAllocatedDays: a.totals.overAllocatedDays, periods: a.totals.periods,
    }
  }
  const movable = (a: LevelActivity | undefined, run: ScheduleRun): a is LevelActivity =>
    !!a && !a.isMilestone && !a.actualStart && !a.actualFinish && (a.status ?? 'not_started') === 'not_started'
    && (!a.constraint || a.constraint.type === 'SNET') && !!run.times[a.id]
  const withinTargets = (run: ScheduleRun) => {
    if (!run.finish || run.finish > base.finish!) return false
    for (const m of net.milestones) {
      const b = base.milestoneDates[m.id], n = run.milestoneDates[m.id]
      if (b && n && n > b) return false
    }
    return true
  }

  /** First work day after `day` on which `a` fits within every limit it uses; null when it alone exceeds one. */
  const fitStart = (a: LevelActivity, day: number, loading: Loading, run: ScheduleRun): { start: number; fits: boolean } | null => {
    const cal = calOf(a)
    const t = run.times[a.id]
    const dur = Math.max(1, cal.countInclusive(toDayNumber(t.earlyStart), toDayNumber(t.earlyFinish)))
    const uses: { L: ResourceLoad; rate: number }[] = []
    for (const L of loading.resources) {
      const rate = L.rateByActivity.get(a.id)
      if (!rate || L.availablePerDay === null) continue
      if (rate > L.availablePerDay + EPS) return null
      uses.push({ L, rate })
    }
    const cap = (L: ResourceLoad, d: number) => (L.calendar ? (L.calendar.isWork(d) ? L.availablePerDay! : 0) : L.availablePerDay!)
    const first = cal.next(day + 1)
    let s = first
    for (let guard = 0; guard < 2000 && s - first < 3660; guard++) {
      let failAt = NaN
      for (let k = 0, d = s; k < dur && Number.isNaN(failAt); k++, d = cal.next(d + 1)) {
        for (const { L, rate } of uses) {
          const own = L.days.get(d)?.by.get(a.id) || 0
          if (demandOn(L, d) - own + rate > cap(L, d) + EPS) { failAt = d; break }
        }
      }
      if (Number.isNaN(failAt)) return { start: s, fits: true }
      s = cal.next(failAt + 1)
    }
    return { start: first, fits: false }
  }

  const delays = new Map<string, string>()
  let run = base
  const blocked = new Set<string>()
  const unresolved: LevelingResult['unresolved'] = []
  let iterations = 0, stoppedEarly = false
  for (;;) {
    if (iterations >= maxIter || runs >= maxRuns) { stoppedEarly = true; break }
    iterations++
    const loading = buildLoading(loadInput(run))
    // The earliest over-allocated day not already found unresolvable (ties: resource code order).
    let conflict: { L: ResourceLoad; day: number } | null = null
    for (const L of loading.resources) {
      for (const day of [...L.days.keys()].sort((x, y) => x - y)) {
        if (conflict && day >= conflict.day) break
        if (!blocked.has(`${L.resource.id}|${day}`) && overOn(L, day, loading)) { conflict = { L, day }; break }
      }
    }
    if (!conflict) break
    const { L, day } = conflict
    const cur = run
    const minFloat = Math.min(0, ...Object.values(cur.times).map(t => t.totalFloat))
    const prio = (a: LevelActivity) => { const t = cur.times[a.id]; return { tf: t.totalFloat, ls: t.lateStart } }
    // Lowest priority first: most float, then latest late start, then the higher code.
    const candidates = [...(L.days.get(day)?.by.keys() ?? [])].map(id => byId.get(id)).filter((a): a is LevelActivity => movable(a, cur))
      .sort((a, b) => { const x = prio(a), y = prio(b); return y.tf - x.tf || y.ls.localeCompare(x.ls) || b.code.localeCompare(a.code) })
    let accepted = false
    let reason = candidates.length ? '' : 'Only work in progress, complete or held by a constraint uses the resource that day; leveling does not move it.'
    const tried: { a: LevelActivity; start: number }[] = []
    const trial = (a: LevelActivity, start: number) => {
      const next = new Map(delays)
      next.set(a.id, fromDayNumber(start))
      runs++
      return { next, result: net.run(next) }
    }
    for (const a of candidates.slice(0, 12)) {
      const fit = fitStart(a, day, loading, cur)
      if (!fit) { reason ||= `${a.code} alone needs more ${L.resource.code} per day than is available; add staff or extend its duration.`; continue }
      tried.push({ a, start: fit.start })
      const cal = calOf(a)
      const shift = cal.countInclusive(toDayNumber(cur.times[a.id].earlyStart) + 1, fit.start)
      // Float relative to the critical path (a required finish can make every float negative).
      if (shift > cur.times[a.id].totalFloat - minFloat + EPS) continue
      const { next, result } = trial(a, fit.start)
      if (result && withinTargets(result)) { delays.clear(); for (const [k, v] of next) delays.set(k, v); run = result; accepted = true; break }
    }
    if (!accepted && allowExtend && tried.length) {
      const { a, start } = tried[0]
      const { next, result } = trial(a, start)
      if (result && result.finish) { delays.clear(); for (const [k, v] of next) delays.set(k, v); run = result; accepted = true }
    }
    if (!accepted) {
      blocked.add(`${L.resource.id}|${day}`)
      if (!reason) reason = mode === 'smooth' ? 'No activity using the resource that day can wait within its float (smoothing keeps the finish and milestones).' : 'Resolving it would delay the finish or a contract milestone; allow the finish to extend to level it.'
      const last = unresolved[unresolved.length - 1]
      // One entry per resource and reason for a run of days.
      if (!last || last.resourceCode !== L.resource.code || last.reason !== reason) unresolved.push({ resourceCode: L.resource.code, date: fromDayNumber(day), reason })
    }
  }

  // Delays introduced, measured on the final schedule.
  const finalLoading = buildLoading(loadInput(run))
  const resOf = (id: string) => finalLoading.resources.filter(R => R.rateByActivity.has(id)).map(R => R.resource.code)
  const minBase = Math.min(0, ...Object.values(base.times).map(t => t.totalFloat))
  const delayList: LevelingDelay[] = []
  for (const [id, snet] of delays) {
    const a = byId.get(id)!
    const from = base.times[id]?.earlyStart, to = run.times[id]?.earlyStart
    if (!from || !to || to <= from) continue
    const cal = calOf(a)
    const workDays = cal.countInclusive(toDayNumber(from) + 1, toDayNumber(to))
    const floatBefore = base.times[id].totalFloat
    const res = resOf(id)
    delayList.push({
      activityId: id, code: a.code, name: a.name, fromStart: from, toStart: to, workDays, calendarDays: calDays(from, to),
      floatBefore, withinFloat: workDays <= floatBefore - minBase + EPS, resources: res,
      snet: a.constraint?.type === 'SNET' && a.constraint.date > snet ? a.constraint.date : snet,
      reason: `Resource leveling: ${a.code} waits ${workDays} work day${workDays === 1 ? '' : 's'} for ${res.join(', ') || 'its resources'}.`,
    })
  }
  delayList.sort((x, y) => x.code.localeCompare(y.code))
  const delayed = new Set(delayList.map(d => d.activityId))
  const knockOn = net.activities.filter(a => !delayed.has(a.id) && base.times[a.id] && run.times[a.id] && run.times[a.id].earlyStart > base.times[a.id].earlyStart)
    .map(a => ({ activityId: a.id, code: a.code, calendarDays: calDays(base.times[a.id].earlyStart, run.times[a.id].earlyStart) }))
    .sort((x, y) => x.code.localeCompare(y.code))
  const after = analyzeResources(loadInput(run), { histogramFor: [] })
  const assumptions = [...after.assumptions]
  if (stoppedEarly) assumptions.push(`Leveling stopped after ${iterations} conflicts and ${runs} recalculations (its work limit); over-allocations after that point are listed as remaining.`)
  if (Number.isFinite(dataDay)) assumptions.push('Only work after the data date is leveled; actuals and in-progress work keep their dates.')
  assumptions.push('Leveling delays are written as Start On or After (SNET) dates, one per delayed activity, so the scenario can be exported and reverted like any Planora edit.')
  return {
    ok: true, label, mode, allowFinishExtension: allowExtend, availability,
    before: side(base), after: side(run),
    finishChangeDays: run.finish && base.finish ? calDays(base.finish, run.finish) : 0,
    delays: delayList, knockOn, remaining: after.overAllocations, unresolved,
    changes: delayList.map(d => ({ kind: 'constraint' as const, activityId: d.activityId, constraint: { type: 'SNET' as const, date: d.snet } })),
    iterations, stoppedEarly, assumptions,
  }
}

/* ─── Networks ─────────────────────────────────────────── */

const later = (a: string | null | undefined, b: string) => (a && a > b ? a : b)

/**
 * Leveling network for an UPLOADED schedule (uploaded-recovery's NetworkInput: activities, logic,
 * calendars, data date, progress mode, contract milestone). Delays are applied as constraint edits
 * and the network recalculated with completeSchedule, exactly as a saved scenario is.
 */
export function uploadedLevelingNetwork(net: NetworkInput, data: ResourceData | null | undefined, milestones: LevelingNetwork['milestones'] = []): LevelingNetwork {
  const work = net.activities.filter(a => a.activityType === 'task' || a.activityType === 'milestone')
  const byId = new Map(work.map(a => [a.id, a]))
  const run = (delays: ReadonlyMap<string, string>): ScheduleRun | null => {
    const changes: ScheduleEditChange[] = [...delays].map(([id, date]) => ({ kind: 'constraint', activityId: id, constraint: { type: 'SNET', date: later(byId.get(id)?.constraintType === 'SNET' ? byId.get(id)?.constraintDate : null, date) } }))
    const edited = changes.length
      ? applyScheduleEdits(net.activities, net.relationships, changes.map((change, i) => ({ id: `level-${i}`, change, reason: 'leveling', by: 'planora', at: '' })))
      : { activities: net.activities, relationships: net.relationships }
    return runUploaded(edited.activities, edited.relationships, net, milestones)
  }
  return {
    activities: work.map(a => ({
      id: a.id, code: a.activityId, name: a.name, isMilestone: a.activityType === 'milestone', calendarId: a.calendarId ?? null,
      status: a.status, actualStart: a.actualStart, actualFinish: a.actualFinish,
      constraint: a.constraintType && a.constraintDate ? { type: a.constraintType, date: a.constraintDate } : null,
    })),
    calendars: net.calendars, defaultCalendarId: net.defaultCalendarId, dataDate: net.dataDate, data, milestones, run,
  }
}

function runUploaded(activities: Activity[], relationships: Relationship[], net: NetworkInput, milestones: LevelingNetwork['milestones']): ScheduleRun | null {
  const done = completeSchedule({
    activities, relationships, calendars: net.calendars, defaultCalendarId: net.defaultCalendarId,
    projectStart: net.projectStart, projectFinish: null, dataDate: net.dataDate, mustFinishBy: net.mustFinishBy, progressMode: net.progressMode,
  })
  if (!done.cpm) return null
  const cpm = done.cpm
  const times: ScheduleRun['times'] = {}
  for (const [id, t] of Object.entries(cpm.times)) times[id] = { earlyStart: t.earlyStart, earlyFinish: t.earlyFinish, lateStart: t.lateStart, totalFloat: t.totalFloat }
  const actById = new Map(done.activities.map(a => [a.id, a]))
  const milestoneDates: Record<string, string | null> = {}
  for (const m of milestones) {
    const a = actById.get(m.id)
    milestoneDates[m.id] = a?.actualFinish?.slice(0, 10) ?? cpm.violations.find(v => v.id === m.id)?.logicDate ?? cpm.times[m.id]?.earlyFinish ?? null
  }
  return { finish: cpm.logicFinish, times, milestoneDates }
}

/** Leveling network for a plan built in Planora (its generated schedule and milestone targets). */
export function planLevelingNetwork(g: GeneratedSchedule): LevelingNetwork {
  const milestones = (g.milestoneTargets ?? []).map(m => {
    const a = g.activities.find(x => x.id === m.activityId)
    return { id: m.activityId, code: a?.code ?? m.key, name: a?.name ?? m.label, required: m.target }
  }).filter(m => g.activities.some(a => a.id === m.id))
  const run = (delays: ReadonlyMap<string, string>): ScheduleRun | null => {
    try {
      const cpm = runCpm({
        projectStart: g.projectStart, dataDate: g.dataDate, mustFinishBy: g.mustFinishBy, calendars: g.calendars, defaultCalendarId: g.defaultCalendarId,
        activities: g.activities.map(a => {
          const d = delays.get(a.id)
          return d ? { ...a, constraint: { type: 'SNET' as const, date: later(a.constraint?.type === 'SNET' ? a.constraint.date : null, d) } } : a
        }),
        links: g.links.map(l => ({ from: l.from, to: l.to, type: l.type, lag: l.lag })),
      })
      const times: ScheduleRun['times'] = {}
      for (const [id, t] of Object.entries(cpm.times)) times[id] = { earlyStart: t.earlyStart, earlyFinish: t.earlyFinish, lateStart: t.lateStart, totalFloat: t.totalFloat }
      const milestoneDates: Record<string, string | null> = {}
      for (const m of milestones) milestoneDates[m.id] = cpm.violations.find(v => v.id === m.id)?.logicDate ?? cpm.times[m.id]?.earlyFinish ?? null
      return { finish: cpm.logicFinish, times, milestoneDates }
    } catch {
      return null
    }
  }
  return {
    activities: g.activities.map(a => ({
      id: a.id, code: a.code, name: a.name, isMilestone: a.type === 'milestone', calendarId: a.calendarId ?? g.defaultCalendarId,
      status: a.status ?? (a.actualFinish ? 'complete' : a.actualStart ? 'in_progress' : 'not_started'), actualStart: a.actualStart ?? null, actualFinish: a.actualFinish ?? null,
      constraint: a.constraint ?? null,
    })),
    calendars: g.calendars, defaultCalendarId: g.defaultCalendarId, dataDate: g.dataDate ?? null, data: g.resources ?? null, milestones, run,
  }
}

/** Activities as resource loading needs them, from one run of a leveling network (the analysis endpoints use it). */
export function loadActivitiesOf(net: LevelingNetwork, run: ScheduleRun): LoadActivity[] {
  return net.activities.map(a => ({ ...a, start: run.times[a.id]?.earlyStart ?? null, finish: run.times[a.id]?.earlyFinish ?? null }))
}

