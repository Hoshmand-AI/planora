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
// where shift() moves the instant by `lag` work days on the SUCCESSOR's calendar. With lag 0 an FS
// successor starts on the next work day after the predecessor's finish day.
//
// Milestones: a milestone with no (valid) predecessors is a "start milestone" and is displayed on
// the day its instant begins; any other milestone is a "finish milestone" and is displayed on the
// day its instant ends (e.g. a finish milestone after a task finishing Friday shows Friday, and an
// FS successor of it starts Monday). This mirrors P6 start/finish milestones.
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
// progress: ES = actualStart, remaining (default duration) is scheduled from max(dataDate,
// actualStart) — i.e. "progress override" for the start; FF/SF predecessors can still push the
// finish. A milestone with only actualStart is treated as complete on that date.
//
// Constraints: SNET/FNET push early dates, MSO/MFO fix early and late dates (but never earlier than
// the data date), SNLT/FNLT cap late dates.

import type { CpmActivity, CpmInput, CpmLink, CpmResult, CpmTimes, WorkCalendar } from '@/lib/planning/types'
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
    nodes.push({ a, c: calFor(a.calendarId), isMs, startLike: true, dur, state, es: 0, ef: 0, ls: 0, lf: 0, pinnedLow: false, tf: 0, ff: 0 })
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
  for (let i = 0; i < n; i++) nodes[i].startLike = ins[i].length === 0

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
      continue
    }
    let startLB = lower
    let finishLB = -INF
    for (const e of ins[i]) {
      const ed = edges[e]
      const p = nodes[ed.from]
      switch (ed.type) {
        case 'FS': startLB = Math.max(startLB, shift(p.ef, ed.lag, c)); break
        case 'SS': startLB = Math.max(startLB, shift(p.es, ed.lag, c)); break
        case 'FF': finishLB = Math.max(finishLB, shift(p.ef, ed.lag, c)); break
        case 'SF': finishLB = Math.max(finishLB, shift(p.es, ed.lag, c)); break
      }
    }
    const k = a.constraint
    const kd = constraintDay(node)
    const hasK = !!k && !Number.isNaN(kd)

    if (node.state === 'progress') {
      const as = dateNum(a.actualStart)
      const rem = remainingOf(node)
      node.es = as
      let f: number
      if (rem > 0) f = c.add(c.next(Math.max(dataDay, as)), rem - 1)
      else f = Math.max(as, c.prev(dataDay - 1))
      if (finishLB > f + 1) f = c.next(finishLB - 1)
      if (hasK && k!.type === 'FNET' && kd > f) f = c.next(kd)
      node.ef = f + 1
      continue
    }

    if (node.isMs) {
      let t = Math.max(startLB, finishLB)
      if (hasK) {
        // A constraint date on a milestone means "displayed on that date": the instant depends on
        // whether it is a start or finish milestone (see msInstant).
        const ki = msInstant(node, kd)
        if (k!.type === 'SNET' || k!.type === 'FNET') t = Math.max(t, ki)
        else if (k!.type === 'MSO' || k!.type === 'MFO') t = ki
      }
      if (t < lower) {
        if (hasK && (k!.type === 'MSO' || k!.type === 'MFO')) warnings.push(`Activity ${a.code}: mandatory constraint before the data date was moved to the data date.`)
        t = lower
      }
      t = msSnapFwd(t, c)
      node.pinnedLow = !node.startLike && t <= lower
      node.es = node.ef = t
      continue
    }

    if (hasK) {
      if (k!.type === 'SNET') startLB = Math.max(startLB, kd)
      else if (k!.type === 'FNET') finishLB = Math.max(finishLB, kd + 1)
    }
    let s = c.next(startLB)
    if (finishLB > -INF) s = Math.max(s, taskStart(c.next(finishLB - 1), node.dur, c))
    if (hasK && (k!.type === 'MSO' || k!.type === 'MFO')) {
      s = k!.type === 'MSO' ? c.next(kd) : taskStart(c.prev(kd), node.dur, c)
      if (s < lower) {
        warnings.push(`Activity ${a.code}: mandatory constraint before the data date was moved to the data date.`)
        s = c.next(lower)
      }
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
      if (q.state === 'progress' && (ed.type === 'FS' || ed.type === 'SS')) continue
      switch (ed.type) {
        case 'FS': finishUB = Math.min(finishUB, shift(q.ls, -ed.lag, q.c)); break
        case 'SS': startUB = Math.min(startUB, shift(q.ls, -ed.lag, q.c)); break
        case 'FF': finishUB = Math.min(finishUB, shift(q.lf, -ed.lag, q.c)); break
        case 'SF': startUB = Math.min(startUB, shift(q.lf, -ed.lag, q.c)); break
      }
    }
    if (startUB === INF && finishUB === INF) finishUB = anchor
    const k = a.constraint
    const kd = constraintDay(node)
    const hasK = !!k && !Number.isNaN(kd)

    if (node.isMs) {
      let t = Math.min(startUB, finishUB)
      if (hasK) {
        if (k!.type === 'SNLT' || k!.type === 'FNLT') t = Math.min(t, msInstant(node, kd))
        else if (k!.type === 'MSO' || k!.type === 'MFO') t = node.es
      }
      t = msSnapBack(t, c)
      node.ls = node.lf = t
      continue
    }

    const d = node.state === 'progress' ? remainingOf(node) : node.dur
    if (hasK) {
      if (k!.type === 'SNLT') startUB = Math.min(startUB, kd)
      else if (k!.type === 'FNLT') finishUB = Math.min(finishUB, kd + 1)
    }
    let f: number
    if (hasK && (k!.type === 'MSO' || k!.type === 'MFO') && node.state === 'open') {
      f = node.ef - 1
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
  for (let i = 0; i < n; i++) {
    const node = nodes[i]
    if (node.state === 'complete') { node.ff = 0; continue }
    let ff = INF
    for (const e of outs[i]) {
      const ed = edges[e]
      const q = nodes[ed.to]
      if (q.state === 'complete') continue
      if (q.state === 'progress' && (ed.type === 'FS' || ed.type === 'SS')) continue
      const src = ed.type === 'FS' || ed.type === 'FF' ? node.ef : node.es
      const bound = shift(src, ed.lag, q.c)
      const target = ed.type === 'FS' || ed.type === 'SS' ? q.es : q.ef
      ff = Math.min(ff, wdInstants(bound, target, node.c))
    }
    if (ff === INF) ff = wdInstants(node.ef, finishInstant, node.c)
    node.ff = Math.max(0, ff)
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

  /* ── critical path: walk driving predecessors back from the latest critical finish ── */
  const criticalPath: string[] = []
  let end = -1
  let endEf = -INF
  for (const i of order) {
    const node = nodes[i]
    if (node.state !== 'complete' && node.tf <= 0 && node.ef >= endEf) { endEf = node.ef; end = i }
  }
  if (end >= 0) {
    const visited = new Uint8Array(n)
    let cur = end
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1
      criticalPath.push(nodes[cur].a.id)
      const q = nodes[cur]
      let best = -1
      let bestScore = INF
      for (const e of ins[cur]) {
        const ed = edges[e]
        const p = nodes[ed.from]
        if (p.state === 'complete' || visited[ed.from]) continue
        if (q.state === 'progress' && (ed.type === 'FS' || ed.type === 'SS')) continue
        const src = ed.type === 'FS' || ed.type === 'FF' ? p.ef : p.es
        const bound = shift(src, ed.lag, q.c)
        // driving: the relationship alone would put the successor's early date where it is
        let driving: boolean
        if (q.isMs) driving = msSnapFwd(bound, q.c) >= q.es
        else if (ed.type === 'FS' || ed.type === 'SS') driving = q.c.next(bound) >= q.es
        else driving = q.c.next(bound - 1) + 1 >= q.ef
        if (!driving) continue
        const score = p.tf
        if (score < bestScore) { bestScore = score; best = ed.from }
      }
      cur = best
    }
    criticalPath.reverse()
  }

  return { times, projectFinish, criticalPath, cycles, warnings: Array.from(new Set(warnings)) }
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
