// Probabilistic Schedule Risk Analysis (Monte Carlo).
//
// Each iteration samples every remaining task's duration from a three-point (triangular)
// distribution and recomputes the full CPM network (all calendars, relationship types, lags and
// constraints), so merge bias and path switching are captured, not just the deterministic critical
// path. Results: finish-date percentiles, probability of meeting the required date, a histogram,
// each activity's criticality index (share of iterations in which it was on the driving path to the
// project finish, i.e. that iteration's longest path; not TF <= 0, which a constraint or a required
// date can produce off the driving path) and a sensitivity ranking (Spearman rank correlation
// between an activity's sampled duration and the finish).
//
// Mandatory constraints (MSO/MFO) would pin the dates they constrain in every iteration and hide the
// spread, so the simulation relaxes them to their logic-driven form (Mandatory Start -> Start On or
// After, Mandatory Finish -> Finish On or After) and says so in `warnings`.
//
// Uncertainty sources, per activity (multipliers of the planned duration):
//   - the scheduler's own inputs come first: a duration override (e.g. a vendor quote) is centered
//     on the overridden duration (−5% / +15%), and a permit review with an expected issuance date
//     or a fabrication step with a committed delivery date is held near-deterministic (0 / +5%);
//   - other agency reviews and fabrication: the regional permit / supplier lead-time catalog
//     (low / typical / high) relative to the planned duration;
//   - categories with firm history: the firm's own actual/planned ratios (median and P80), unless
//     the team opted out of firm history in the interview (history.use = No);
//   - otherwise by kind of work (design, field, other), widened for low-confidence estimates
//     and narrowed for high-confidence ones.
// Correlation: field activities share a common productivity/weather factor through a Gaussian
// copula (rho = 0.4), so they tend to run long or short together, as on real projects.
// The contingency activity is set to zero in the simulation: explicit uncertainty replaces the
// lump buffer, so risk is not counted twice.
// Sampling is seeded from the schedule, so the same schedule always gives the same result.
//
// Uploaded schedules (opts.inputs): the scheduler's own per-activity three-point ranges (work days)
// replace every rule-based range, and discrete risk events (probability × impact on one activity)
// are sampled each iteration on top of the ranges. With inputs.nameRules, activities are classified
// by their names (work-kind.ts): fabrication / delivery / procurement / submittals get a procurement
// range and no field-productivity correlation, and cure activities are fixed duration unless the
// scheduler gives them a range. A risk event may also attach to a milestone: when it occurs the
// milestone is delayed by its impact (work days). A committed delivery date (inputs.commitments) holds
// that activity near-deterministic (0 / +5%), and a forecast past the commitment is flagged.
// Milestones (inputs.milestones): the contract milestone and every milestone with a finish constraint
// get their own P50 / P80 and probability of meeting their date, measured on logic (their own
// Finish On / Mandatory Finish / Finish On or After constraint is lifted in the simulation so the
// date it would really be reached shows, not the constraint date).

import type { GeneratedSchedule, PlanActivity, Answer } from './types'
import { historyForPlan, type FirmHistory } from './history'
import { runCpm } from './cpm'
import { toDayNumber, fromDayNumber } from './calendar'
import { questionBank } from './elicitation'
import { workKind } from './work-kind'

export interface Triangular { min: number; mode: number; max: number; basis: string }

export interface SraResult {
  method: string
  iterations: number
  seed: number
  deterministic: string
  percentiles: { p10: string; p50: string; p80: string; p90: string; mean: string }
  required?: { date: string; probability: number }
  histogram: { from: string; to: string; count: number }[]
  criticality: { id: string; code: string; name: string; index: number }[]
  sensitivity: { id: string; code: string; name: string; correlation: number; criticality: number; basis: string }[]
  assumptions: string[]
  /** Things the reader must know to interpret the result (e.g. mandatory constraints relaxed) */
  warnings: string[]
  /** Discrete risk events: how often each occurred and what it did to the finish */
  events?: { id: string; name: string; code: string; probability: number; impactDays: number; occurred: number; finishDeltaDays: number }[]
  /** How many activities used the scheduler's own ranges / were held fixed (cure) */
  inputsUsed?: { ranges: number; events: number; fixed: number; procurementByName: number; commitments?: number }
  /** P50 / P80 and probability of meeting the date, per tracked milestone (the contract milestone first) */
  milestones?: SraMilestoneResult[]
  ms: number
}

/** The scheduler's three-point range for one activity, in work days of remaining work. */
export interface SraRange { activityId: string; optimistic: number; mostLikely: number; pessimistic: number }
/** A discrete risk event: with `probability` (0–1), `impactDays` work days are added to one activity. */
export interface SraRiskEvent { id: string; name: string; probability: number; impactDays: number; activityId: string }
/** A supplier's committed delivery (finish) date for one activity. */
export interface SraCommitment { activityId: string; date: string; note?: string }
/** A milestone whose finish the simulation tracks; `required` is the date it must meet. */
export interface SraMilestone { id: string; required: string | null; requiredSource?: string | null; contract?: boolean }
export interface SraMilestoneResult {
  id: string; code: string; name: string
  /** The contract milestone recovery and reports measure against */
  contract: boolean
  required: string | null
  requiredSource: string | null
  deterministic: string
  p50: string
  p80: string
  /** Share of iterations finishing on or before `required`; null without a date */
  probability: number | null
}
export interface SraInputs {
  ranges?: SraRange[]
  events?: SraRiskEvent[]
  /** Committed delivery dates (held near-deterministic; a forecast past the date is flagged) */
  commitments?: SraCommitment[]
  /** Milestones to report separately (contract milestone and milestones with finish constraints) */
  milestones?: SraMilestone[]
  /** Classify activities by name (uploaded schedules): procurement ranges, fixed cure durations */
  nameRules?: boolean
}

const FIELD_RHO = 0.4
const us = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Standard normal via Box–Muller. */
function normal(rand: () => number): number {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

/** Inverse CDF of a triangular distribution. */
export function triangular(u: number, d: Pick<Triangular, 'min' | 'mode' | 'max'>): number {
  const { min, mode, max } = d
  if (max <= min) return mode
  const fc = (mode - min) / (max - min)
  return u < fc ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode))
}

function rank(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const r = new Array<number>(values.length)
  for (let i = 0; i < idx.length;) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}

export function spearman(x: number[], y: number[]): number {
  const rx = rank(x), ry = rank(y)
  const n = x.length
  const mx = (n - 1) / 2
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - mx; num += a * b; dx += a * a; dy += b * b }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0
}

const isField = (a: PlanActivity) => a.phase !== 'design' && a.calendarId !== 'cal-7d' && a.category !== 'contingency' && !a.category.startsWith('permit') && a.category !== 'procurement' && a.category !== 'submittals'
/** Work days the simulation scales for an activity: remaining work when in progress. */
const baseDays = (a: PlanActivity) => (a.remaining != null ? a.remaining : a.duration)

/** True when the scheduler overrode this activity's duration (e.g. with a vendor quote). */
export function hasDurationOverride(a: PlanActivity): boolean {
  return !!a.overrides?.some(o => o.field === 'duration') || a.rationale.sources.some(s => s.kind === 'override')
}

export interface DistributionContext {
  history: FirmHistory | null
  catalog: Map<string, { low: number; typical: number; high: number; label: string }>
  /** Activities whose timing follows a date the team gave in the interview (activity id → basis) */
  committed?: Map<string, string>
  /** The scheduler's own three-point ranges (work days), by activity id; they win over every rule */
  userRanges?: Map<string, SraRange>
  /** Classify by activity name (uploaded schedules): procurement ranges and fixed cure durations */
  nameRules?: boolean
}

/** Activities whose duration follows a date the team gave: expected permit issuance, committed delivery. */
export function committedActivities(answers: Record<string, Answer>, bank: { permits: { id: string; name: string }[]; longLead: { id: string; name: string }[] }): Map<string, string> {
  const out = new Map<string, string>()
  const given = (id: string) => answers[id]?.status === 'known' && typeof answers[id].value === 'string' && !!answers[id].value
  for (const p of bank.permits) if (given(`permit.${p.id}.expected`)) out.set(`permit-${p.id}`, `${p.name}: expected issuance date from the interview`)
  for (const l of bank.longLead) if (given(`procure.${l.id}.delivery`)) out.set(`ll-${l.id}-fab`, `${l.name}: committed delivery date from the interview`)
  return out
}

/** The three-point estimate for one activity, as multipliers of its planned duration. */
export function distributionFor(a: PlanActivity, ctx: DistributionContext): Triangular | null {
  if (a.type === 'milestone' || a.actualFinish || a.category === 'contingency') return null
  const user = ctx.userRanges?.get(a.id)
  if (user) {
    const b = baseDays(a)
    if (b <= 0) return null
    return { min: user.optimistic / b, mode: user.mostLikely / b, max: user.pessimistic / b, basis: `Scheduler's range: ${user.optimistic}–${user.mostLikely}–${user.pessimistic} work days` }
  }
  if (a.duration <= 0) return null
  // The scheduler's inputs win over catalog ranges and history: they are what the team actually knows.
  if (hasDurationOverride(a)) return { min: 0.95, mode: 1, max: 1.15, basis: 'Scheduler override: −5% / +15% around the overridden duration' }
  const committed = ctx.committed?.get(a.id)
  if (committed) return { min: 1, mode: 1, max: 1.05, basis: `${committed}, held near-deterministic (0 / +5%)` }
  if (ctx.nameRules) {
    const k = workKind(a.name, a.category, a.phase)
    // Cure time is chemistry and spec, not productivity: fixed unless the scheduler gives a range.
    if (k === 'cure') return null
    if (k === 'procurement') return { min: 0.9, mode: 1, max: 1.4, basis: 'Fabrication / delivery / procurement (by activity name): −10% / +40%, supplier-driven, not field productivity' }
  }
  const planned = a.duration
  const cat = ctx.catalog.get(a.id)
  let d: Triangular
  if (cat && a.calendarId === 'cal-7d') {
    const lo = (cat.low * 7) / planned, ty = (cat.typical * 7) / planned, hi = (cat.high * 7) / planned
    d = { min: Math.min(lo, ty, 1), mode: Math.max(Math.min(ty, hi), lo), max: Math.max(hi, ty, 1), basis: `${cat.label}: catalog ${cat.low}–${cat.typical}–${cat.high} weeks` }
  } else if (ctx.history && a.rationale.sources.some(s => s.kind === 'firm_history')) {
    d = { min: 0.9, mode: 1, max: 1.2, basis: 'Duration from your firm’s actuals' }
  } else if (ctx.history?.byCategory[a.category]?.overrunMedian) {
    const st = ctx.history.byCategory[a.category]!
    const med = st.overrunMedian!, p80 = st.overrunP80 ?? med * 1.1
    d = { min: Math.min(0.9, med), mode: med, max: Math.max(p80 * 1.15, med * 1.1), basis: `Firm history: actual/planned median ×${med.toFixed(2)}, P80 ×${p80.toFixed(2)}` }
  } else if (a.phase === 'design') {
    d = { min: 0.9, mode: 1, max: 1.3, basis: 'Design work: −10% / +30%' }
  } else if (isField(a)) {
    d = { min: 0.9, mode: 1, max: 1.25, basis: 'Field work: −10% / +25%' }
  } else {
    d = { min: 0.9, mode: 1, max: 1.3, basis: 'Review / procurement step: −10% / +30%' }
  }
  if (a.rationale.confidence === 'low') { d.max = 1 + (d.max - 1) * 1.4 + 0.05; d.basis += '; widened (low confidence)' }
  if (a.rationale.confidence === 'high' && !cat) { d.max = 1 + (d.max - 1) * 0.7; d.basis += '; narrowed (high confidence)' }
  d.mode = Math.min(Math.max(d.mode, d.min), d.max)
  return d
}

export function runSra(s: GeneratedSchedule, answers: Record<string, Answer>, firmHistory: FirmHistory | null, opts: { iterations?: number; seed?: number; inputs?: SraInputs } = {}): SraResult {
  const started = Date.now()
  // Opting out of firm history in the interview (history.use = No) means it shapes no distribution.
  const history = historyForPlan(firmHistory, answers)
  const bank = questionBank({ answers })
  const catalog = new Map<string, { low: number; typical: number; high: number; label: string }>()
  for (const p of bank.permits) catalog.set(`permit-${p.id}`, { ...p.reviewWeeks, label: `${p.name} review` })
  for (const l of bank.longLead) catalog.set(`ll-${l.id}-fab`, { ...l.leadWeeks, label: `${l.name} lead time` })

  const acts = s.activities
  const committed = committedActivities(answers, bank)
  const inputs = opts.inputs || {}
  const idx = new Map(acts.map((a, i) => [a.id, i]))
  const userRanges = new Map((inputs.ranges || []).filter(r => idx.has(r.activityId)).map(r => [r.activityId, r]))
  const nameRules = !!inputs.nameRules
  const commitments = (inputs.commitments || []).filter(c => idx.has(c.activityId) && !acts[idx.get(c.activityId)!].actualFinish)
  for (const c of commitments) if (!userRanges.has(c.activityId)) committed.set(c.activityId, `Committed delivery date ${us(c.date)}${c.note ? ` (${c.note})` : ''}`)
  const dists = acts.map(a => distributionFor(a, { history, catalog, committed, userRanges, nameRules }))
  const kinds = acts.map(a => (nameRules ? workKind(a.name, a.category, a.phase) : null))
  // Supplier-driven and fixed-duration work does not share the field productivity/weather factor.
  const field = acts.map((a, i) => isField(a) && kinds[i] !== 'procurement' && kinds[i] !== 'cure' && !userRanges.has(a.id))
  const events = (inputs.events || []).map(e => ({ e, i: idx.get(e.activityId) })).filter((x): x is { e: SraRiskEvent; i: number } => x.i != null && !acts[x.i].actualFinish && (acts[x.i].type === 'task' || acts[x.i].type === 'milestone'))
  const eventHits = events.map(() => [] as boolean[])
  const budget = opts.iterations ?? Math.max(200, Math.min(1000, Math.floor(400_000 / Math.max(1, acts.length))))
  const seed = opts.seed ?? hashSeed(`${s.generatedAt}|${acts.length}|${s.links.length}`)
  const rand = mulberry32(seed)

  const finishes: number[] = []
  const samples: number[][] = acts.map(() => [])
  const critical = new Array<number>(acts.length).fill(0)
  const base = { projectStart: s.projectStart, dataDate: s.dataDate, links: s.links, calendars: s.calendars, defaultCalendarId: s.defaultCalendarId }
  const warnings: string[] = []
  // Relax mandatory constraints to their logic-driven form so the finish distribution reflects the
  // network, not a pinned date.
  // Tracked milestones are measured on logic: their own finish-date constraint is lifted.
  const tracked = (inputs.milestones || []).filter(m => idx.has(m.id) && !acts[idx.get(m.id)!].actualFinish)
  const trackedIds = new Set(tracked.map(m => m.id))
  const mandatory = acts.filter(a => !a.actualFinish && !trackedIds.has(a.id) && (a.constraint?.type === 'MSO' || a.constraint?.type === 'MFO'))
  const relaxed = acts.map(a => trackedIds.has(a.id) && a.constraint && ['FO', 'MFO', 'FNET', 'MSO', 'SO', 'SNET'].includes(a.constraint.type)
    ? { ...a, constraint: undefined }
    : a.constraint?.type === 'MSO' || a.constraint?.type === 'MFO'
    ? { ...a, constraint: { type: a.constraint.type === 'MSO' ? 'SNET' as const : 'FNET' as const, date: a.constraint.date } }
    : a)
  const lifted = acts.filter(a => trackedIds.has(a.id) && a.constraint && ['FO', 'MFO', 'FNET', 'MSO', 'SO', 'SNET'].includes(a.constraint.type))
  if (lifted.length) warnings.push(`${lifted.map(a => `${a.code} (${a.constraint!.type} ${us(a.constraint!.date)})`).join(', ')}: the milestone's own date constraint is lifted in the simulation, so its P50 / P80 show when logic reaches it; the probability is of reaching it by that date.`)
  const msFinishes: number[][] = tracked.map(() => [])
  if (mandatory.length) {
    const names = mandatory.slice(0, 5).map(a => `${a.code} (${a.constraint!.type === 'MSO' ? 'Mandatory Start' : 'Mandatory Finish'} ${a.constraint!.date})`).join(', ')
    warnings.push(`${mandatory.length} mandatory constraint${mandatory.length === 1 ? '' : 's'} (${names}${mandatory.length > 5 ? ', …' : ''}) ${mandatory.length === 1 ? 'was' : 'were'} relaxed for the simulation: Mandatory Start is treated as Start On or After and Mandatory Finish as Finish On or After, so logic drives the simulated finish. The deterministic finish still honours the mandatory dates.`)
  }

  for (let it = 0; it < budget; it++) {
    const zg = normal(rand)
    const simActs = relaxed.map((a, i) => {
      if (a.category === 'contingency') return { ...a, duration: 0, remaining: 0 }
      const d = dists[i]
      if (!d) return a
      const zi = normal(rand)
      const z = field[i] ? Math.sqrt(FIELD_RHO) * zg + Math.sqrt(1 - FIELD_RHO) * zi : zi
      const m = triangular(phi(z), d)
      samples[i].push(m)
      const dur = Math.max(1, Math.round(a.duration * m))
      return { ...a, duration: dur, remaining: a.remaining != null ? Math.max(1, Math.round(a.remaining * m)) : undefined }
    })
    // Discrete risk events: each occurs with its probability and adds its impact to one activity.
    events.forEach(({ e, i }, k) => {
      const hit = rand() < e.probability
      eventHits[k].push(hit)
      if (!hit || e.impactDays <= 0) return
      const a = simActs[i]
      // On a milestone the event delays it: it becomes a step of `impact` work days for this iteration.
      simActs[i] = a.type === 'milestone'
        ? { ...a, type: 'task' as const, duration: Math.round(e.impactDays), remaining: undefined }
        : { ...a, duration: a.duration + Math.round(e.impactDays), remaining: a.remaining != null ? a.remaining + Math.round(e.impactDays) : undefined }
    })
    const r = runCpm({ ...base, activities: simActs })
    finishes.push(toDayNumber(r.projectFinish))
    tracked.forEach((m, k) => { const t = r.times[m.id]; msFinishes[k].push(toDayNumber(t ? t.earlyFinish : r.projectFinish)) })
    // Critical in this iteration = on its driving path to the project finish.
    const onPath = new Set(r.longestPath)
    acts.forEach((a, i) => { if (onPath.has(a.id)) critical[i]++ })
  }

  const sorted = [...finishes].sort((a, b) => a - b)
  const q = (p: number) => fromDayNumber(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))])
  const mean = fromDayNumber(Math.round(finishes.reduce((x, y) => x + y, 0) / finishes.length))

  const lo = sorted[0], hi = sorted[sorted.length - 1]
  const bins = Math.min(20, Math.max(1, hi - lo + 1))
  const width = Math.max(1, Math.ceil((hi - lo + 1) / bins))
  const histogram: SraResult['histogram'] = []
  for (let b = lo; b <= hi; b += width) {
    histogram.push({ from: fromDayNumber(b), to: fromDayNumber(Math.min(hi, b + width - 1)), count: finishes.filter(f => f >= b && f < b + width).length })
  }

  const criticality = acts.map((a, i) => ({ id: a.id, code: a.code, name: a.name, index: critical[i] / budget }))
    .filter(c => c.index > 0 && acts.find(a => a.id === c.id)!.type === 'task')
    .sort((a, b) => b.index - a.index).slice(0, 15)
  const sensitivity = acts.map((a, i) => dists[i] && samples[i].length === finishes.length
    ? { id: a.id, code: a.code, name: a.name, correlation: spearman(samples[i], finishes), criticality: critical[i] / budget, basis: dists[i]!.basis }
    : null)
    .filter((x): x is NonNullable<typeof x> => !!x && x.criticality > 0.05)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 10)

  const eventStats = events.map(({ e, i }, k) => {
    const on = finishes.filter((_, it) => eventHits[k][it]), off = finishes.filter((_, it) => !eventHits[k][it])
    const avg = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length
    return {
      id: e.id, name: e.name, code: acts[i].code, probability: e.probability, impactDays: e.impactDays,
      occurred: on.length / budget, finishDeltaDays: on.length && off.length ? Math.round(avg(on) - avg(off)) : 0,
    }
  })
  const fixed = nameRules ? acts.filter((a, i) => kinds[i] === 'cure' && !userRanges.has(a.id) && !a.actualFinish && a.type === 'task').length : 0
  const procurementByName = nameRules ? acts.filter((a, i) => kinds[i] === 'procurement' && dists[i] && !userRanges.has(a.id)).length : 0
  const requiredDate = s.mustFinishBy
  const contingency = acts.find(a => a.category === 'contingency')
  // Tracked milestones: deterministic logic date (no sampling, no events) and the simulated spread.
  let milestones: SraMilestoneResult[] | undefined
  if (tracked.length) {
    const det = runCpm({ ...base, activities: relaxed })
    milestones = tracked.map((m, k) => {
      const a = acts[idx.get(m.id)!]
      const xs = [...msFinishes[k]].sort((x, y) => x - y)
      const qq = (p: number) => fromDayNumber(xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))])
      return {
        id: a.id, code: a.code, name: a.name, contract: !!m.contract, required: m.required, requiredSource: m.requiredSource ?? null,
        deterministic: det.times[a.id]?.earlyFinish ?? det.projectFinish, p50: qq(0.5), p80: qq(0.8),
        probability: m.required ? xs.filter(f => f <= toDayNumber(m.required!)).length / xs.length : null,
      }
    }).sort((x, y) => Number(y.contract) - Number(x.contract))
  }
  // A forecast past a supplier's committed delivery date is a problem in the schedule, not a risk.
  for (const c of commitments) {
    const t = s.cpm?.times[c.activityId]
    const a = acts[idx.get(c.activityId)!]
    if (t && t.earlyFinish > c.date) warnings.push(`${a.code} ${a.name} is forecast to finish ${us(t.earlyFinish)}, after its committed delivery date ${us(c.date)}: update the logic or the commitment.`)
  }
  return {
    method: `Monte Carlo schedule risk analysis: ${budget.toLocaleString()} iterations of the full CPM network with three-point (triangular) duration distributions, correlated field work (rho ${FIELD_RHO}), seeded for reproducibility.`,
    iterations: budget,
    seed,
    deterministic: s.cpm?.projectFinish || s.projectStart,
    percentiles: { p10: q(0.1), p50: q(0.5), p80: q(0.8), p90: q(0.9), mean },
    required: requiredDate ? { date: requiredDate, probability: finishes.filter(f => f <= toDayNumber(requiredDate)).length / budget } : undefined,
    histogram,
    criticality,
    sensitivity,
    assumptions: [
      'Scheduler duration overrides (e.g. vendor quotes) are simulated −5% / +15% around the overridden duration; permit reviews with an expected issuance date and fabrication with a committed delivery date are held near-deterministic (0 / +5%).',
      'Other agency review and fabrication ranges come from the regional permit and supplier lead-time catalogs (verify with the AHJ and suppliers).',
      firmHistory && !history ? 'Firm history is not used: the team opted out in the interview, so field and design ranges use standard three-point assumptions.'
        : history?.overallOverrunMedian ? 'Categories with firm history use your firm’s actual/planned ratios.' : 'No firm history yet: field and design ranges use standard three-point assumptions; upload completed projects to calibrate them.',
      'Field activities share a common productivity/weather factor (correlation 0.4).',
      contingency ? `The ${contingency.duration}-day contingency activity is excluded; the simulated uncertainty replaces it.` : 'No contingency activity in the schedule.',
      ...(userRanges.size ? [`${userRanges.size} activit${userRanges.size === 1 ? 'y uses' : 'ies use'} the scheduler's own optimistic / most likely / pessimistic range (work days of remaining work) instead of the rule-based range.`] : []),
      ...(commitments.length ? [`${commitments.length} activit${commitments.length === 1 ? 'y has' : 'ies have'} a committed delivery date and ${commitments.length === 1 ? 'is' : 'are'} held near-deterministic (0 / +5%).`] : []),
      ...(nameRules ? [`Activities are classified by name: ${procurementByName} fabrication / delivery / procurement / submittal activit${procurementByName === 1 ? 'y uses' : 'ies use'} a supplier range (−10% / +40%) outside the field productivity factor; ${fixed} cure activit${fixed === 1 ? 'y is' : 'ies are'} held at fixed duration unless given a range.`] : []),
      events.length
        ? `${events.length} discrete risk event${events.length === 1 ? ' is' : 's are'} sampled each iteration (probability × impact on the named activity), on top of the duration ranges.`
        : 'Discrete risk events (e.g. a failed inspection) are not modeled separately; they are reflected only through the duration ranges.',
      'Criticality index: the share of iterations in which the activity was on the driving (longest) path to the simulated project finish.',
    ],
    warnings,
    ...(opts.inputs ? { events: eventStats, inputsUsed: { ranges: userRanges.size, events: events.length, fixed, procurementByName, commitments: commitments.length } } : {}),
    ...(milestones ? { milestones } : {}),
    ms: Date.now() - started,
  }
}
