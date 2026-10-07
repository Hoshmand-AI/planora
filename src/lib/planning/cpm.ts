// Critical Path Method engine (multi-calendar, FS/SS/FF/SF with lags, progress, constraints).
//
// Time model
// ----------
// Internally every schedule event is an *instant* on a day boundary, as a UTC day number t:
// instant t = the start of day t = the end of day t-1. A task starting on day s and finishing on
// day f (inclusive, see calendar.ts) occupies the half-open interval [s, f+1). A milestone is a
// single instant. This makes every relationship a simple chronological comparison:
//   FS: succ.start >= shift(pred.finish, lag)     SS: succ.start  >= shift(pred.start, lag)
//   FF: succ.finish >= shift(pred.finish, lag)    SF: succ.finish >= shift(pred.start, lag)
// where shift() moves the instant by `lag` work days on the PREDECESSOR's calendar (P6's default
// scheduling option "Calendar for scheduling relationship lag = Predecessor activity calendar").
// With lag 0 an FS successor starts on the next work day after the predecessor's finish day.
//
// Milestones (P6 TT_Mile / TT_FinMile): activity.milestoneKind says which one it is. A start
// milestone occurs at the START of its day (the start of the next work day after its drivers), so
// an FS successor starts the same day. A finish milestone occurs at the END of its day (a finish
// milestone after a task finishing Friday shows Friday, and an FS successor of it starts Monday).
// Without milestoneKind, a milestone with no (valid) predecessors is a start milestone and any
// other milestone a finish milestone.
//
// Float convention
// ----------------
// totalFloat = min(start float, finish float), each measured in work days on the activity's own
// calendar (P6 "most critical"). In-progress activities use finish float only (their start is
// fixed). Completed activities get float 0 and are never critical. freeFloat = the minimum, over
// relationships to incomplete successors, of the work days (on the predecessor's calendar) the
// predecessor can slip before delaying the successor's early date; for activities without such
// successors it is measured to the project finish. Free float is clamped at >= 0.
//
// Backward pass anchor: mustFinishBy (if given; float may then be negative) else the project
// finish (latest early finish). Activities with no incomplete successors get LF = anchor.
// Relationships from a completed successor are ignored in the backward pass, as are FS/SS
// relationships into an in-progress successor (its start has already happened).
//
// Progress: actualFinish => complete (times = actuals). actualStart without actualFinish => in
// progress: ES = actualStart. Out-of-sequence work follows input.progressMode:
//   'retained' (default, as P6): the remaining work cannot resume until its FS/SS predecessors
//     allow it, so remaining = scheduled from max(dataDate, actualStart, logic).
//   'override': the remaining work continues from max(dataDate, actualStart), ignoring FS/SS logic.
// FF/SF predecessors can push the finish in both modes. A milestone with only actualStart is
// treated as complete on that date.
//
// Constraints: start constraints (SNET/SNLT/SO/MSO) are ignored once an activity has an actual start
// (as P6). SNET/FNET push early dates; SNLT/FNLT cap late dates; SO/FO (P6 Start On / Finish On)
// do both, so logic still drives the early date and a late predecessor shows negative float.
// MSO/MFO are mandatory (as P6): they fix the early dates (never earlier than the data date) and the
// late dates (on the constraint date, even one before the data date) against logic. The
// constrained activity's float comes from its own pinned dates (0 unless the date is in the past);
// the overrun shows as negative float on its predecessors, and each overruled constraint is
// reported in `violations`.
//
// Longest path: from the activity with the latest early finish, walk back through driving
// relationships regardless of float (P6 "longest path"). The walk stops at an activity whose date
// is set by a mandatory constraint rather than by logic (reported as longestPathConstraint);
// logicLongestPath / logicFinish give the path and finish logic alone would produce. The critical
// path is the TF <= 0 chain and can be empty when a required finish leaves positive float everywhere.

import type { CpmActivity, CpmInput, CpmLink, CpmLinkFloat, CpmResult, CpmTimes, WorkCalendar } from '@/lib/planning/types'
import { compileCalendar, defaultCalendar, fromDayNumber, toDayNumber, type CompiledCalendar } from '@/lib/planning/calendar'

interface Node {
  a: CpmActivity
  c: CompiledCalendar
  isMs: boolean
  startLike: boolean
  dur: number
  state: 'complete' | 'progress' | 'open'
  es: number
  ef: number
  ls: number
  lf: number
  /** display-as-start for finish milestones pinned at the data date */
  pinnedLow: boolean
  /** early start/finish instants logic alone would give, mandatory constraints ignored network-wide (differs only under MSO/MFO) */
  logicEs: number
  logicEf: number
  /** in-progress work: the instant the remaining duration resumes (scheduled / logic-only) */
  resume: number
  logicResume: number
  /** mandatory activity: early dates its (scheduled) predecessors would give it without the constraint */
  drvEs: number
  drvEf: number
  /** open activity with a valid MSO/MFO constraint */
  mand: boolean
  /** mandatory constraint: pinned early start/finish instants before data-date clamping (= late dates) */
  pinEs: number
  pinEf: number
  /**
   * mandatory activity: early dates its predecessors alone would give it (no data-date floor, no
   * constraint); NaN when it has no predecessors (nothing but the constraint and the data date drives it)
   */
  predEs: number
  predEf: number
  tf: number
  ff: number
}

interface Edge {
  from: number
  to: number
  type: CpmLink['type']
  lag: number
}

const INF = Number.POSITIVE_INFINITY
/** Constraints on an activity's start: P6 ignores them once the activity has an actual start. */
const START_CONSTRAINTS = new Set<string>(['SNET', 'SNLT', 'SO', 'MSO'])

/** Move an instant by `lag` work days on calendar c (see header). */
function shift(t: number, lag: number, c: CompiledCalendar): number {
  if (lag === 0) return t
  if (lag > 0) return c.add(c.next(t), lag - 1) + 1
  return c.add(c.prev(t - 1), lag + 1)
}

/** Signed work days between two instants on c: work days in [a, b) (negated if b < a). */
function wdInstants(a: number, b: number, c: CompiledCalendar): number {
  if (b >= a) return c.countInclusive(a, b - 1)
  return -c.countInclusive(b, a - 1)
}

function dateNum(d: string | null | undefined): number {
  if (!d) return NaN
  return toDayNumber(d)
}

export function runCpm(input: CpmInput): CpmResult {
  const warnings: string[] = []
  const cycles: string[][] = []

  /* ── calendars ── */
  const calById = new Map<string, WorkCalendar>()
  for (const cal of input.calendars ?? []) if (cal && !calById.has(cal.id)) calById.set(cal.id, cal)
  const fallbackCal: WorkCalendar =
    (input.defaultCalendarId && calById.get(input.defaultCalendarId)) || defaultCalendar()
  if (input.defaultCalendarId && !calById.has(input.defaultCalendarId)) {
    warnings.push(`Default calendar '${input.defaultCalendarId}' not found; using the standard 5-day calendar.`)
  }
  const warnedCal = new Set<string>()
  const calFor = (id: string | undefined): CompiledCalendar => {
    let cal = fallbackCal
    if (id) {
      const found = calById.get(id)
      if (found) cal = found
      else if (!warnedCal.has('missing:' + id)) {
        warnedCal.add('missing:' + id)
        warnings.push(`Calendar '${id}' not found; activities using it fall back to '${fallbackCal.name || fallbackCal.id}'.`)
      }
    }
    const c = compileCalendar(cal)
    if (c.warnings.length && !warnedCal.has('w:' + cal.id)) {
      warnedCal.add('w:' + cal.id)
      warnings.push(...c.warnings)
    }
    return c
  }

  /* ── dates ── */
  const projectStartDay = dateNum(input.projectStart)
  if (Number.isNaN(projectStartDay)) throw new Error(`runCpm: invalid projectStart '${input.projectStart}'`)
  let dataDay = input.dataDate ? dateNum(input.dataDate) : projectStartDay
  if (Number.isNaN(dataDay)) {
    warnings.push(`Invalid data date '${input.dataDate}'; using project start.`)
    dataDay = projectStartDay
  }
  const lower = Math.max(projectStartDay, dataDay)
  const retained = input.progressMode !== 'override'

  /* ── activities ── */
  const idx = new Map<string, number>()
  const nodes: Node[] = []
  for (const a of input.activities ?? []) {
    if (idx.has(a.id)) {
      warnings.push(`Duplicate activity id '${a.id}' ignored.`)
      continue
    }
    idx.set(a.id, nodes.length)
    const isMs = a.type === 'milestone'
    const dur = isMs ? 0 : Math.max(0, Math.ceil(Number(a.duration) || 0))
    const af = dateNum(a.actualFinish), as = dateNum(a.actualStart)
    if (a.actualFinish && Number.isNaN(af)) warnings.push(`Activity ${a.code}: invalid actual finish '${a.actualFinish}' ignored.`)
    if (a.actualStart && Number.isNaN(as)) warnings.push(`Activity ${a.code}: invalid actual start '${a.actualStart}' ignored.`)
    const state: Node['state'] = !Number.isNaN(af) || (isMs && !Number.isNaN(as)) ? 'complete' : !Number.isNaN(as) ? 'progress' : 'open'
    nodes.push({ a, c: calFor(a.calendarId), isMs, startLike: true, dur, state, es: 0, ef: 0, ls: 0, lf: 0, pinnedLow: false, logicEs: 0, logicEf: 0, resume: 0, logicResume: 0, drvEs: 0, drvEf: 0, mand: false, pinEs: 0, pinEf: 0, predEs: NaN, predEf: NaN, tf: 0, ff: 0 })
  }
  const n = nodes.length

  /* ── links (pre-indexed) ── */
  const edges: Edge[] = []
  let unknown = 0
  const unknownSamples: string[] = []
  for (const l of input.links ?? []) {
    const f = idx.get(l.from), t = idx.get(l.to)
    if (f === undefined || t === undefined) {
      unknown++
      if (unknownSamples.length < 5) unknownSamples.push(`${l.from}->${l.to}`)
      continue
    }
    const type = l.type === 'SS' || l.type === 'FF' || l.type === 'SF' ? l.type : 'FS'
    edges.push({ from: f, to: t, type, lag: Math.round(Number(l.lag) || 0) })
  }
  if (unknown) warnings.push(`${unknown} link(s) reference unknown activities and were ignored (e.g. ${unknownSamples.join(', ')}).`)

  const outAll: number[][] = Array.from({ length: n }, () => [])
  for (let e = 0; e < edges.length; e++) outAll[edges[e].from].push(e)

  /* ── cycle detection: Tarjan SCC (report) + DFS back-edge removal (break) ── */
  findCycles(n, edges, outAll, (scc) => cycles.push(scc.map((i) => nodes[i].a.id)))
  const removed = new Uint8Array(edges.length)
  if (cycles.length) {
    const broken = breakBackEdges(n, edges, outAll, removed)
    warnings.push(`Found ${cycles.length} logic loop(s); ${broken} link(s) were ignored to compute best-effort dates.`)
  }

  const outs: number[][] = Array.from({ length: n }, () => [])
  const ins: number[][] = Array.from({ length: n }, () => [])
  for (let e = 0; e < edges.length; e++) {
    if (removed[e]) continue
    outs[edges[e].from].push(e)
    ins[edges[e].to].push(e)
  }
  for (let i = 0; i < n; i++) {
    const kind = nodes[i].a.milestoneKind
    nodes[i].startLike = kind === 'start' || kind === 'finish' ? kind === 'start' : ins[i].length === 0
  }

  /* ── topological order (Kahn) ── */
  const indeg = new Int32Array(n)
  for (let i = 0; i < n; i++) indeg[i] = ins[i].length
  const order: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) order.push(i)
  for (let h = 0; h < order.length; h++) {
    for (const e of outs[order[h]]) if (--indeg[edges[e].to] === 0) order.push(edges[e].to)
  }
  if (order.length < n) {
    // Should not happen after breaking back edges; keep going defensively.
    const seen = new Uint8Array(n)
    for (const i of order) seen[i] = 1
    for (let i = 0; i < n; i++) if (!seen[i]) order.push(i)
  }

  /* ── helpers ── */
  const msSnapFwd = (t: number, c: CompiledCalendar) => (c.isWork(t) || c.isWork(t - 1) ? t : c.next(t))
  const msSnapBack = (t: number, c: CompiledCalendar) => (c.isWork(t) || c.isWork(t - 1) ? t : c.prev(t - 1) + 1)
  const taskFinish = (s: number, d: number, c: CompiledCalendar) => (d > 0 ? c.add(s, d - 1) : s)
  const taskStart = (f: number, d: number, c: CompiledCalendar) => (d > 0 ? c.add(f, -(d - 1)) : f)
  const msInstant = (node: Node, day: number) => (node.startLike ? day : day + 1)
  // A start milestone sits at the start of a work day; a finish milestone on a work-day boundary.
  const msSnap = (node: Node, t: number) => (node.startLike ? node.c.next(t) : msSnapFwd(t, node.c))
  // A finish milestone's late date sits at the END of its last work day (not the start of the next
  // one across a weekend), so LF - EF shown on screen equals its total float.
  // (Unless that would put it before its early instant, e.g. a finish milestone driven to the start of a day.)
  const msSnapLate = (node: Node, t: number) => {
    if (node.startLike) return node.c.next(t)
    const end = node.c.prev(t - 1) + 1
    return end >= node.ef || end >= t ? end : msSnapBack(t, node.c)
  }
  const msDisplay = (node: Node, t: number): number => {
    const preferStart = node.startLike || node.pinnedLow
    if (preferStart) return node.c.isWork(t) || !node.c.isWork(t - 1) ? t : t - 1
    return node.c.isWork(t - 1) || !node.c.isWork(t) ? t - 1 : t
  }
  const remainingOf = (node: Node) => {
    const r = node.a.remaining
    return r === undefined || r === null || Number.isNaN(Number(r)) ? node.dur : Math.max(0, Math.ceil(Number(r)))
  }
  const constraintDay = (node: Node) => {
    const k = node.a.constraint
    if (!k || !k.date) return NaN
    const d = dateNum(k.date)
    if (Number.isNaN(d)) warnings.push(`Activity ${node.a.code}: invalid constraint date '${k.date}' ignored.`)
    return d
  }

  /* ── forward pass ── */
  // Two sets of early dates are carried: the scheduled ones (es/ef, mandatory constraints applied)
  // and the ones logic alone gives (logicEs/logicEf: mandatory constraints ignored all the way
  // down the network), for the logic-driven finish and longest path.
  for (const i of order) {
    const node = nodes[i]
    const c = node.c
    const a = node.a
    if (node.state === 'complete') {
      const af = dateNum(a.actualFinish ?? a.actualStart)
      if (node.isMs) {
        node.es = node.ef = msInstant(node, af)
      } else {
        let as = dateNum(a.actualStart)
        if (Number.isNaN(as)) as = taskStart(c.prev(af), node.dur, c)
        node.es = as
        node.ef = af + 1
      }
      node.logicEs = node.es
      node.logicEf = node.ef
      node.logicResume = node.resume
      continue
    }
    let startLB = lower, finishLB = -INF
    let startLBL = lower, finishLBL = -INF
    // What the (scheduled) predecessors alone require, without the data-date floor: a mandatory
    // constraint's logic date and overrun are measured from this, never from the data date.
    let startP = -INF, finishP = -INF
    for (const e of ins[i]) {
      const ed = edges[e]
      const p = nodes[ed.from]
      switch (ed.type) {
        case 'FS':
          startP = Math.max(startP, shift(p.ef, ed.lag, p.c))
          startLBL = Math.max(startLBL, shift(p.logicEf, ed.lag, p.c))
          break
        case 'SS':
          startP = Math.max(startP, shift(p.es, ed.lag, p.c))
          startLBL = Math.max(startLBL, shift(p.logicEs, ed.lag, p.c))
          break
        case 'FF':
          finishP = Math.max(finishP, shift(p.ef, ed.lag, p.c))
          finishLBL = Math.max(finishLBL, shift(p.logicEf, ed.lag, p.c))
          break
        case 'SF':
          finishP = Math.max(finishP, shift(p.es, ed.lag, p.c))
          finishLBL = Math.max(finishLBL, shift(p.logicEs, ed.lag, p.c))
          break
      }
    }
    startLB = Math.max(startLB, startP)
    finishLB = finishP
    const hasPredBound = startP > -INF || finishP > -INF
    const k = a.constraint
    const kd = constraintDay(node)
    const hasK = !!k && !Number.isNaN(kd)
    node.mand = node.state === 'open' && hasK && (k!.type === 'MSO' || k!.type === 'MFO')
    if (node.state === 'progress' && hasK && START_CONSTRAINTS.has(k!.type)) {
      warnings.push(`Activity ${a.code}: ${k!.type} start constraint ignored because the activity has an actual start (as P6).`)
    }

    if (node.state === 'progress') {
      const as = dateNum(a.actualStart)
      const rem = remainingOf(node)
      const place = (sLB: number, fLB: number) => {
        let f: number
        // Retained logic: the remaining work waits for FS/SS predecessors (sLB already holds them).
        const resume = retained ? Math.max(dataDay, as, sLB) : Math.max(dataDay, as)
        if (rem > 0) f = c.add(c.next(resume), rem - 1)
        else f = Math.max(as, c.prev(dataDay - 1))
        if (fLB > f + 1) f = c.next(fLB - 1)
        if (hasK && (k!.type === 'FNET' || k!.type === 'FO') && kd > f) f = c.next(kd)
        return { ef: f + 1, resume: rem > 0 ? c.next(resume) : as }
      }
      const sched = place(startLB, finishLB)
      const logic = place(startLBL, finishLBL)
      node.es = node.logicEs = as
      node.ef = sched.ef
      node.resume = sched.resume
      node.logicEf = logic.ef
      node.logicResume = logic.resume
      continue
    }

    if (node.isMs) {
      // A constraint date on a milestone means "displayed on that date": the instant depends on
      // whether it is a start or finish milestone (see msInstant).
      const ki = hasK ? msInstant(node, kd) : NaN
      const soft = hasK && (k!.type === 'SNET' || k!.type === 'FNET' || k!.type === 'SO' || k!.type === 'FO')
      const place = (sLB: number, fLB: number) => {
        let t = Math.max(sLB, fLB)
        if (soft) t = Math.max(t, ki)
        return msSnap(node, Math.max(t, lower))
      }
      const logicT = place(startLBL, finishLBL)
      node.logicEs = node.logicEf = logicT
      let t: number
      if (node.mand) {
        node.drvEs = node.drvEf = place(startLB, finishLB)
        if (hasPredBound) node.predEs = node.predEf = msSnap(node, Math.max(startP, finishP))
        node.pinEs = node.pinEf = msSnap(node, ki)
        t = ki
        if (t < lower) {
          warnings.push(`Activity ${a.code}: mandatory constraint before the data date was moved to the data date (its late date stays on the constraint date).`)
          t = lower
        }
        t = msSnap(node, t)
      } else {
        t = place(startLB, finishLB)
      }
      node.pinnedLow = !node.startLike && t <= lower
      node.es = node.ef = t
      continue
    }

    const placeTask = (sLB: number, fLB: number) => {
      if (hasK) {
        if (k!.type === 'SNET' || k!.type === 'SO') sLB = Math.max(sLB, kd)
        else if (k!.type === 'FNET' || k!.type === 'FO') fLB = Math.max(fLB, kd + 1)
      }
      let s = c.next(sLB)
      if (fLB > -INF) s = Math.max(s, taskStart(c.next(fLB - 1), node.dur, c))
      return s
    }
    const ls0 = placeTask(startLBL, finishLBL)
    node.logicEs = ls0
    node.logicEf = taskFinish(ls0, node.dur, c) + 1
    let s: number
    if (node.mand) {
      node.drvEs = placeTask(startLB, finishLB)
      node.drvEf = taskFinish(node.drvEs, node.dur, c) + 1
      if (hasPredBound) {
        let ps = startP > -INF ? c.next(startP) : -INF
        if (finishP > -INF) ps = Math.max(ps, taskStart(c.next(finishP - 1), node.dur, c))
        node.predEs = ps
        node.predEf = taskFinish(ps, node.dur, c) + 1
      }
      s = k!.type === 'MSO' ? c.next(kd) : taskStart(c.prev(kd), node.dur, c)
      node.pinEs = s
      node.pinEf = taskFinish(s, node.dur, c) + 1
      if (s < lower) {
        warnings.push(`Activity ${a.code}: mandatory constraint before the data date was moved to the data date (its late dates stay on the constraint date).`)
        s = c.next(lower)
      }
    } else {
      s = placeTask(startLB, finishLB)
    }
    node.es = s
    node.ef = taskFinish(s, node.dur, c) + 1
  }


  /* ── project finish ── */
  let finishNode = -1
  let maxEf = -INF
  for (const i of order) {
    if (nodes[i].ef >= maxEf) { maxEf = nodes[i].ef; finishNode = i }
  }
  const finishInstant = n ? maxEf : projectStartDay
  let anchor = finishInstant
  if (input.mustFinishBy) {
    const m = dateNum(input.mustFinishBy)
    if (Number.isNaN(m)) warnings.push(`Invalid mustFinishBy '${input.mustFinishBy}' ignored.`)
    else anchor = m + 1
  }

  /* ── backward pass ── */
  for (let h = order.length - 1; h >= 0; h--) {
    const i = order[h]
    const node = nodes[i]
    const c = node.c
    const a = node.a
    if (node.state === 'complete') {
      node.ls = node.es
      node.lf = node.ef
      continue
    }
    let startUB = INF
    let finishUB = INF
    for (const e of outs[i]) {
      const ed = edges[e]
      const q = nodes[ed.to]
      if (q.state === 'complete') continue
      if (q.state === 'progress' && !retained && (ed.type === 'FS' || ed.type === 'SS')) continue
      switch (ed.type) {
        case 'FS': finishUB = Math.min(finishUB, shift(q.ls, -ed.lag, c)); break
        case 'SS': startUB = Math.min(startUB, shift(q.ls, -ed.lag, c)); break
        case 'FF': finishUB = Math.min(finishUB, shift(q.lf, -ed.lag, c)); break
        case 'SF': startUB = Math.min(startUB, shift(q.lf, -ed.lag, c)); break
      }
    }
    if (startUB === INF && finishUB === INF) finishUB = anchor
    const k = a.constraint
    const kd = constraintDay(node)
    const hasK = !!k && !Number.isNaN(kd)

    if (node.isMs) {
      let t = Math.min(startUB, finishUB)
      if (hasK) {
        if (k!.type === 'SNLT' || k!.type === 'FNLT' || k!.type === 'SO' || k!.type === 'FO') t = Math.min(t, msInstant(node, kd))
        else if (node.mand && node.state === 'open') t = node.pinEs
      }
      t = msSnapLate(node, t)
      node.ls = node.lf = t
      continue
    }

    const d = node.state === 'progress' ? remainingOf(node) : node.dur
    // P6 ignores start constraints (SNET/SNLT/Start On/MSO) once an activity has an actual start.
    if (hasK && !(node.state === 'progress' && START_CONSTRAINTS.has(k!.type))) {
      if (k!.type === 'SNLT' || k!.type === 'SO') startUB = Math.min(startUB, kd)
      else if (k!.type === 'FNLT' || k!.type === 'FO') finishUB = Math.min(finishUB, kd + 1)
    }
    let f: number
    if (node.mand && node.state === 'open') {
      // P6: the late dates sit on the constraint date (even a past one), whatever the successors need.
      f = node.pinEf - 1
    } else {
      f = INF
      if (finishUB < INF) f = c.prev(finishUB - 1)
      if (startUB < INF) f = Math.min(f, taskFinish(c.prev(startUB), d, c))
    }
    node.lf = f + 1
    node.ls = taskStart(f, d, c)
  }

  /* ── float ── */
  for (let i = 0; i < n; i++) {
    const node = nodes[i]
    if (node.state === 'complete') { node.tf = 0; continue }
    const c = node.c
    const finishFloat = wdInstants(node.ef, node.lf, c)
    if (node.isMs || node.state === 'progress') node.tf = finishFloat
    else node.tf = Math.min(wdInstants(node.es, node.ls, c), finishFloat)
  }
  /* ── mandatory constraints that overrule logic ── */
  const violations: CpmResult['violations'] = []
  for (let i = 0; i < n; i++) {
    const node = nodes[i]
    const k = node.a.constraint
    if (!node.mand || !k || Number.isNaN(node.predEs)) continue
    // Measured from the date the predecessors drive it to (not from the data date, which only
    // floors the displayed date) back to the constraint date itself (where its late dates sit).
    const over = node.isMs || k.type === 'MSO' ? wdInstants(node.pinEs, node.predEs, node.c) : wdInstants(node.pinEf, node.predEf, node.c)
    if (over <= 0) continue
    // As P6, the constrained activity keeps the float of its pinned dates; the overrun shows as
    // negative float on its predecessors (their late dates follow the pinned dates).
    const logicStart = node.isMs ? msDisplay(node, node.predEs) : node.predEs
    const logicFinishDay = node.isMs ? logicStart : node.predEf - 1
    violations.push({
      id: node.a.id, type: k.type as 'MSO' | 'MFO', constraintDate: k.date,
      logicDate: fromDayNumber(k.type === 'MSO' ? logicStart : logicFinishDay), days: over,
      logicStart: fromDayNumber(logicStart), logicFinish: fromDayNumber(logicFinishDay),
    })
    warnings.push(`Activity ${node.a.code}: mandatory ${k.type === 'MSO' ? 'start' : 'finish'} ${k.date} overrules logic by ${over} work day${over === 1 ? '' : 's'}.`)
  }
  const linkFloat: CpmLinkFloat[] | null = input.linkFloat ? [] : null
  for (let i = 0; i < n; i++) {
    const node = nodes[i]
    if (node.state === 'complete') { node.ff = 0; continue }
    let ff = INF
    for (const e of outs[i]) {
      const ed = edges[e]
      const q = nodes[ed.to]
      // the same relationships the backward pass uses
      if (q.state === 'complete') continue
      if (q.state === 'progress' && !retained && (ed.type === 'FS' || ed.type === 'SS')) continue
      const src = ed.type === 'FS' || ed.type === 'FF' ? node.ef : node.es
      const bound = shift(src, ed.lag, node.c)
      const target = ed.type === 'FS' || ed.type === 'SS' ? (q.state === 'progress' ? q.resume : q.es) : q.ef
      const rff = wdInstants(bound, target, node.c)
      if (linkFloat) linkFloat.push({ from: node.a.id, to: q.a.id, type: ed.type, lag: ed.lag, freeFloat: rff })
      ff = Math.min(ff, rff)
    }
    // No open successors: measured to the project finish, or to the required finish when earlier
    // (the same anchor total float uses).
    if (ff === INF) ff = wdInstants(node.ef, Math.min(finishInstant, anchor), node.c)
    // Free float never exceeds total float. Without the cap it would where a successor carries
    // negative float (a constraint or required finish) or an end activity has a required finish.
    node.ff = Math.max(0, Math.min(ff, node.tf))
  }

  /* ── output times ── */
  const times: Record<string, CpmTimes> = {}
  const display = (node: Node) => {
    if (node.state === 'complete') {
      const a = node.a
      const af = a.actualFinish ?? a.actualStart ?? ''
      const as = a.actualStart ?? (node.isMs ? af : fromDayNumber(node.es))
      return { es: as.slice(0, 10), ef: af.slice(0, 10), ls: as.slice(0, 10), lf: af.slice(0, 10) }
    }
    if (node.isMs) {
      const e = fromDayNumber(msDisplay(node, node.es))
      const l = fromDayNumber(msDisplay(node, node.ls))
      return { es: e, ef: e, ls: l, lf: l }
    }
    return {
      es: fromDayNumber(node.es),
      ef: fromDayNumber(node.ef - 1),
      ls: fromDayNumber(node.ls),
      lf: fromDayNumber(node.lf - 1),
    }
  }
  for (let i = 0; i < n; i++) {
    const node = nodes[i]
    const d = display(node)
    times[node.a.id] = {
      earlyStart: d.es,
      earlyFinish: d.ef,
      lateStart: d.ls,
      lateFinish: d.lf,
      totalFloat: node.tf,
      freeFloat: node.ff,
      critical: node.state !== 'complete' && node.tf <= 0,
    }
  }
  const projectFinish = finishNode >= 0 ? times[nodes[finishNode].a.id].earlyFinish : fromDayNumber(projectStartDay)

  /* ── driving paths: walk driving predecessors back from an end activity ── */
  // A relationship is driving when it alone would put the successor's early date where it is
  // (retained-logic progress is judged on where the remaining work resumes). In 'scheduled' mode an
  // activity whose date a mandatory constraint sets (rather than logic) ends the walk: the
  // constraint, not its predecessors, drives it (P6 longest path). In 'logic' mode mandatory
  // constraints are judged on the logic dates they overrule, so the walk follows the sequence
  // logic alone would produce.
  const isPinned = (q: Node) => q.mand && q.state === 'open' && (q.isMs ? q.es !== q.drvEs : q.ef !== q.drvEf)
  // A constraint that can set an early date (P6 ignores start constraints once work has started).
  const softHold = (q: Node) => {
    const k = q.a.constraint
    if (!k || q.state === 'complete') return false
    if (q.state === 'progress') return k.type === 'FNET' || k.type === 'FO'
    return k.type === 'SNET' || k.type === 'SO' || k.type === 'FNET' || k.type === 'FO'
  }
  /**
   * through = false: P6 longest path (stops where a constraint, not logic, sets the date).
   * through = true: the logic driving path behind it: where a constraint holds an activity (no
   * predecessor drives it), the walk continues to the predecessor that comes closest to driving it,
   * and records the constraint in `held`.
   */
  const walk = (endIdx: number, eligible: (i: number) => boolean, mode: 'scheduled' | 'logic', through = false): { path: string[]; stop: number; held: number[] } => {
    const path: string[] = []
    const held: number[] = []
    const visited = new Uint8Array(n)
    let cur = endIdx
    let stop = -1
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1
      path.push(nodes[cur].a.id)
      const q = nodes[cur]
      const pinned = isPinned(q)
      if (mode === 'scheduled' && pinned && !through) { stop = cur; break }
      // In logic mode the pinned activity sits at its logic dates; flag the constraint it overrules.
      if (mode === 'logic' && pinned) held.push(cur)
      const qEs = mode === 'logic' ? q.logicEs : q.es
      const qEf = mode === 'logic' ? q.logicEf : q.ef
      let best = -1
      let bestScore = INF
      // the closest non-driving predecessor (for through = true)
      let near = -1
      let nearGap = INF
      for (const e of ins[cur]) {
        const ed = edges[e]
        const p = nodes[ed.from]
        if (p.state === 'complete' || visited[ed.from] || !eligible(ed.from)) continue
        const startLink = ed.type === 'FS' || ed.type === 'SS'
        if (q.state === 'progress' && startLink && !retained) continue
        const src = ed.type === 'FS' || ed.type === 'FF' ? (mode === 'logic' ? p.logicEf : p.ef) : (mode === 'logic' ? p.logicEs : p.es)
        const bound = shift(src, ed.lag, p.c)
        let driving: boolean
        let gap: number
        if (q.isMs) { const t = msSnap(q, bound); driving = t >= qEs; gap = qEs - t }
        else if (startLink) { const t = q.c.next(bound); const at = q.state === 'progress' ? (mode === 'logic' ? q.logicResume : q.resume) : qEs; driving = t >= at; gap = at - t }
        else { const t = q.c.next(bound - 1) + 1; driving = t >= qEf; gap = qEf - t }
        const score = p.tf * 1e6 - p.ef
        if (gap < nearGap || (gap === nearGap && near >= 0 && score < nodes[near].tf * 1e6 - nodes[near].ef)) { nearGap = gap; near = ed.from }
        if (mode === 'scheduled' && pinned) continue
        if (!driving) continue
        // prefer the most critical driver; on ties, the one that finishes latest
        if (score < bestScore) { bestScore = score; best = ed.from }
      }
      if (through && best < 0 && near >= 0 && (pinned || softHold(q))) {
        if (mode === 'scheduled' || !pinned) held.push(cur)
        best = near
      }
      cur = best
    }
    return { path: path.reverse(), stop, held: held.reverse() }
  }

  let critEnd = -1
  let critEf = -INF
  for (const i of order) {
    const node = nodes[i]
    if (node.state !== 'complete' && node.tf <= 0 && node.ef >= critEf) { critEf = node.ef; critEnd = i }
  }
  const criticalPath = critEnd >= 0 ? walk(critEnd, (i) => nodes[i].tf <= 0, 'scheduled').path : []
  // Longest path: from the open activity with the latest early finish (the scheduled project
  // finish), whatever its float; it stops at a mandatory constraint that sets a date.
  let longEnd = -1
  let longEf = -INF
  let logicEnd = -1
  let logicEf = -INF
  for (const i of order) {
    const node = nodes[i]
    if (node.state === 'complete') continue
    if (node.ef >= longEf) { longEf = node.ef; longEnd = i }
    if (node.logicEf >= logicEf) { logicEf = node.logicEf; logicEnd = i }
  }
  const long = longEnd >= 0 ? walk(longEnd, () => true, 'scheduled') : { path: [], stop: -1 }
  const longestPath = long.path
  let longestPathConstraint: CpmResult['longestPathConstraint']
  if (long.stop >= 0) {
    const s = nodes[long.stop]
    const k = s.a.constraint!
    longestPathConstraint = { id: s.a.id, type: k.type as 'MSO' | 'MFO', date: k.date }
  }
  // What logic alone would give: the finish and the path to it, through mandatory constraints.
  const logicLongestPath = logicEnd >= 0 ? walk(logicEnd, () => true, 'logic').path : []
  const logicFinish = logicEnd >= 0
    ? fromDayNumber(nodes[logicEnd].isMs ? msDisplay(nodes[logicEnd], nodes[logicEnd].logicEs) : nodes[logicEnd].logicEf - 1)
    : projectFinish
  // The driving path to present: when a mandatory constraint hides a later logic-driven finish, the
  // path to that finish; otherwise the scheduled longest path. Either way traced back through any
  // constraint that holds an activity (instead of stopping there), with those constraints flagged.
  const logicBasis = violations.length > 0 && logicEnd >= 0 && nodes[logicEnd].logicEf > longEf
  const trace = logicBasis ? walk(logicEnd, () => true, 'logic', true) : longEnd >= 0 ? walk(longEnd, () => true, 'scheduled', true) : { path: [], stop: -1, held: [] }
  const drivingTrace: NonNullable<CpmResult['drivingTrace']> = {
    basis: logicBasis ? 'logic' : 'scheduled',
    path: trace.path,
    constraints: trace.held.map((i) => {
      const q = nodes[i]
      const k = q.a.constraint!
      const later = q.mand ? (q.isMs ? q.es > q.drvEs : q.ef > q.drvEf) : true
      return { id: q.a.id, type: k.type, date: k.date, effect: later ? 'later' as const : 'earlier' as const }
    }),
  }
  // Per-activity logic-driven dates (mandatory constraints relaxed network-wide), where they differ
  // from the scheduled ones.
  const logicTimes: NonNullable<CpmResult['logicTimes']> = {}
  for (let i = 0; i < n; i++) {
    const node = nodes[i]
    if (node.state === 'complete') continue
    const es = node.isMs ? msDisplay(node, node.logicEs) : node.state === 'progress' ? node.es : node.logicEs
    const ef = node.isMs ? es : node.logicEf - 1
    const t = times[node.a.id]
    const esS = fromDayNumber(es), efS = fromDayNumber(ef)
    if (esS !== t.earlyStart || efS !== t.earlyFinish) logicTimes[node.a.id] = { earlyStart: esS, earlyFinish: efS }
  }

  return {
    times, projectFinish, logicFinish, criticalPath, longestPath, logicLongestPath, logicTimes, drivingTrace,
    ...(longestPathConstraint ? { longestPathConstraint } : {}),
    violations, ...(linkFloat ? { linkFloat } : {}), progressMode: retained ? 'retained' : 'override', cycles, warnings: Array.from(new Set(warnings)),
  }
}

/* ─── graph helpers ───────────────────────────────────── */

/** Iterative Tarjan SCC; calls onCycle for every SCC of size > 1 or with a self-loop. */
function findCycles(n: number, edges: Edge[], out: number[][], onCycle: (scc: number[]) => void): void {
  const index = new Int32Array(n).fill(-1)
  const low = new Int32Array(n)
  const onStack = new Uint8Array(n)
  const stack: number[] = []
  const iter = new Int32Array(n)
  let counter = 0
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue
    const call: number[] = [root]
    index[root] = low[root] = counter++
    stack.push(root)
    onStack[root] = 1
    while (call.length) {
      const v = call[call.length - 1]
      if (iter[v] < out[v].length) {
        const w = edges[out[v][iter[v]++]].to
        if (index[w] === -1) {
          index[w] = low[w] = counter++
          stack.push(w)
          onStack[w] = 1
          call.push(w)
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], index[w])
        }
      } else {
        call.pop()
        if (call.length) {
          const parent = call[call.length - 1]
          low[parent] = Math.min(low[parent], low[v])
        }
        if (low[v] === index[v]) {
          const scc: number[] = []
          let w: number
          do {
            w = stack.pop()!
            onStack[w] = 0
            scc.push(w)
          } while (w !== v)
          if (scc.length > 1 || out[v].some((e) => edges[e].to === v)) onCycle(scc.reverse())
        }
      }
    }
  }
}

/** Marks DFS back edges (and self-loops) as removed so the remaining graph is acyclic. */
function breakBackEdges(n: number, edges: Edge[], out: number[][], removed: Uint8Array): number {
  const color = new Uint8Array(n) // 0 white, 1 gray, 2 black
  const iter = new Int32Array(n)
  let count = 0
  for (let root = 0; root < n; root++) {
    if (color[root]) continue
    const call = [root]
    color[root] = 1
    while (call.length) {
      const v = call[call.length - 1]
      if (iter[v] < out[v].length) {
        const e = out[v][iter[v]++]
        const w = edges[e].to
        if (color[w] === 1) { removed[e] = 1; count++ }
        else if (color[w] === 0) { color[w] = 1; call.push(w) }
      } else {
        color[v] = 2
        call.pop()
      }
    }
  }
  return count
}
