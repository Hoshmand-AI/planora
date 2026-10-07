// Windows analysis of an update series (forensic / owner-side delay review). For every consecutive
// pair of updates (ordered by data date) it reports how far the finish milestone moved and splits
// the movement into causes with a stepped "half-step" recalculation on Planora's own CPM:
//
//   E0  the earlier update as submitted (its logic, durations, constraints, calendars and progress)
//   H1  half-step: the earlier update's network with the LATER update's progress (actual dates,
//       status, remaining durations of in-progress work) at the later data date      → progress
//   then the later update's five kinds of revision, each switched from the earlier to the later update:
//     scope        activities added / deleted, the relationships that touch them, and the links that
//                  REPLACE them (a new link into a deleted activity's former successor or out of its
//                  former predecessor; an old link removed where an added activity now sits)
//                  — one "scope & logic" change                                            → added/deleted
//     logic        the remaining relationships and lags between matched activities         → revision: logic
//     durations    original durations of work not started                                  → revision: durations
//     constraints  constraint types and dates                                              → revision: constraints
//     calendars    calendar definitions and assignments (by calendar name)                 → revision: calendars
//
// Symmetric attribution: the five revisions are applied from H1 in the order above AND in the
// reverse order, and each one is credited with the average of its effect in the two orders (a
// two-order Shapley approximation), rounded to whole days with the largest-remainder method so the
// parts still add up exactly to the movement. Interacting revisions therefore share their overlap
// instead of the first one applied taking it all, and a replaced link no longer shows as a large
// added/deleted swing offset by an equal and opposite logic swing.
//
// Finish basis: movement and attribution are measured on the LOGIC-DRIVEN finish, i.e. every
// mandatory constraint (MSO/MFO) is treated as a no-earlier-than date (SNET/FNET), so a mandatory
// date can never hide a slip. The as-scheduled movement (mandatory constraints honored, as in the
// activity dates) is reported next to it, with the delay each overruled mandatory constraint on the
// driving path hides ("12 wd hidden by MFO on A1190").
//
// Activity-level attribution: along the logic-driven driving path to the finish in the later
// update, each activity is credited with the slip it adds to its driving predecessor's slip
// (finish later − finish earlier, minus the same for its predecessor on the path); these telescope
// to the finish movement. Each is named with its changes (added, duration, logic, constraint,
// calendar, progress shortfall). Anything the path cannot explain is reported as unattributed.
//
// Activities are matched by activity ID and calendars by name, as in compare.ts. Pure: unit tested.

import type { Activity, Relationship, Schedule } from '@/lib/db'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import type { ProgressMode, WorkCalendar } from '@/lib/planning/types'
import { completeSchedule, type CompletionResult } from '@/lib/planning/complete-schedule'
import { defaultCalendar, workDaysBetween } from '@/lib/planning/calendar'
import { baselineExecution } from '@/lib/analysis/dcma'
import { fmtDate } from '@/lib/format'

export interface WindowUpdate {
  schedule: Pick<Schedule, 'id' | 'name' | 'version' | 'dataDate' | 'projectStart' | 'calendars' | 'defaultCalendarId'>
  activities: Activity[]
  relationships: Relationship[]
  analysis: Pick<ScheduleAnalysis, 'forecastFinish' | 'finishMilestone' | 'longestPath' | 'progressMode' | 'minFloat' | 'negativeFloatCount'>
}

export interface PathEnds { start: { code: string; name: string } | null; end: { code: string; name: string } | null }

export interface WindowAttribution {
  /** Actual dates, status and remaining durations reported in the later update */
  progress: number
  /** Activities added or deleted in the later update, with their logic and the links that replace them */
  addedDeleted: number
  revisions: {
    logic: number
    /** Original durations of work not started in the later update */
    durations: number
    constraints: number
    calendars: number
    total: number
  }
  /** How the revisions were attributed (see the header) */
  method: 'symmetric'
}

export interface DriverChange {
  kind: 'added' | 'duration' | 'remaining' | 'progress' | 'logic' | 'constraint' | 'calendar'
  detail: string
  /** Work days, for duration and remaining-duration changes */
  delta?: number
}

/** One activity on the later driving path and the part of the finish movement it accounts for. */
export interface WindowDriver {
  code: string
  name: string
  /** Calendar days of finish movement this activity adds (+ = later); drivers + unattributed = movement */
  days: number
  /** The same in work days on the activity's own calendar */
  workDays: number | null
  /** Its logic-driven finish in the earlier update (null: not in the earlier update) and in the later one */
  before: string | null
  after: string | null
  changes: DriverChange[]
  /** Code of the overruled mandatory constraint downstream on the path that hides this slip as scheduled */
  hiddenBy: string | null
}

/** A mandatory constraint on the driving path that overrules logic in the later update. */
export interface HiddenDelay {
  code: string
  type: 'MSO' | 'MFO'
  constraintDate: string
  logicDate: string
  /** Work days logic would push it past the constraint (later update) */
  days: number
  /** The same in the earlier update (0 when it did not overrule logic there) */
  daysBefore: number
  text: string
}

export interface WindowRow {
  window: number
  before: { id: string; version: string; dataDate: string | null; finish: string | null }
  after: { id: string; version: string; dataDate: string | null; finish: string | null }
  /** Activity whose finish is measured (null: project forecast finish) */
  finishCode: string | null
  /** Calendar days the logic-driven finish moved (+ = later), from Planora's recalculation */
  movement: number | null
  /** The finish as scheduled (mandatory constraints honored, as the activity dates show it) */
  asScheduled: { before: string | null; after: string | null; movement: number | null }
  attribution: WindowAttribution | null
  /** The half-step finish: the earlier network with the later progress */
  halfStepFinish: string | null
  drivingPath: { before: PathEnds; after: PathEnds }
  /** Logic-driven driving path to the measured finish (activity codes, start → finish) */
  logicPath: { before: string[]; after: string[] }
  /** Activity-level attribution along the later driving path (non-zero contributions) */
  drivers: WindowDriver[]
  /** Calendar days of movement the driving path does not explain (path does not end at the finish) */
  unattributed: number
  /** Delay hidden by overruled mandatory constraints on the driving path */
  hidden: HiddenDelay[]
  /** Finish milestone total float (work days) in the later update */
  finishFloat: number | null
  counts: { added: number; deleted: number; logicChanged: number; durationsChanged: number; constraintsChanged: number; calendarsChanged: number }
  notes: string[]
}

export interface TrendRow {
  id: string
  version: string
  dataDate: string | null
  finishCode: string | null
  forecastFinish: string | null
  /** Total float of the finish milestone (driving-path float), work days */
  finishFloat: number | null
  minFloat: number | null
  negativeFloatCount: number
  /** DCMA #14 BEI and #11 missed tasks as of this update's data date (null: not measurable) */
  bei: number | null
  missed: number | null
  due: number | null
}

/** Uploads per data date: a reissue with the same data date supersedes the earlier upload. */
export interface SeriesPeriod {
  dataDate: string | null
  uploads: number
  analyzed: { id: string; version: string }[]
  superseded: { id: string; version: string }[]
}

export interface WindowsAnalysis {
  finishCode: string | null
  finishName: string | null
  windows: WindowRow[]
  trend: TrendRow[]
  series: SeriesPeriod[]
  notes: string[]
}

const DAY = 86_400_000
const calDays = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY) : null)
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'
const calKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')
const isMandatory = (t: string | null | undefined) => t === 'MSO' || t === 'MFO'
type Side = 'E' | 'L'
type Basis = 'logic' | 'scheduled'
const FACTORS = ['members', 'logic', 'dur', 'cstr', 'cal'] as const
type Factor = typeof FACTORS[number]

interface Mix { progress: Side; members: Side; logic: Side; dur: Side; cstr: Side; cal: Side; mode: ProgressMode }

function pathEnds(u: WindowUpdate): PathEnds {
  const byId = new Map(u.activities.map(a => [a.id, a]))
  const open = u.analysis.longestPath.map(id => byId.get(id)).filter((a): a is Activity => !!a && !a.actualFinish && a.status !== 'complete')
  const pick = (a: Activity | undefined) => (a ? { code: a.activityId, name: a.name } : null)
  return { start: pick(open[0]), end: pick(open[open.length - 1]) }
}

/** Everything about the pair that does not depend on the step. */
interface Pair {
  E: WindowUpdate
  L: WindowUpdate
  eBy: Map<string, Activity>
  lBy: Map<string, Activity>
  eCode: Map<string, string>
  lCode: Map<string, string>
  /** Later links between matched activities that replace a deleted activity (keys p→s|type) */
  lBridge: Set<string>
  /** Earlier links between matched activities that an added activity replaces */
  eBridge: Set<string>
  finishCode: string | null
}

const relKey = (p: string, s: string, t: string) => `${p}→${s}|${t}`

/**
 * Kept activities next to a chain of `inner` (added or deleted) activities: the predecessors that fed
 * it and the successors it fed (through inner activities only).
 */
function chainNeighbors(u: WindowUpdate, codeOf: Map<string, string>, inner: Set<string>, kept: (c: string) => boolean): { preds: Set<string>; succs: Set<string> } {
  const out = { preds: new Set<string>(), succs: new Set<string>() }
  if (!inner.size) return out
  const preds = new Map<string, string[]>(), succs = new Map<string, string[]>()
  for (const r of u.relationships) {
    const p = codeOf.get(r.predecessorId), s = codeOf.get(r.successorId)
    if (!p || !s) continue
    if (!succs.has(p)) succs.set(p, [])
    succs.get(p)!.push(s)
    if (!preds.has(s)) preds.set(s, [])
    preds.get(s)!.push(p)
  }
  const reach = (next: Map<string, string[]>, ends: Set<string>) => {
    const seen = new Set<string>(inner), stack = [...inner]
    while (stack.length) {
      for (const y of next.get(stack.pop()!) ?? []) {
        if (seen.has(y)) continue
        seen.add(y)
        if (inner.has(y)) stack.push(y)
        else if (kept(y)) ends.add(y)
      }
    }
  }
  reach(preds, out.preds)
  reach(succs, out.succs)
  return out
}

function makePair(E: WindowUpdate, L: WindowUpdate, finishCode: string | null): Pair {
  const eBy = new Map(E.activities.filter(isWork).map(a => [a.activityId, a]))
  const lBy = new Map(L.activities.filter(isWork).map(a => [a.activityId, a]))
  const eCode = new Map(E.activities.map(a => [a.id, a.activityId]))
  const lCode = new Map(L.activities.map(a => [a.id, a.activityId]))
  const matched = (c: string) => eBy.has(c) && lBy.has(c)
  const deleted = new Set([...eBy.keys()].filter(c => !lBy.has(c)))
  const added = new Set([...lBy.keys()].filter(c => !eBy.has(c)))
  const keys = (u: WindowUpdate, codeOf: Map<string, string>) => new Set(u.relationships.map(r => relKey(codeOf.get(r.predecessorId) ?? '', codeOf.get(r.successorId) ?? '', r.type)))
  const eKeys = keys(E, eCode), lKeys = keys(L, lCode)
  // A link that appears in the later update where a deleted activity used to take its predecessor's
  // output or feed its successor replaces the deleted activity; likewise an earlier link that
  // disappears where an added activity now sits. These belong to the scope change, not to logic.
  const viaDeleted = chainNeighbors(E, eCode, deleted, matched)
  const viaAdded = chainNeighbors(L, lCode, added, matched)
  const bridge = (u: WindowUpdate, codeOf: Map<string, string>, other: Set<string>, n: { preds: Set<string>; succs: Set<string> }) => {
    const out = new Set<string>()
    for (const r of u.relationships) {
      const p = codeOf.get(r.predecessorId), s = codeOf.get(r.successorId)
      if (!p || !s || !matched(p) || !matched(s)) continue
      const k = relKey(p, s, r.type)
      if (!other.has(k) && (n.preds.has(p) || n.succs.has(s))) out.add(k)
    }
    return out
  }
  return {
    E, L, eBy, lBy, eCode, lCode, finishCode,
    lBridge: bridge(L, lCode, eKeys, viaDeleted),
    eBridge: bridge(E, eCode, lKeys, viaAdded),
  }
}

/** Build the hybrid network for one step (see header), activities keyed by code. */
function hybrid(P: Pair, o: Mix, basis: Basis) {
  const { E, L, eBy, lBy, eCode, lCode } = P
  const codes0 = [...(o.members === 'E' ? eBy : lBy).keys()]
  const set0 = new Set(codes0)
  const pick = (code: string, s: Side) => (s === 'L' ? lBy.get(code) ?? eBy.get(code) : eBy.get(code) ?? lBy.get(code))!
  const sideOf = (code: string, s: Side): Side => (s === 'L' ? (lBy.has(code) ? 'L' : 'E') : (eBy.has(code) ? 'E' : 'L'))

  // Relationships: matched-to-matched links from the logic side, except the replacement links, which
  // belong to scope; links touching added/deleted activities and replacement links from the members side.
  const onlyL = (c: string) => lBy.has(c) && !eBy.has(c)
  const onlyE = (c: string) => eBy.has(c) && !lBy.has(c)
  const bridges = new Set([...P.lBridge, ...P.eBridge])
  const links: { p: string; s: string; type: Relationship['type']; lag: number }[] = []
  const seen = new Set<string>()
  const addRels = (u: WindowUpdate, codeMap: Map<string, string>, keep: (p: string, s: string, k: string) => boolean) => {
    for (const r of u.relationships) {
      const p = codeMap.get(r.predecessorId), s = codeMap.get(r.successorId)
      if (!p || !s || !set0.has(p) || !set0.has(s)) continue
      const key = relKey(p, s, r.type)
      if (seen.has(key) || !keep(p, s, key)) continue
      seen.add(key)
      links.push({ p, s, type: r.type, lag: r.lag })
    }
  }
  const scopeU = o.members === 'L' ? L : E, scopeMap = o.members === 'L' ? lCode : eCode
  const scopeOnly = o.members === 'L' ? onlyL : onlyE
  const scopeBridge = o.members === 'L' ? P.lBridge : P.eBridge
  addRels(scopeU, scopeMap, (p, s, k) => scopeOnly(p) || scopeOnly(s) || scopeBridge.has(k))
  addRels(o.logic === 'L' ? L : E, o.logic === 'L' ? lCode : eCode, (p, s, k) => !bridges.has(k))

  // Restrict to the measured finish and the work that can drive it: the finish date is unchanged and
  // the longest path then ends at the measured finish.
  let set = set0
  if (P.finishCode && set0.has(P.finishCode)) {
    const preds = new Map<string, string[]>()
    for (const l of links) { if (!preds.has(l.s)) preds.set(l.s, []); preds.get(l.s)!.push(l.p) }
    set = new Set([P.finishCode])
    const stack = [P.finishCode]
    while (stack.length) for (const p of preds.get(stack.pop()!) ?? []) if (!set.has(p)) { set.add(p); stack.push(p) }
  }
  const codes = codes0.filter(c => set.has(c))

  // Calendars: the chosen side's list; a calendar only the other side has is added under a prefixed id.
  const target = o.cal === 'L' ? L : E
  const cals: WorkCalendar[] = [...(target.schedule.calendars || [])]
  const byName = new Map(cals.map(c => [calKey(c.name), c.id]))
  const calRef = (a: Activity, side: Side): string | null => {
    const u = side === 'L' ? L : E
    const id = a.calendarId || u.schedule.defaultCalendarId
    if (u === target || !id) return id ?? null
    const c = (u.schedule.calendars || []).find(x => x.id === id)
    if (!c) return null
    const hit = byName.get(calKey(c.name))
    if (hit) return hit
    const nid = `${side}:${c.id}`
    if (!cals.some(x => x.id === nid)) cals.push({ ...c, id: nid })
    byName.set(calKey(c.name), nid)
    return nid
  }

  const activities: Activity[] = codes.map(code => {
    const p = pick(code, o.progress), d = pick(code, o.dur), k = pick(code, o.cstr)
    const cs = sideOf(code, o.cal)
    const c = pick(code, o.cal)
    // Logic basis: a mandatory date cannot pull work earlier than logic, only hold it later.
    const ct = k.constraintType ?? null
    const constraintType = basis === 'logic' && isMandatory(ct) ? (ct === 'MSO' ? 'SNET' : 'FNET') : ct
    return {
      ...d, id: `c:${code}`, scheduleId: 'windows',
      actualStart: p.actualStart, actualFinish: p.actualFinish, status: p.status, percentComplete: p.percentComplete,
      remainingDuration: p.status === 'in_progress' ? p.remainingDuration : d.duration,
      constraintType, constraintDate: k.constraintDate ?? null,
      calendarId: calRef(c, cs),
      earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, totalFloat: 0, freeFloat: 0, isCritical: false,
    }
  })
  const relationships: Relationship[] = links.filter(l => set.has(l.p) && set.has(l.s))
    .map((l, i) => ({ id: `r${i}`, scheduleId: 'windows', predecessorId: `c:${l.p}`, successorId: `c:${l.s}`, type: l.type, lag: l.lag }))

  const u = o.progress === 'L' ? L : E
  const starts = [E.schedule.projectStart, L.schedule.projectStart].filter((x): x is string => !!x).sort()
  return {
    activities, relationships, calendars: cals, defaultCalendarId: target.schedule.defaultCalendarId,
    projectStart: starts[0] ?? u.schedule.dataDate, dataDate: u.schedule.dataDate, progressMode: o.mode,
  }
}

interface Step { res: CompletionResult; calendars: WorkCalendar[]; defaultCalendarId: string | null }

function recalc(P: Pair, o: Mix, basis: Basis): Step {
  const h = hybrid(P, o, basis)
  const res = completeSchedule({
    activities: h.activities, relationships: h.relationships, calendars: h.calendars, defaultCalendarId: h.defaultCalendarId,
    projectStart: h.projectStart, projectFinish: null, dataDate: h.dataDate, progressMode: h.progressMode,
  })
  return { res, calendars: h.calendars, defaultCalendarId: h.defaultCalendarId }
}

function finishOf(res: CompletionResult, code: string | null): string | null {
  if (!code) return res.cpm?.projectFinish ?? res.projectFinish
  const a = res.activities.find(x => x.activityId === code)
  if (!a) return res.cpm?.projectFinish ?? res.projectFinish
  return a.actualFinish || a.earlyFinish
}

/** Round averaged parts to whole days that still add up to `total` (largest remainder). */
function roundToTotal(parts: number[], total: number): number[] {
  const fl = parts.map(Math.floor)
  let rest = total - fl.reduce((t, x) => t + x, 0)
  const order = parts.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i)
  const out = [...fl]
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i]++
  for (let k = order.length - 1; rest < 0 && k >= 0; k--, rest++) out[order[k].i]--
  return out
}

function relsInto(u: WindowUpdate, codeOf: Map<string, string>, code: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of u.relationships) if (codeOf.get(r.successorId) === code) m.set(`${codeOf.get(r.predecessorId)} ${r.type}`, r.lag)
  return m
}

/** What changed on one driving-path activity between the two updates. */
function driverChanges(P: Pair, code: string, e0: Map<string, Activity>): DriverChange[] {
  const { E, L } = P
  const e = P.eBy.get(code), l = P.lBy.get(code)
  if (!l) return []
  if (!e) return [{ kind: 'added', detail: 'added in the later update' }]
  const out: DriverChange[] = []
  const notStarted = !l.actualStart && l.status !== 'in_progress' && l.status !== 'complete'
  if (notStarted && Math.round(e.duration) !== Math.round(l.duration)) {
    out.push({ kind: 'duration', delta: Math.round(l.duration - e.duration), detail: `original duration ${e.duration} → ${l.duration} wd` })
  }
  if (l.status === 'in_progress' && e.status === 'in_progress' && Math.round(e.remainingDuration) !== Math.round(l.remainingDuration)) {
    out.push({ kind: 'remaining', delta: Math.round(l.remainingDuration - e.remainingDuration), detail: `remaining duration ${e.remainingDuration} → ${l.remainingDuration} wd` })
  }
  // Progress shortfall against the earlier update's forecast at the later data date.
  const f = e0.get(code), dd = L.schedule.dataDate
  const fs = f ? (f.actualStart || f.earlyStart) : null, ff = f ? (f.actualFinish || f.earlyFinish) : null
  if (dd) {
    if (!l.actualStart && l.status === 'not_started' && fs && fs.slice(0, 10) < dd.slice(0, 10)) out.push({ kind: 'progress', detail: `forecast to start ${fmtDate(fs)} but not started by the data date ${fmtDate(dd)}` })
    else if (!l.actualFinish && l.status !== 'complete' && ff && ff.slice(0, 10) < dd.slice(0, 10)) out.push({ kind: 'progress', detail: `forecast to finish ${fmtDate(ff)} but still open at the data date ${fmtDate(dd)} (${l.remainingDuration} wd remaining)` })
    else if (l.actualFinish && ff && l.actualFinish.slice(0, 10) > ff.slice(0, 10)) out.push({ kind: 'progress', detail: `finished ${fmtDate(l.actualFinish)}, forecast ${fmtDate(ff)}` })
    else if (l.actualStart && !e.actualStart && fs && l.actualStart.slice(0, 10) > fs.slice(0, 10)) out.push({ kind: 'progress', detail: `started ${fmtDate(l.actualStart)}, forecast ${fmtDate(fs)}` })
  }
  const bi = relsInto(E, P.eCode, code), ai = relsInto(L, P.lCode, code)
  const lg: string[] = []
  for (const [k, lag] of ai) if (!bi.has(k)) lg.push(`+${k}${lag ? ` lag ${lag}` : ''}`); else if (bi.get(k) !== lag) lg.push(`lag ${k} ${bi.get(k)} → ${lag}`)
  for (const [k] of bi) if (!ai.has(k)) lg.push(`−${k}`)
  if (lg.length) out.push({ kind: 'logic', detail: `predecessors ${lg.slice(0, 4).join(', ')}${lg.length > 4 ? ` and ${lg.length - 4} more` : ''}` })
  const ck = (a: Activity) => (a.constraintType ? `${a.constraintType} ${a.constraintDate ? fmtDate(a.constraintDate) : ''}`.trim() : 'none')
  if (ck(e) !== ck(l)) out.push({ kind: 'constraint', detail: `constraint ${ck(e)} → ${ck(l)}` })
  const cn = (u: WindowUpdate, a: Activity) => (u.schedule.calendars || []).find(c => c.id === (a.calendarId || u.schedule.defaultCalendarId))?.name ?? String(a.calendarId ?? '')
  if (calKey(cn(E, e)) !== calKey(cn(L, l))) out.push({ kind: 'calendar', detail: `calendar "${cn(E, e)}" → "${cn(L, l)}"` })
  return out
}

const pathCodes = (res: CompletionResult, code: string | null): string[] => {
  const ids = res.cpm?.longestPath ?? []
  const codes = ids.map(id => id.replace(/^c:/, ''))
  if (code) { const i = codes.indexOf(code); if (i >= 0) return codes.slice(0, i + 1) }
  return codes
}

/** One window: the earlier and later update of a consecutive pair. */
export function analyzeWindow(E: WindowUpdate, L: WindowUpdate, index = 1, finishCode?: string | null): WindowRow {
  const eCodes = new Set(E.activities.filter(isWork).map(a => a.activityId))
  const lCodes = new Set(L.activities.filter(isWork).map(a => a.activityId))
  const want = finishCode !== undefined ? finishCode : (L.analysis.finishMilestone?.code ?? E.analysis.finishMilestone?.code ?? null)
  const code = want && eCodes.has(want) && lCodes.has(want) ? want : null
  const notes: string[] = []
  if (want && !code) notes.push(`${want} is not in both updates, so the project forecast finish is measured instead.`)
  const P = makePair(E, L, code)

  const eMode = E.analysis.progressMode ?? 'retained', lMode = L.analysis.progressMode ?? 'retained'
  if (eMode !== lMode) notes.push(`The progress mode changed (${eMode} → ${lMode}); its effect is included in progress.`)
  const base: Mix = { progress: 'E', members: 'E', logic: 'E', dur: 'E', cstr: 'E', cal: 'E', mode: eMode }
  const half: Mix = { ...base, progress: 'L', mode: lMode }
  const cache = new Map<string, Step>()
  const run = (m: Mix, basis: Basis = 'logic') => {
    const k = `${basis}|${JSON.stringify(m)}`
    if (!cache.has(k)) cache.set(k, recalc(P, m, basis))
    return cache.get(k)!
  }
  const at = (m: Mix) => finishOf(run(m).res, code)
  const f0 = at(base), fH = at(half)
  const deltas = (order: readonly Factor[]) => {
    const out = {} as Record<Factor, number | null>
    let cur = half, prev = fH
    for (const f of order) {
      cur = { ...cur, [f]: 'L' }
      const next = at(cur)
      out[f] = calDays(prev, next)
      prev = next
    }
    return { out, final: cur }
  }
  const fwd = deltas(FACTORS), rev = deltas([...FACTORS].reverse())
  const finalMix = fwd.final
  const fL = at(finalMix)
  const movement = calDays(f0, fL)
  const progress = calDays(f0, fH)
  let attribution: WindowAttribution | null = null
  if (movement != null && progress != null && FACTORS.every(f => fwd.out[f] != null && rev.out[f] != null)) {
    const avg = FACTORS.map(f => (fwd.out[f]! + rev.out[f]!) / 2)
    const [members, logic, dur, cstr, cal] = roundToTotal(avg, movement - progress)
    attribution = { progress, addedDeleted: members, revisions: { logic, durations: dur, constraints: cstr, calendars: cal, total: logic + dur + cstr + cal }, method: 'symmetric' }
    const parts = [progress, members, logic, dur, cstr, cal]
    const gross = parts.reduce((t, x) => t + Math.abs(x), 0)
    if (gross > 2 * Math.abs(movement) + 10) notes.push(`Changes in this window partly offset each other (${gross} calendar days of gross effect for a net movement of ${movement}).`)
  } else notes.push('The finish could not be measured in every step (no logic or no dates), so the movement is not attributed.')

  // As scheduled: mandatory constraints honored, as in the activity dates.
  const hasMandatory = [...P.eBy.values(), ...P.lBy.values()].some(a => isMandatory(a.constraintType))
  const sE = hasMandatory ? run(base, 'scheduled') : run(base)
  const sL = hasMandatory ? run(finalMix, 'scheduled') : run(finalMix)
  const asScheduled = { before: finishOf(sE.res, code), after: finishOf(sL.res, code), movement: null as number | null }
  asScheduled.movement = calDays(asScheduled.before, asScheduled.after)

  // Activity-level attribution along the later logic-driven driving path.
  const e0 = run(base).res, l1 = run(finalMix)
  const e0By = new Map(e0.activities.map(a => [a.activityId, a]))
  const l1By = new Map(l1.res.activities.map(a => [a.activityId, a]))
  const after = pathCodes(l1.res, code), before = pathCodes(e0, code)
  const fin = (a: Activity | undefined) => (a ? a.actualFinish || a.earlyFinish : null)
  const calOf = (a: Activity | undefined) => l1.calendars.find(c => c.id === (a?.calendarId || l1.defaultCalendarId)) ?? l1.calendars[0] ?? defaultCalendar()

  // Mandatory constraints on the driving path that overrule logic (as scheduled).
  const hidden: HiddenDelay[] = []
  if (hasMandatory) {
    const onPath = new Set(after)
    const vBefore = new Map((sE.res.cpm?.violations ?? []).map(v => [v.id.replace(/^c:/, ''), v]))
    for (const v of sL.res.cpm?.violations ?? []) {
      const c = v.id.replace(/^c:/, '')
      if (!onPath.has(c) && c !== code) continue
      const daysBefore = vBefore.get(c)?.days ?? 0
      hidden.push({ code: c, type: v.type, constraintDate: v.constraintDate, logicDate: v.logicDate, days: v.days, daysBefore,
        text: `${v.days} wd hidden by ${v.type} on ${c} (logic ${fmtDate(v.logicDate)} vs ${fmtDate(v.constraintDate)}${daysBefore ? `; ${daysBefore} wd in the earlier update` : ''})` })
    }
  }
  const hiddenAt = new Set(hidden.map(h => h.code))

  const drivers: WindowDriver[] = []
  let sum = 0
  let prev: { b: string; f: string } | null = null
  after.forEach((c, i) => {
    const la = l1By.get(c)
    const f = fin(la)
    if (!f) return
    const b = fin(e0By.get(c)) ?? (prev ? prev.b : f)
    const cd = (calDays(b, f) ?? 0) - (prev ? calDays(prev.b, prev.f) ?? 0 : 0)
    const cal = calOf(la)
    const wd = workDaysBetween(b, f, cal) - (prev ? workDaysBetween(prev.b, prev.f, cal) : 0)
    prev = { b, f }
    sum += cd
    if (!cd) return
    const by = after.slice(i).find(x => hiddenAt.has(x)) ?? null
    drivers.push({ code: c, name: P.lBy.get(c)?.name ?? c, days: cd, workDays: wd, before: fin(e0By.get(c)), after: f, changes: driverChanges(P, c, e0By), hiddenBy: by })
  })
  const unattributed = movement != null ? movement - sum : 0
  if (unattributed && movement != null) notes.push(`${unattributed} calendar days of the movement are not explained along the driving path (it does not end at the measured finish).`)

  // What changed, for context (counts only; compare.ts has the detail).
  const calName = (u: WindowUpdate, a: Activity) => calKey((u.schedule.calendars || []).find(c => c.id === (a.calendarId || u.schedule.defaultCalendarId))?.name ?? String(a.calendarId ?? ''))
  let durationsChanged = 0, constraintsChanged = 0, calendarsChanged = 0
  for (const [c, l] of P.lBy) {
    const e = P.eBy.get(c)
    if (!e) continue
    if (l.status === 'not_started' && Math.round(e.duration) !== Math.round(l.duration)) durationsChanged++
    if ((e.constraintType ?? null) !== (l.constraintType ?? null) || (e.constraintDate ?? null) !== (l.constraintDate ?? null)) constraintsChanged++
    if (calName(E, e) !== calName(L, l)) calendarsChanged++
  }
  const relKeys = (u: WindowUpdate) => {
    const codeOf = new Map(u.activities.map(a => [a.id, a.activityId]))
    return new Set(u.relationships.map(r => `${codeOf.get(r.predecessorId)}→${codeOf.get(r.successorId)}|${r.type}|${r.lag}`))
  }
  const eRel = relKeys(E), lRel = relKeys(L)
  const logicChanged = [...lRel].filter(k => !eRel.has(k)).length + [...eRel].filter(k => !lRel.has(k)).length
  if (E.schedule.dataDate && L.schedule.dataDate) {
    if (E.schedule.dataDate === L.schedule.dataDate) notes.push('Both updates have the same data date: this window compares a reissue (a revision of the same period), not two periods.')
    else if (E.schedule.dataDate > L.schedule.dataDate) notes.push('The later update does not have a later data date; check the order of the series.')
  }
  if (P.lBridge.size || P.eBridge.size) notes.push(`${P.lBridge.size + P.eBridge.size} relationship${P.lBridge.size + P.eBridge.size === 1 ? '' : 's'} replacing added or deleted activities ${P.lBridge.size + P.eBridge.size === 1 ? 'is' : 'are'} counted with added/deleted activities, not logic.`)
  if (attribution && attribution.revisions.total !== 0) notes.push('Revisions are attributed symmetrically: the average of their effect applied in the order scope, logic, durations, constraints, calendars and in the reverse order.')
  if (movement != null && asScheduled.movement != null && asScheduled.movement !== movement) {
    notes.push(`As scheduled (mandatory constraints honored) the finish moved ${asScheduled.movement} calendar days; the logic-driven finish moved ${movement}.`)
  }
  for (const h of hidden) notes.push(`${h.text}.`)

  const lf = code ? L.activities.find(a => a.activityId === code) : null
  return {
    window: index,
    before: { id: E.schedule.id, version: E.schedule.version, dataDate: E.schedule.dataDate, finish: f0 },
    after: { id: L.schedule.id, version: L.schedule.version, dataDate: L.schedule.dataDate, finish: fL },
    finishCode: code, movement, asScheduled, attribution, halfStepFinish: fH,
    drivingPath: { before: pathEnds(E), after: pathEnds(L) },
    logicPath: { before, after },
    drivers, unattributed, hidden,
    finishFloat: lf && !lf.actualFinish ? lf.totalFloat : null,
    counts: {
      added: [...lCodes].filter(c => !eCodes.has(c)).length, deleted: [...eCodes].filter(c => !lCodes.has(c)).length,
      logicChanged, durationsChanged, constraintsChanged, calendarsChanged,
    },
    notes,
  }
}

/** Per-update trend: finish milestone float (driving-path float), lowest float, BEI and missed tasks. */
export function seriesTrend(updates: WindowUpdate[], finishCode: string | null): TrendRow[] {
  return updates.map(u => {
    const code = finishCode ?? u.analysis.finishMilestone?.code ?? null
    const fm = code ? u.activities.find(a => a.activityId === code) : undefined
    const ex = baselineExecution(
      u.activities.filter(isWork).map(a => ({ id: a.id, code: a.activityId, name: a.name, type: a.activityType, duration: a.duration, status: a.status, percentComplete: a.percentComplete, actualStart: a.actualStart, actualFinish: a.actualFinish, baselineStart: a.baselineStart, baselineFinish: a.baselineFinish })),
      u.schedule.dataDate,
    )
    const forecast = fm && u.analysis.finishMilestone?.code === fm.activityId ? u.analysis.finishMilestone.forecastFinish : fm ? (fm.actualFinish || fm.earlyFinish) : u.analysis.forecastFinish
    return {
      id: u.schedule.id, version: u.schedule.version, dataDate: u.schedule.dataDate, finishCode: fm ? fm.activityId : null,
      forecastFinish: forecast ?? null, finishFloat: fm && !fm.actualFinish ? fm.totalFloat : null,
      minFloat: u.analysis.minFloat ?? null, negativeFloatCount: u.analysis.negativeFloatCount ?? 0,
      bei: ex ? Math.round(ex.bei * 100) / 100 : null, missed: ex ? ex.missed : null, due: ex ? ex.due : null,
    }
  })
}

/**
 * Group an ordered series by data date. A reissue (another upload with the same data date) is a
 * revision of the same period and supersedes the earlier upload: the latest upload of each data date
 * is analyzed, unless includeReissues keeps them all.
 */
export function seriesPeriods<T extends { schedule: { id: string; version: string; dataDate: string | null } }>(updates: T[], includeReissues = false): { used: T[]; periods: SeriesPeriod[] } {
  const periods: SeriesPeriod[] = []
  const used: T[] = []
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i], dd = u.schedule.dataDate
    const p = dd != null && periods.length && periods[periods.length - 1].dataDate === dd ? periods[periods.length - 1] : null
    const period = p ?? { dataDate: dd, uploads: 0, analyzed: [], superseded: [] }
    if (!p) periods.push(period)
    period.uploads++
    const next = updates[i + 1]
    const reissued = dd != null && next?.schedule.dataDate === dd
    if (reissued && !includeReissues) { period.superseded.push({ id: u.schedule.id, version: u.schedule.version }); continue }
    period.analyzed.push({ id: u.schedule.id, version: u.schedule.version })
    used.push(u)
  }
  return { used, periods }
}

/** Windows over an update series already ordered by data date (see orderSeries in compare.ts). */
export function analyzeWindows(series: WindowUpdate[], opts: { includeReissues?: boolean } = {}): WindowsAnalysis {
  const { used: updates, periods } = seriesPeriods(series, !!opts.includeReissues)
  const last = updates[updates.length - 1]
  const fm = last?.analysis.finishMilestone ?? updates.find(u => u.analysis.finishMilestone)?.analysis.finishMilestone ?? null
  const finishCode = fm?.code ?? null
  const windows: WindowRow[] = []
  for (let i = 1; i < updates.length; i++) windows.push(analyzeWindow(updates[i - 1], updates[i], i, finishCode))
  const notes: string[] = []
  for (const p of periods) {
    if (p.superseded.length) notes.push(`${p.uploads} uploads have the data date ${fmtDate(p.dataDate)}; ${p.superseded.map(x => x.version).join(', ')} ${p.superseded.length === 1 ? 'is' : 'are'} superseded by the reissue ${p.analyzed.map(x => x.version).join(', ')} and left out of the windows.`)
    else if (p.uploads > 1) notes.push(`${p.uploads} uploads have the data date ${fmtDate(p.dataDate)}; reissues are included, so a window compares revisions of the same period.`)
  }
  if (updates.length < 2) notes.push('A windows analysis needs at least two updates of the project (with different data dates).')
  notes.push('Movement and attribution are in calendar days (+ = later) of the logic-driven finish (mandatory constraints cannot hide delay), from Planora\'s recalculation of each step; the as-scheduled movement is shown next to it; float and hidden delay are in work days.')
  notes.push('Attribution: progress first (half-step), then scope (added/deleted activities with the links that replace them), logic, durations, constraints and calendars, each credited with the average of its effect applied forward and in reverse order; the parts add up to the movement. Activity-level drivers telescope along the later driving path.')
  return { finishCode, finishName: fm?.name ?? null, windows, trend: seriesTrend(updates, finishCode), series: periods, notes }
}

const signed = (n: number | null | undefined) => (n == null ? '' : n > 0 ? `+${n}` : String(n))
const ends = (p: PathEnds) => `${p.start?.code ?? '—'} → ${p.end?.code ?? '—'}`
const driverText = (d: WindowDriver) => `${d.code} ${signed(d.days)} cd${d.workDays != null ? ` (${signed(d.workDays)} wd)` : ''}${d.changes.length ? `: ${d.changes.map(c => c.detail).join('; ')}` : ''}${d.hiddenBy ? ` [hidden by ${d.hiddenBy}]` : ''}`

/** Flat rows for CSV / XLSX (dates ISO; callers format them). */
export function windowsTableRows(w: WindowsAnalysis): Record<string, string | number | null>[] {
  return w.windows.map(x => ({
    window: x.window, before: x.before.version, beforeDataDate: x.before.dataDate, after: x.after.version, afterDataDate: x.after.dataDate,
    finishCode: x.finishCode ?? 'project finish', beforeFinish: x.before.finish, halfStepFinish: x.halfStepFinish, afterFinish: x.after.finish,
    movement: x.movement, asScheduledMovement: x.asScheduled.movement, progress: x.attribution?.progress ?? null, addedDeleted: x.attribution?.addedDeleted ?? null,
    logic: x.attribution?.revisions.logic ?? null, durations: x.attribution?.revisions.durations ?? null,
    constraints: x.attribution?.revisions.constraints ?? null, calendars: x.attribution?.revisions.calendars ?? null,
    revisions: x.attribution?.revisions.total ?? null,
    hidden: x.hidden.map(h => h.text).join('; '),
    drivers: [...x.drivers.map(driverText), ...(x.unattributed ? [`unattributed ${signed(x.unattributed)} cd`] : [])].join(' | '),
    drivingBefore: ends(x.drivingPath.before), drivingAfter: ends(x.drivingPath.after),
    logicPathBefore: x.logicPath.before.join(' → '), logicPathAfter: x.logicPath.after.join(' → '), finishFloat: x.finishFloat,
    notes: x.notes.join(' '),
  }))
}

/** One row per driving-path activity that accounts for movement (XLSX "Drivers" sheet). */
export function windowDriverRows(w: WindowsAnalysis): Record<string, string | number | null>[] {
  return w.windows.flatMap(x => [
    ...x.drivers.map(d => ({ window: x.window, after: x.after.version, code: d.code, name: d.name, days: d.days, workDays: d.workDays, before: d.before, afterFinish: d.after, changes: d.changes.map(c => c.detail).join('; '), hiddenBy: d.hiddenBy ?? '' })),
    ...(x.unattributed ? [{ window: x.window, after: x.after.version, code: '', name: 'Not explained along the driving path', days: x.unattributed, workDays: null, before: null, afterFinish: null, changes: '', hiddenBy: '' }] : []),
  ])
}

export const WINDOWS_COLUMNS: { key: string; label: string; date?: boolean }[] = [
  { key: 'window', label: 'Window' }, { key: 'before', label: 'Earlier update' }, { key: 'beforeDataDate', label: 'Earlier data date', date: true },
  { key: 'after', label: 'Later update' }, { key: 'afterDataDate', label: 'Later data date', date: true }, { key: 'finishCode', label: 'Finish measured on' },
  { key: 'beforeFinish', label: 'Earlier finish (logic)', date: true }, { key: 'halfStepFinish', label: 'Half-step finish', date: true }, { key: 'afterFinish', label: 'Later finish (logic)', date: true },
  { key: 'movement', label: 'Movement, logic-driven (cd)' }, { key: 'asScheduledMovement', label: 'Movement as scheduled (cd)' },
  { key: 'progress', label: 'Progress (cd)' }, { key: 'addedDeleted', label: 'Added/deleted activities (cd)' },
  { key: 'logic', label: 'Revision: logic (cd)' }, { key: 'durations', label: 'Revision: durations (cd)' }, { key: 'constraints', label: 'Revision: constraints (cd)' },
  { key: 'calendars', label: 'Revision: calendars (cd)' }, { key: 'revisions', label: 'Revisions total (cd)' },
  { key: 'hidden', label: 'Delay hidden by mandatory constraints (wd)' }, { key: 'drivers', label: 'Driving activities (cd / wd)' },
  { key: 'drivingBefore', label: 'Driving path start → end (earlier)' }, { key: 'drivingAfter', label: 'Driving path start → end (later)' },
  { key: 'logicPathBefore', label: 'Logic-driven path (earlier)' }, { key: 'logicPathAfter', label: 'Logic-driven path (later)' },
  { key: 'finishFloat', label: 'Finish float, later (wd)' }, { key: 'notes', label: 'Notes' },
]

/** Markdown section for the variance report (dates via fmt, MM/DD/YYYY). */
export function windowsMarkdown(w: WindowsAnalysis, fmt: (d: string | null | undefined) => string): string[] {
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ')
  const table = (head: string[], rows: unknown[][]) => rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n') : '_None._'
  const out = [
    `Finish measured on ${w.finishCode ? `${w.finishCode}${w.finishName ? ` ${w.finishName}` : ''}` : 'the project forecast finish'} (logic-driven: mandatory constraints cannot hide delay). Each window applies the later update's progress to the earlier update's logic (half-step) and recalculates, then the later update's added/deleted activities (with the links that replace them), logic, durations, constraints and calendars, credited symmetrically (average of both orders).`, '',
    table(['#', 'Earlier (data date)', 'Later (data date)', 'Finish before → after', 'Movement (cd)', 'As scheduled (cd)', 'Progress', 'Added/deleted', 'Logic', 'Durations', 'Constraints', 'Calendars', 'Driving path (later)'],
      w.windows.map(x => [x.window, `${x.before.version} (${fmt(x.before.dataDate)})`, `${x.after.version} (${fmt(x.after.dataDate)})`, `${fmt(x.before.finish)} → ${fmt(x.after.finish)}`,
        signed(x.movement), signed(x.asScheduled.movement), signed(x.attribution?.progress), signed(x.attribution?.addedDeleted), signed(x.attribution?.revisions.logic), signed(x.attribution?.revisions.durations),
        signed(x.attribution?.revisions.constraints), signed(x.attribution?.revisions.calendars), ends(x.drivingPath.after)])),
  ]
  const drv = w.windows.filter(x => x.drivers.length || x.unattributed)
  if (drv.length) {
    out.push('', 'Driving activities (calendar days; work days on the activity\'s calendar):', '')
    for (const x of drv) out.push(`- Window ${x.window}: ${[...x.drivers.map(driverText), ...(x.unattributed ? [`unattributed ${signed(x.unattributed)} cd`] : [])].join('; ')}`)
  }
  const notes = w.windows.flatMap(x => x.notes.map(n => `- Window ${x.window}: ${n}`))
  if (notes.length) out.push('', ...notes)
  return out
}

/** Markdown table: finish float, lowest float, BEI and missed tasks per update. */
export function trendMarkdown(rows: TrendRow[], fmt: (d: string | null | undefined) => string): string[] {
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ')
  if (!rows.length) return ['_None._']
  const head = ['Update', 'Data date', 'Finish forecast', 'Finish float (wd)', 'Lowest float (wd)', 'Negative-float activities', 'BEI', 'Missed tasks']
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${[r.version, fmt(r.dataDate), fmt(r.forecastFinish), r.finishFloat, r.minFloat, r.negativeFloatCount, r.bei == null ? 'n/a' : r.bei.toFixed(2), r.missed == null ? 'n/a' : `${r.missed} of ${r.due}`].map(cell).join(' | ')} |`)]
}
