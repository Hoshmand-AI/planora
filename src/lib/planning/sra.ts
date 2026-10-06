// Probabilistic Schedule Risk Analysis (Monte Carlo).
//
// Each iteration samples every remaining task's duration from a three-point (triangular)
// distribution and recomputes the full CPM network (all calendars, relationship types, lags and
// constraints), so merge bias and path switching are captured, not just the deterministic critical
// path. Results: finish-date percentiles, probability of meeting the required date, a histogram,
// each activity's criticality index (share of iterations it was critical) and a sensitivity
// ranking (Spearman rank correlation between an activity's sampled duration and the finish).
//
// Uncertainty sources, per activity (multipliers of the planned duration):
//   - agency reviews and fabrication: the regional permit / supplier lead-time catalog
//     (low / typical / high) relative to the planned duration;
//   - categories with firm history: the firm's own actual/planned ratios (median and P80);
//   - otherwise by kind of work (design, field, other), widened for low-confidence estimates
//     and narrowed for high-confidence ones.
// Correlation: field activities share a common productivity/weather factor through a Gaussian
// copula (rho = 0.4), so they tend to run long or short together, as on real projects.
// The contingency activity is set to zero in the simulation: explicit uncertainty replaces the
// lump buffer, so risk is not counted twice.
// Sampling is seeded from the schedule, so the same schedule always gives the same result.

import type { GeneratedSchedule, PlanActivity, Answer } from './types'
import type { FirmHistory } from './history'
import { runCpm } from './cpm'
import { toDayNumber, fromDayNumber } from './calendar'
import { questionBank } from './elicitation'

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
  ms: number
}

const FIELD_RHO = 0.4

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

/** The three-point estimate for one activity, as multipliers of its planned duration. */
export function distributionFor(a: PlanActivity, ctx: { history: FirmHistory | null; catalog: Map<string, { low: number; typical: number; high: number; label: string }> }): Triangular | null {
  if (a.type === 'milestone' || a.duration <= 0 || a.actualFinish || a.category === 'contingency') return null
  const planned = a.duration
  const cat = ctx.catalog.get(a.id)
  let d: Triangular
  if (cat && a.calendarId === 'cal-7d') {
    const lo = (cat.low * 7) / planned, ty = (cat.typical * 7) / planned, hi = (cat.high * 7) / planned
    d = { min: Math.min(lo, ty, 1), mode: Math.max(Math.min(ty, hi), lo), max: Math.max(hi, ty, 1), basis: `${cat.label}: catalog ${cat.low}–${cat.typical}–${cat.high} weeks` }
  } else if (a.rationale.sources.some(s => s.kind === 'firm_history')) {
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

export function runSra(s: GeneratedSchedule, answers: Record<string, Answer>, history: FirmHistory | null, opts: { iterations?: number; seed?: number } = {}): SraResult {
  const started = Date.now()
  const bank = questionBank({ answers })
  const catalog = new Map<string, { low: number; typical: number; high: number; label: string }>()
  for (const p of bank.permits) catalog.set(`permit-${p.id}`, { ...p.reviewWeeks, label: `${p.name} review` })
  for (const l of bank.longLead) catalog.set(`ll-${l.id}-fab`, { ...l.leadWeeks, label: `${l.name} lead time` })

  const acts = s.activities
  const dists = acts.map(a => distributionFor(a, { history, catalog }))
  const field = acts.map(isField)
  const budget = opts.iterations ?? Math.max(200, Math.min(1000, Math.floor(400_000 / Math.max(1, acts.length))))
  const seed = opts.seed ?? hashSeed(`${s.generatedAt}|${acts.length}|${s.links.length}`)
  const rand = mulberry32(seed)

  const finishes: number[] = []
  const samples: number[][] = acts.map(() => [])
  const critical = new Array<number>(acts.length).fill(0)
  const base = { projectStart: s.projectStart, dataDate: s.dataDate, links: s.links, calendars: s.calendars, defaultCalendarId: s.defaultCalendarId }

  for (let it = 0; it < budget; it++) {
    const zg = normal(rand)
    const simActs = acts.map((a, i) => {
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
    const r = runCpm({ ...base, activities: simActs })
    // The logic-driven finish: a mandatory constraint must not hide the simulated spread.
    finishes.push(toDayNumber(r.logicFinish || r.projectFinish))
    acts.forEach((a, i) => { if (r.times[a.id]?.critical) critical[i]++ })
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

  const requiredDate = s.mustFinishBy
  const contingency = acts.find(a => a.category === 'contingency')
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
      'Agency review and fabrication ranges come from the regional permit and supplier lead-time catalogs (verify with the AHJ and suppliers).',
      history?.overallOverrunMedian ? 'Categories with firm history use your firm’s actual/planned ratios.' : 'No firm history yet: field and design ranges use standard three-point assumptions; upload completed projects to calibrate them.',
      'Field activities share a common productivity/weather factor (correlation 0.4).',
      contingency ? `The ${contingency.duration}-day contingency activity is excluded; the simulated uncertainty replaces it.` : 'No contingency activity in the schedule.',
      'Discrete risk events (e.g. a failed inspection) are not modeled separately; they are reflected only through the duration ranges.',
    ],
    ms: Date.now() - started,
  }
}
