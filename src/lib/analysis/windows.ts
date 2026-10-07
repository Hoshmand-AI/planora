// Windows analysis of an update series (forensic / owner-side delay review). For every consecutive
// pair of updates (ordered by data date) it reports how far the finish milestone moved and splits
// the movement into causes with a stepped "half-step" recalculation on Planora's own CPM:
//
//   E0  the earlier update as submitted (its logic, durations, constraints, calendars and progress)
//   H1  half-step: the earlier update's network with the LATER update's progress (actual dates,
//       status, remaining durations of in-progress work) at the later data date      → progress
//   H2  + activities added / deleted in the later update (with their logic)            → added/deleted
//   H3  + the later update's logic (relationships and lags between matched activities) → revision: logic
//   H4  + the later update's original durations of work not yet started               → revision: durations
//   H5  + the later update's constraints                                               → revision: constraints
//   H6  + the later update's calendars (definitions and assignments) = the later update → revision: calendars
//
// Each step's effect is the calendar-day change of the finish milestone's forecast between steps,
// so the parts add up to the total movement exactly. Revisions are applied in the fixed order above;
// where two revisions interact the overlap is credited to the one applied first (stated in notes).
// Activities are matched by activity ID and calendars by name, as in compare.ts. Pure: unit tested.

import type { Activity, Relationship, Schedule } from '@/lib/db'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import type { ProgressMode, WorkCalendar } from '@/lib/planning/types'
import { completeSchedule, type CompletionResult } from '@/lib/planning/complete-schedule'
import { baselineExecution, roundIndex } from '@/lib/analysis/dcma'

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
  /** Activities added or deleted in the later update (with their logic) */
  addedDeleted: number
  revisions: {
    logic: number
    /** Original durations of work not started in the later update */
    durations: number
    constraints: number
    calendars: number
    total: number
  }
}

export interface WindowRow {
  window: number
  before: { id: string; version: string; dataDate: string | null; finish: string | null }
  after: { id: string; version: string; dataDate: string | null; finish: string | null }
  /** Activity whose finish is measured (null: project forecast finish) */
  finishCode: string | null
  /** Calendar days the measured finish moved (+ = later), from Planora's recalculation */
  movement: number | null
  attribution: WindowAttribution | null
  /** The half-step finish: the earlier network with the later progress */
  halfStepFinish: string | null
  drivingPath: { before: PathEnds; after: PathEnds }
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

export interface WindowsAnalysis {
  finishCode: string | null
  finishName: string | null
  windows: WindowRow[]
  trend: TrendRow[]
  notes: string[]
}

const DAY = 86_400_000
const calDays = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY) : null)
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'
const calKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')
type Side = 'E' | 'L'

interface Mix { progress: Side; members: Side; logic: Side; dur: Side; cstr: Side; cal: Side; mode: ProgressMode }

function pathEnds(u: WindowUpdate): PathEnds {
  const byId = new Map(u.activities.map(a => [a.id, a]))
  const open = u.analysis.longestPath.map(id => byId.get(id)).filter((a): a is Activity => !!a && !a.actualFinish && a.status !== 'complete')
  const pick = (a: Activity | undefined) => (a ? { code: a.activityId, name: a.name } : null)
  return { start: pick(open[0]), end: pick(open[open.length - 1]) }
}

/** Build the hybrid network for one step (see header), activities keyed by code. */
function hybrid(E: WindowUpdate, L: WindowUpdate, o: Mix) {
  const eBy = new Map(E.activities.filter(isWork).map(a => [a.activityId, a]))
  const lBy = new Map(L.activities.filter(isWork).map(a => [a.activityId, a]))
  const codes = [...(o.members === 'E' ? eBy : lBy).keys()]
  const set = new Set(codes)
  const pick = (code: string, s: Side) => (s === 'L' ? lBy.get(code) ?? eBy.get(code) : eBy.get(code) ?? lBy.get(code))!
  const sideOf = (code: string, s: Side): Side => (s === 'L' ? (lBy.has(code) ? 'L' : 'E') : (eBy.has(code) ? 'E' : 'L'))

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
    return {
      ...d, id: `c:${code}`, scheduleId: 'windows',
      actualStart: p.actualStart, actualFinish: p.actualFinish, status: p.status, percentComplete: p.percentComplete,
      remainingDuration: p.status === 'in_progress' ? p.remainingDuration : d.duration,
      constraintType: k.constraintType ?? null, constraintDate: k.constraintDate ?? null,
      calendarId: calRef(c, cs),
      earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, totalFloat: 0, freeFloat: 0, isCritical: false,
    }
  })

  const codeOf = (u: WindowUpdate) => new Map(u.activities.map(a => [a.id, a.activityId]))
  const eCode = codeOf(E), lCode = codeOf(L)
  const rels: Relationship[] = []
  const seen = new Set<string>()
  const addRels = (u: WindowUpdate, codeMap: Map<string, string>, keep: (p: string, s: string) => boolean) => {
    for (const r of u.relationships) {
      const p = codeMap.get(r.predecessorId), s = codeMap.get(r.successorId)
      if (!p || !s || !set.has(p) || !set.has(s) || !keep(p, s)) continue
      const key = `${p}→${s}|${r.type}`
      if (seen.has(key)) continue
      seen.add(key)
      rels.push({ id: `r${rels.length}`, scheduleId: 'windows', predecessorId: `c:${p}`, successorId: `c:${s}`, type: r.type, lag: r.lag })
    }
  }
  const onlyL = (c: string) => lBy.has(c) && !eBy.has(c)
  const onlyE = (c: string) => eBy.has(c) && !lBy.has(c)
  if (o.logic === 'E') {
    addRels(E, eCode, () => true)
    addRels(L, lCode, (p, s) => onlyL(p) || onlyL(s)) // logic of added activities comes with them
  } else {
    addRels(L, lCode, () => true)
    addRels(E, eCode, (p, s) => onlyE(p) || onlyE(s))
  }

  const u = o.progress === 'L' ? L : E
  const starts = [E.schedule.projectStart, L.schedule.projectStart].filter((x): x is string => !!x).sort()
  return {
    activities, relationships: rels, calendars: cals, defaultCalendarId: target.schedule.defaultCalendarId,
    projectStart: starts[0] ?? u.schedule.dataDate, dataDate: u.schedule.dataDate, progressMode: o.mode,
  }
}

function finishOf(res: CompletionResult, code: string | null): string | null {
  if (!code) return res.projectFinish
  const a = res.activities.find(x => x.activityId === code)
  if (!a) return res.projectFinish
  if (a.actualFinish) return a.actualFinish
  // As the headline variance: where a mandatory constraint pins the date, the forecast is logic's.
  const v = res.cpm?.violations.find(x => x.id === a.id && (x.type === 'MFO' || a.activityType === 'milestone'))
  return v ? v.logicDate : a.earlyFinish
}

function recalc(E: WindowUpdate, L: WindowUpdate, o: Mix): CompletionResult {
  const h = hybrid(E, L, o)
  return completeSchedule({
    activities: h.activities, relationships: h.relationships, calendars: h.calendars, defaultCalendarId: h.defaultCalendarId,
    projectStart: h.projectStart, projectFinish: null, dataDate: h.dataDate, progressMode: h.progressMode,
  })
}

/** One window: the earlier and later update of a consecutive pair. */
export function analyzeWindow(E: WindowUpdate, L: WindowUpdate, index = 1, finishCode?: string | null): WindowRow {
  const eCodes = new Set(E.activities.filter(isWork).map(a => a.activityId))
  const lCodes = new Set(L.activities.filter(isWork).map(a => a.activityId))
  const want = finishCode !== undefined ? finishCode : (L.analysis.finishMilestone?.code ?? E.analysis.finishMilestone?.code ?? null)
  const code = want && eCodes.has(want) && lCodes.has(want) ? want : null
  const notes: string[] = []
  if (want && !code) notes.push(`${want} is not in both updates, so the project forecast finish is measured instead.`)

  const eMode = E.analysis.progressMode ?? 'retained', lMode = L.analysis.progressMode ?? 'retained'
  if (eMode !== lMode) notes.push(`The progress mode changed (${eMode} → ${lMode}); its effect is included in progress.`)
  const base: Mix = { progress: 'E', members: 'E', logic: 'E', dur: 'E', cstr: 'E', cal: 'E', mode: eMode }
  const steps: Mix[] = [
    base,
    { ...base, progress: 'L', mode: lMode },
    { ...base, progress: 'L', mode: lMode, members: 'L' },
    { ...base, progress: 'L', mode: lMode, members: 'L', logic: 'L' },
    { ...base, progress: 'L', mode: lMode, members: 'L', logic: 'L', dur: 'L' },
    { ...base, progress: 'L', mode: lMode, members: 'L', logic: 'L', dur: 'L', cstr: 'L' },
    { progress: 'L', mode: lMode, members: 'L', logic: 'L', dur: 'L', cstr: 'L', cal: 'L' },
  ]
  const finishes = steps.map(s => finishOf(recalc(E, L, s), code))
  const delta = (i: number) => calDays(finishes[i - 1], finishes[i])
  const parts = [1, 2, 3, 4, 5, 6].map(delta)
  const movement = calDays(finishes[0], finishes[6])
  const attribution: WindowAttribution | null = parts.every(x => x != null)
    ? {
        progress: parts[0]!, addedDeleted: parts[1]!,
        revisions: { logic: parts[2]!, durations: parts[3]!, constraints: parts[4]!, calendars: parts[5]!, total: parts[2]! + parts[3]! + parts[4]! + parts[5]! },
      }
    : null
  if (!attribution) notes.push('The finish could not be measured in every step (no logic or no dates), so the movement is not attributed.')

  // What changed, for context (counts only; compare.ts has the detail).
  const eBy = new Map(E.activities.filter(isWork).map(a => [a.activityId, a]))
  const lBy = new Map(L.activities.filter(isWork).map(a => [a.activityId, a]))
  const calName = (u: WindowUpdate, a: Activity) => calKey((u.schedule.calendars || []).find(c => c.id === (a.calendarId || u.schedule.defaultCalendarId))?.name ?? String(a.calendarId ?? ''))
  let durationsChanged = 0, constraintsChanged = 0, calendarsChanged = 0
  for (const [c, l] of lBy) {
    const e = eBy.get(c)
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
  if (E.schedule.dataDate && L.schedule.dataDate && E.schedule.dataDate >= L.schedule.dataDate) notes.push('The later update does not have a later data date; check the order of the series.')
  if (attribution && attribution.revisions.total !== 0) notes.push('Revisions are applied in the order logic, durations, constraints, calendars; interacting revisions are credited to the first applied.')

  const fmOf = (u: WindowUpdate) => (code ? u.activities.find(a => a.activityId === code) : null)
  const lf = fmOf(L)
  return {
    window: index,
    before: { id: E.schedule.id, version: E.schedule.version, dataDate: E.schedule.dataDate, finish: finishes[0] },
    after: { id: L.schedule.id, version: L.schedule.version, dataDate: L.schedule.dataDate, finish: finishes[6] },
    finishCode: code, movement, attribution, halfStepFinish: finishes[1],
    drivingPath: { before: pathEnds(E), after: pathEnds(L) },
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
      bei: ex ? roundIndex(ex.bei) : null, missed: ex ? ex.missed : null, due: ex ? ex.due : null,
    }
  })
}

/** Windows over an update series already ordered by data date (see orderSeries in compare.ts). */
export function analyzeWindows(updates: WindowUpdate[]): WindowsAnalysis {
  const last = updates[updates.length - 1]
  const fm = last?.analysis.finishMilestone ?? updates.find(u => u.analysis.finishMilestone)?.analysis.finishMilestone ?? null
  const finishCode = fm?.code ?? null
  const windows: WindowRow[] = []
  for (let i = 1; i < updates.length; i++) windows.push(analyzeWindow(updates[i - 1], updates[i], i, finishCode))
  const notes: string[] = []
  if (updates.length < 2) notes.push('A windows analysis needs at least two updates of the project.')
  notes.push('Movement and attribution are in calendar days (+ = later) of the finish milestone forecast, from Planora\'s recalculation of each step; float is in work days.')
  return { finishCode, finishName: fm?.name ?? null, windows, trend: seriesTrend(updates, finishCode), notes }
}

const signed = (n: number | null | undefined) => (n == null ? '' : n > 0 ? `+${n}` : String(n))
const ends = (p: PathEnds) => `${p.start?.code ?? '—'} → ${p.end?.code ?? '—'}`

/** Flat rows for CSV / XLSX (dates ISO; callers format them). */
export function windowsTableRows(w: WindowsAnalysis): Record<string, string | number | null>[] {
  return w.windows.map(x => ({
    window: x.window, before: x.before.version, beforeDataDate: x.before.dataDate, after: x.after.version, afterDataDate: x.after.dataDate,
    finishCode: x.finishCode ?? 'project finish', beforeFinish: x.before.finish, halfStepFinish: x.halfStepFinish, afterFinish: x.after.finish,
    movement: x.movement, progress: x.attribution?.progress ?? null, addedDeleted: x.attribution?.addedDeleted ?? null,
    logic: x.attribution?.revisions.logic ?? null, durations: x.attribution?.revisions.durations ?? null,
    constraints: x.attribution?.revisions.constraints ?? null, calendars: x.attribution?.revisions.calendars ?? null,
    revisions: x.attribution?.revisions.total ?? null,
    drivingBefore: ends(x.drivingPath.before), drivingAfter: ends(x.drivingPath.after), finishFloat: x.finishFloat,
    notes: x.notes.join(' '),
  }))
}

export const WINDOWS_COLUMNS: { key: string; label: string; date?: boolean }[] = [
  { key: 'window', label: 'Window' }, { key: 'before', label: 'Earlier update' }, { key: 'beforeDataDate', label: 'Earlier data date', date: true },
  { key: 'after', label: 'Later update' }, { key: 'afterDataDate', label: 'Later data date', date: true }, { key: 'finishCode', label: 'Finish measured on' },
  { key: 'beforeFinish', label: 'Earlier finish', date: true }, { key: 'halfStepFinish', label: 'Half-step finish', date: true }, { key: 'afterFinish', label: 'Later finish', date: true },
  { key: 'movement', label: 'Movement (cd)' }, { key: 'progress', label: 'Progress (cd)' }, { key: 'addedDeleted', label: 'Added/deleted activities (cd)' },
  { key: 'logic', label: 'Revision: logic (cd)' }, { key: 'durations', label: 'Revision: durations (cd)' }, { key: 'constraints', label: 'Revision: constraints (cd)' },
  { key: 'calendars', label: 'Revision: calendars (cd)' }, { key: 'revisions', label: 'Revisions total (cd)' },
  { key: 'drivingBefore', label: 'Driving path start → end (earlier)' }, { key: 'drivingAfter', label: 'Driving path start → end (later)' },
  { key: 'finishFloat', label: 'Finish float, later (wd)' }, { key: 'notes', label: 'Notes' },
]

/** Markdown section for the variance report (dates via fmt, MM/DD/YYYY). */
export function windowsMarkdown(w: WindowsAnalysis, fmt: (d: string | null | undefined) => string): string[] {
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ')
  const table = (head: string[], rows: unknown[][]) => rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n') : '_None._'
  const out = [
    `Finish measured on ${w.finishCode ? `${w.finishCode}${w.finishName ? ` ${w.finishName}` : ''}` : 'the project forecast finish'}. Each window applies the later update's progress to the earlier update's logic (half-step) and recalculates, then applies the later update's added/deleted activities, logic, durations, constraints and calendars in turn.`, '',
    table(['#', 'Earlier (data date)', 'Later (data date)', 'Finish before → after', 'Movement (cd)', 'Progress', 'Added/deleted', 'Logic', 'Durations', 'Constraints', 'Calendars', 'Driving path (later)'],
      w.windows.map(x => [x.window, `${x.before.version} (${fmt(x.before.dataDate)})`, `${x.after.version} (${fmt(x.after.dataDate)})`, `${fmt(x.before.finish)} → ${fmt(x.after.finish)}`,
        signed(x.movement), signed(x.attribution?.progress), signed(x.attribution?.addedDeleted), signed(x.attribution?.revisions.logic), signed(x.attribution?.revisions.durations),
        signed(x.attribution?.revisions.constraints), signed(x.attribution?.revisions.calendars), ends(x.drivingPath.after)])),
  ]
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
