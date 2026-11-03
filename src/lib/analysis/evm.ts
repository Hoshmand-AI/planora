// Earned value management (EVM) for an uploaded schedule update, and its trend over the update series.
//
// Only real cost data is used. The costs come from the uploaded file itself (src/lib/parsers/costs.ts);
// nothing is estimated from durations, and when an input is missing the result says which one:
//   not_available  no cost data in the file, no budget, no baseline, no baseline budget, no baseline
//                  dates or no data date: nothing is computed
//   partial        budget, baseline and progress exist but actual costs do not: PV, EV, SV, SPI and the
//                  earned schedule are shown; AC, CV, CPI, EAC, ETC, VAC and TCPI are not (CPI is never
//                  computed without actual costs)
//   available      everything
//
// Definitions (per update, at its data date; every figure also per WBS node):
//   BAC  the designated baseline's budget (the baseline every other surface uses, baseline.ts):
//        a Baseline upload's budget, the embedded P6 project baseline's budget, or the file's own
//        baseline cost (MS Project Baseline Cost; P6 budgeted cost when the file's target dates are
//        the baseline, as P6 does when no baseline project is assigned)
//   PV   (BCWS) the baseline budget spread linearly over the working days of each activity's calendar
//        between its baseline start and finish, summed for the working days BEFORE the data date (the
//        data date is the first day not yet statused). When the file states BCWS for every budgeted
//        activity and the baseline is the file's own, the file's BCWS is used instead (stated).
//   EV   (BCWP) baseline budget × the percent complete the activity earns on (its P6 percent complete
//        type, MS Project earned value method, or the sheet's percent column; stated). Completed
//        work earns 100%; level-of-effort work earns its planned value.
//   AC   (ACWP) actual cost to date from the file.
//   SV = EV − PV, CV = EV − AC, SPI = EV / PV, CPI = EV / AC,
//   EAC (CPI) = BAC / CPI, EAC (CPI×SPI) = AC + (BAC − EV) / (CPI × SPI), ETC = EAC − AC, VAC = BAC − EAC,
//   TCPI (to BAC) = (BAC − EV) / (BAC − AC), TCPI (to EAC) = (BAC − EV) / (EAC − AC).
//   Earned schedule (time-based): ES = the time at which the baseline's cumulative PV equals EV
//   (interpolated by day), AT = data date − baseline start, SPI(t) = ES / AT, SV(t) = ES − AT
//   (calendar days), IEAC(t) = planned duration / SPI(t).
// Integrity checks are ORIENTED TO ANSI/EIA-748 earned value principles; they are data checks, not a
// compliance determination. Dates in text are MM/DD/YYYY. Pure, so it is unit tested.

import type { Activity } from '@/lib/db'
import type { WorkCalendar } from '@/lib/planning/types'
import type { BaselineSource } from './baseline'
import { compileCalendar, defaultCalendar, fromDayNumber, toDayNumber } from '@/lib/planning/calendar'
import type { ActivityCostRecord, CostSourceKind, EvPercentType } from '@/lib/parsers/costs'
import { fmtDate } from '@/lib/format'
import { seriesPeriods } from './windows'
import { EVM_PRINCIPLE_NOTE, fmtMoney, percentTypeLabel } from './evm-format'

export type EvmStatus = 'available' | 'partial' | 'not_available'

export type EvmMissingCode = 'no_cost_file' | 'no_cost_data' | 'no_budget' | 'no_baseline' | 'no_baseline_budget' | 'no_baseline_dates' | 'no_data_date' | 'no_actual_costs'

export interface EvmMissing { code: EvmMissingCode; message: string }

export interface EvmMetrics {
  bac: number; pv: number; ev: number; ac: number | null
  sv: number; cv: number | null
  spi: number | null; cpi: number | null
  eacCpi: number | null; eacCpiSpi: number | null
  etcCpi: number | null; etcCpiSpi: number | null
  vac: number | null
  tcpiBac: number | null; tcpiEac: number | null
  /** EV ÷ BAC (percent) */
  percentComplete: number | null
  /** AC ÷ BAC (percent) */
  percentSpent: number | null
  /** The file's own forecast at completion (actual + remaining cost), for reference */
  fileAtCompletion: number | null
}

export interface EarnedSchedule {
  baselineStart: string; baselineFinish: string
  /** Planned duration (calendar days) */
  pd: number
  /** Earned schedule and actual time (calendar days from the baseline start) */
  es: number; at: number
  esDate: string
  spiT: number | null
  svT: number
  /** Independent estimate at completion (time): PD / SPI(t), calendar days; and the date it gives */
  ieacT: number | null
  forecastFinish: string | null
}

export interface EvmWbsRow {
  key: string; label: string; level: number; activities: number
  bac: number; pv: number; ev: number; ac: number | null
  sv: number; cv: number | null; spi: number | null; cpi: number | null
}

export interface EvmActivityRow {
  code: string; name: string; wbs: string
  baselineBudget: number | null; budget: number | null
  pv: number; ev: number; ac: number | null
  percent: number; percentType: EvPercentType | 'loe' | 'complete' | null
  baselineStart: string | null; baselineFinish: string | null
}

export type EvmCheckId = 'baseline_budget_changed' | 'ev_without_actual_start' | 'ac_not_started' | 'progress_without_budget' | 'bac_mismatch' | 'negative_values'

export interface EvmCheck {
  id: EvmCheckId
  title: string
  /** The ANSI/EIA-748 principle the check is oriented to (not a compliance determination) */
  principle: string
  result: 'pass' | 'flag' | 'n/a'
  detail: string
  /** Evidence: activity ids (codes) */
  activityCodes: string[]
}

export interface EvmCurvePoint { date: string; pv: number }

export interface EvmAnalysis {
  status: EvmStatus
  missing: EvmMissing[]
  /** What is and is not shown, in plain words (partial results) */
  labels: string[]
  scheduleId: string; version: string; dataDate: string | null
  currency: { code: string | null; symbol: string | null }
  baseline: { source: BaselineSource; header: string }
  costSource: CostSourceKind | null
  methods: { bac: string; pv: string; ev: string; ac: string; es: string }
  metrics: EvmMetrics | null
  earnedSchedule: EarnedSchedule | null
  wbs: EvmWbsRow[]
  activities: EvmActivityRow[]
  /** Cumulative PV of the baseline over time (time-phased) */
  curve: EvmCurvePoint[]
  checks: EvmCheck[]
  notes: string[]
  /** Baseline budget per activity code (for the next update's checks) */
  baselineBudgetByCode: Record<string, number>
}

/** The cost data of the current file, keyed by activity code. */
export interface EvmCostInput {
  kind: CostSourceKind
  byCode: Record<string, ActivityCostRecord>
  fields: { budget: boolean; baselineBudget: boolean; actualCost: boolean; remainingCost: boolean; fileBcws: boolean; fileBcwp: boolean }
  currency: { code: string | null; symbol: string | null }
  evMethod: string
  notes?: string[]
}

export interface EvmInput {
  scheduleId: string
  version: string
  dataDate: string | null
  /** Activities with the resolved baseline's dates applied (applyBaseline) */
  activities: Pick<Activity, 'id' | 'activityId' | 'name' | 'wbs' | 'activityType' | 'status' | 'percentComplete' | 'actualStart' | 'actualFinish' | 'baselineStart' | 'baselineFinish' | 'calendarId'>[]
  calendars: WorkCalendar[]
  defaultCalendarId: string | null
  baseline: { source: BaselineSource; header: string; starts?: Record<string, string>; finishes?: Record<string, string> }
  /** null = the original file is not stored, or its format carries no cost fields */
  cost: EvmCostInput | null
  /** Why `cost` is null, when known ('no_cost_file' = no stored original file) */
  costMissing?: 'no_cost_file' | 'no_cost_data' | null
  /** The designated baseline's budget per activity code; null when the baseline carries none */
  baselineBudget: { byCode: Record<string, number>; basis: string } | null
  /** The previous update of the series (not superseded), for the between-update checks */
  prior?: { version: string; dataDate: string | null; bac: number | null; baselineHeader: string; baselineBudgetByCode: Record<string, number> } | null
}

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p
const ratio = (a: number, b: number | null | undefined): number | null => (b == null || Math.abs(b) < 1e-9 ? null : round(a / b, 3))
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null)
const isSummary = (a: { activityType: string }) => a.activityType === 'summary'
/** P6 cost data (XER or P6 XML): budgets are resource assignment and expense costs, summaries included. */
const isP6Cost = (kind: CostSourceKind) => kind === 'p6_xer' || kind === 'p6_xml'

export { EVM_PRINCIPLE_NOTE, fmtMoney, percentTypeLabel }

function notAvailable(input: EvmInput, missing: EvmMissing[], notes: string[] = []): EvmAnalysis {
  return {
    status: 'not_available', missing, labels: [`Earned value is not available: ${missing.map(m => m.message).join(' ')}`],
    scheduleId: input.scheduleId, version: input.version, dataDate: input.dataDate,
    currency: input.cost?.currency ?? { code: null, symbol: null },
    baseline: { source: input.baseline.source, header: input.baseline.header }, costSource: input.cost?.kind ?? null,
    methods: { bac: '', pv: '', ev: '', ac: '', es: '' },
    metrics: null, earnedSchedule: null, wbs: [], activities: [], curve: [], checks: [], notes: [...(input.cost?.notes ?? []), ...notes],
    baselineBudgetByCode: input.baselineBudget?.byCode ?? {},
  }
}

/** Data-sufficiency gate: the inputs earned value cannot be computed without. */
export function evmMissingInputs(input: EvmInput): EvmMissing[] {
  const out: EvmMissing[] = []
  if (!input.cost) {
    out.push(input.costMissing === 'no_cost_file'
      ? { code: 'no_cost_file', message: 'The original file of this upload is not stored, so its cost fields cannot be read. Upload the file again.' }
      : { code: 'no_cost_data', message: 'The file carries no cost data (no budgets or actual costs: P6 resource assignments / expenses, MS Project Cost fields or cost columns).' })
    return out
  }
  const budgets = Object.values(input.cost.byCode)
  if (!budgets.some(r => (r.budget ?? 0) !== 0 || (r.baselineBudget ?? 0) !== 0)) out.push({ code: 'no_budget', message: 'No activity carries a budget (budgeted or baseline cost), so there is nothing to earn.' })
  if (input.baseline.source === 'none') out.push({ code: 'no_baseline', message: 'There is no baseline. Mark an upload of this project as Baseline, or export the P6 project baseline (or MS Project baseline) with the update.' })
  else if (!input.baselineBudget || !Object.values(input.baselineBudget.byCode).some(v => v !== 0)) {
    out.push({ code: 'no_baseline_budget', message: input.baseline.source === 'file' && !isP6Cost(input.cost.kind)
      ? 'The baseline dates in the file carry no baseline cost (MS Project: save the baseline after loading costs so Baseline Cost is set; spreadsheets: add a Baseline cost column).'
      : 'The designated baseline carries no budget (its file has no cost data).' })
  }
  if (!input.dataDate) out.push({ code: 'no_data_date', message: 'The file has no data date (status date), so planned and earned value have no "as of" date.' })
  return out
}

interface PlanItem { code: string; budget: number; start: string | null; finish: string | null; cal: WorkCalendar; loe: boolean }

/** Linear spread of each plan item's budget over the working days of its calendar, as daily increments. */
function timePhase(items: PlanItem[]) {
  const dated = items.filter(i => i.start && i.finish && i.budget !== 0)
  if (!dated.length) return null
  const s0 = Math.min(...dated.map(i => toDayNumber(i.start!)))
  const f0 = Math.max(...dated.map(i => toDayNumber(i.finish!)))
  const inc = new Float64Array(f0 - s0 + 2)
  const perItem = new Map<string, { s: number; f: number; perDay: number; days: number[] }>()
  for (const i of dated) {
    const c = compileCalendar(i.cal)
    let s = toDayNumber(i.start!), f = toDayNumber(i.finish!)
    if (f < s) [s, f] = [f, s]
    const days: number[] = []
    for (let n = s; n <= f; n++) if (c.isWork(n)) days.push(n)
    // No working day in the window (e.g. a milestone on a holiday): the budget is planned on the finish day.
    if (!days.length) days.push(f)
    const perDay = i.budget / days.length
    for (const n of days) inc[n - s0] += perDay
    perItem.set(i.code, { s, f, perDay, days })
  }
  // cum[k] = PV planned BEFORE day s0 + k
  const cum = new Float64Array(inc.length + 1)
  for (let k = 0; k < inc.length; k++) cum[k + 1] = cum[k] + inc[k]
  const pvAt = (date: string) => {
    const k = toDayNumber(date) - s0
    return k <= 0 ? 0 : k >= cum.length ? cum[cum.length - 1] : cum[k]
  }
  const itemPvAt = (code: string, date: string) => {
    const p = perItem.get(code)
    if (!p) return 0
    const dd = toDayNumber(date)
    let n = 0
    for (const x of p.days) if (x < dd) n++
    return n * p.perDay
  }
  return { s0, f0, cum, pvAt, itemPvAt }
}

/** WBS ancestors of a path "CIV.EARTH Earthwork" → ["CIV", "CIV.EARTH"] (with the leaf's name on its own node). */
function wbsNodes(wbs: string): { key: string; label: string; level: number }[] {
  const w = (wbs || '').trim()
  if (!w) return [{ key: '(no WBS)', label: '(no WBS)', level: 0 }]
  const sp = w.indexOf(' ')
  const code = sp > 0 ? w.slice(0, sp) : w
  const name = sp > 0 ? w.slice(sp + 1).trim() : ''
  const parts = code.split('.').filter(Boolean)
  return parts.map((_, i) => {
    const key = parts.slice(0, i + 1).join('.')
    return { key, label: i === parts.length - 1 && name ? `${key} ${name}` : key, level: i }
  })
}

export function computeEvm(input: EvmInput): EvmAnalysis {
  const missing = evmMissingInputs(input)
  if (missing.length) return notAvailable(input, missing)
  const cost = input.cost!
  const dd = day(input.dataDate)!
  const bb = input.baselineBudget!
  const notes: string[] = [...(cost.notes ?? [])]
  const calById = new Map(input.calendars.map(c => [c.id, c]))
  const defCal = (input.defaultCalendarId && calById.get(input.defaultCalendarId)) || input.calendars[0] || defaultCalendar()
  const work = input.activities.filter(a => !isSummary(a) || isP6Cost(cost.kind))
  const byCode = new Map(work.map(a => [a.activityId, a]))

  // The baseline plan: every activity code the baseline budgets, with its baseline dates.
  const plan: PlanItem[] = []
  const undated: string[] = []
  for (const [code, budget] of Object.entries(bb.byCode)) {
    const a = byCode.get(code)
    const start = day(a ? a.baselineStart : input.baseline.starts?.[code]) ?? null
    const finish = day(a ? a.baselineFinish : input.baseline.finishes?.[code]) ?? start
    if (budget !== 0 && (!start || !finish)) undated.push(code)
    plan.push({ code, budget, start: start ?? finish, finish, cal: (a?.calendarId && calById.get(a.calendarId)) || defCal, loe: a?.activityType === 'loe' })
  }
  const tp = timePhase(plan)
  if (!tp) return notAvailable(input, [{ code: 'no_baseline_dates', message: 'No budgeted activity has baseline start and finish dates, so the budget cannot be time-phased into planned value.' }])
  const bac = round(plan.reduce((t, p) => t + p.budget, 0))
  if (undated.length) notes.push(`${undated.length} budgeted ${undated.length === 1 ? 'activity has' : 'activities have'} no baseline dates (${undated.slice(0, 8).join(', ')}${undated.length > 8 ? ', …' : ''}); ${undated.length === 1 ? 'its' : 'their'} budget is in BAC but not in planned value.`)
  const deleted = plan.filter(p => !byCode.has(p.code) && p.budget !== 0)
  if (deleted.length) notes.push(`${deleted.length} baseline ${deleted.length === 1 ? 'activity is' : 'activities are'} not in this update (${deleted.slice(0, 8).map(p => p.code).join(', ')}${deleted.length > 8 ? ', …' : ''}); ${fmtMoney(deleted.reduce((t, p) => t + p.budget, 0), cost.currency)} of BAC can no longer be earned on ${deleted.length === 1 ? 'it' : 'them'}.`)

  // PV at the data date: time-phased, or the file's BCWS when it states it for every budgeted activity and the baseline is the file's own.
  const budgeted = work.filter(a => (bb.byCode[a.activityId] ?? 0) !== 0)
  const fileBcwsAll = input.baseline.source === 'file' && cost.fields.fileBcws && budgeted.length > 0 && budgeted.every(a => cost.byCode[a.activityId]?.fileBcws != null)
  const pvTimePhased = tp.pvAt(dd)
  const pvItem = (code: string) => (fileBcwsAll ? cost.byCode[code]?.fileBcws ?? 0 : tp.itemPvAt(code, dd))

  // Actual costs: available when the file carries them and they are recorded (not all zero on progressed work).
  const acField = cost.fields.actualCost
  let acTotal = 0
  for (const a of work) acTotal += cost.byCode[a.activityId]?.actualCost ?? cost.byCode[a.activityId]?.fileAcwp ?? 0

  const rows: EvmActivityRow[] = []
  let evTotal = 0, pvSum = 0
  for (const a of work) {
    const c = cost.byCode[a.activityId]
    const blBudget = bb.byCode[a.activityId] ?? null
    const done = !!a.actualFinish || a.status === 'complete'
    let percent: number
    let percentType: EvmActivityRow['percentType']
    const pv = round(pvItem(a.activityId))
    let ev: number
    if (a.activityType === 'loe') { percentType = 'loe'; ev = Math.min(pv, blBudget ?? 0); percent = blBudget ? round((100 * ev) / blBudget, 1) : 0 }
    else {
      if (done) { percent = 100; percentType = 'complete' }
      else if (c?.evPercent != null) { percent = c.evPercent; percentType = c.evPercentType }
      else { percent = Math.max(0, Math.min(100, a.percentComplete || 0)); percentType = 'file_percent' }
      ev = round(((blBudget ?? 0) * percent) / 100)
    }
    evTotal += ev
    pvSum += pv
    rows.push({
      code: a.activityId, name: a.name, wbs: a.wbs || '', baselineBudget: blBudget, budget: c?.budget ?? null,
      pv, ev, ac: acField ? c?.actualCost ?? c?.fileAcwp ?? 0 : null, percent: round(percent, 1), percentType,
      baselineStart: day(a.baselineStart), baselineFinish: day(a.baselineFinish),
    })
  }
  const added = rows.filter(r => r.baselineBudget == null && (r.budget ?? 0) > 0)
  if (added.length) notes.push(`${added.length} ${added.length === 1 ? 'activity has' : 'activities have'} a budget but no baseline budget (added after the baseline: ${added.slice(0, 8).map(r => r.code).join(', ')}${added.length > 8 ? ', …' : ''}); ${added.length === 1 ? 'it earns' : 'they earn'} no value until the baseline is revised.`)
  // Baseline activities deleted since the baseline still carry planned value.
  for (const p of deleted) pvSum += tp.itemPvAt(p.code, dd)
  const pv = round(fileBcwsAll ? pvSum : pvTimePhased)
  const ev = round(evTotal)
  const labels: string[] = []
  const missing2: EvmMissing[] = []
  let ac: number | null = acField ? round(acTotal) : null
  if (!acField) missing2.push({ code: 'no_actual_costs', message: 'The file carries no actual costs.' })
  else if (ac === 0 && ev > 0) { ac = null; missing2.push({ code: 'no_actual_costs', message: 'The file\'s actual cost fields are all zero although work has been earned, so actual costs are not recorded in the schedule.' }) }
  if (ac == null) {
    for (const r of rows) r.ac = null
    labels.push('Partial: planned value (PV), earned value (EV), SV, SPI and earned schedule only. Actual cost (AC) is missing, so CV, CPI, EAC, ETC, VAC and TCPI are not computed.')
  }

  // Indices and forecasts.
  // Forecasts use the unrounded indices; only the reported figures are rounded.
  const rawSpi = Math.abs(pv) > 1e-9 ? ev / pv : null
  const rawCpi = ac != null && Math.abs(ac) > 1e-9 ? ev / ac : null
  const spi = ratio(ev, pv)
  const cpi = ac == null ? null : ratio(ev, ac)
  const eacCpi = rawCpi ? round(bac / rawCpi) : null
  const eacCpiSpi = ac != null && rawCpi && rawSpi ? round(ac + (bac - ev) / (rawCpi * rawSpi)) : null
  const fileAtCompletion = cost.fields.actualCost && cost.fields.remainingCost
    ? round(work.reduce((t, a) => t + (cost.byCode[a.activityId]?.actualCost ?? 0) + (cost.byCode[a.activityId]?.remainingCost ?? 0), 0)) : null
  const metrics: EvmMetrics = {
    bac, pv, ev, ac,
    sv: round(ev - pv), cv: ac == null ? null : round(ev - ac),
    spi, cpi, eacCpi, eacCpiSpi,
    etcCpi: eacCpi != null && ac != null ? round(eacCpi - ac) : null,
    etcCpiSpi: eacCpiSpi != null && ac != null ? round(eacCpiSpi - ac) : null,
    vac: eacCpi != null ? round(bac - eacCpi) : null,
    tcpiBac: ac == null ? null : ratio(bac - ev, bac - ac),
    tcpiEac: ac == null || eacCpi == null ? null : ratio(bac - ev, eacCpi - ac),
    percentComplete: bac ? round((100 * ev) / bac, 1) : null,
    percentSpent: ac != null && bac ? round((100 * ac) / bac, 1) : null,
    fileAtCompletion,
  }
  if (metrics.tcpiBac == null && ac != null && Math.abs(bac - ac) < 1e-9) labels.push('TCPI to BAC is not defined: actual cost has reached BAC.')

  // Earned schedule from the time-phased PV.
  let earnedSchedule: EarnedSchedule | null = null
  const ddn = toDayNumber(dd)
  const at = ddn - tp.s0
  if (at > 0) {
    const cum = tp.cum
    let es: number
    const top = cum[cum.length - 1]
    if (ev >= top - 1e-6) es = tp.f0 + 1 - tp.s0
    else {
      let C = 0
      while (C + 1 < cum.length && cum[C + 1] <= ev + 1e-9) C++
      const nextDiff = C + 1 < cum.length ? cum[C + 1] - cum[C] : 0
      es = C + (nextDiff > 0 ? (ev - cum[C]) / nextDiff : 0)
    }
    const pd = tp.f0 + 1 - tp.s0
    const spiT = ratio(es, at)
    const ieacT = spiT ? round(pd / spiT, 1) : null
    earnedSchedule = {
      baselineStart: fromDayNumber(tp.s0), baselineFinish: fromDayNumber(tp.f0), pd, es: round(es, 2), at, esDate: fromDayNumber(tp.s0 + Math.floor(es)),
      spiT, svT: round(es - at, 1), ieacT, forecastFinish: ieacT != null ? fromDayNumber(tp.s0 + Math.ceil(ieacT) - 1) : null,
    }
  }

  // WBS roll-up (every level of the WBS path).
  const wbsMap = new Map<string, EvmWbsRow>()
  for (const r of rows) {
    for (const n of wbsNodes(r.wbs)) {
      const w = wbsMap.get(n.key) ?? { key: n.key, label: n.label, level: n.level, activities: 0, bac: 0, pv: 0, ev: 0, ac: ac == null ? null : 0, sv: 0, cv: null, spi: null, cpi: null }
      if (n.label.length > w.label.length) w.label = n.label
      w.activities++
      w.bac += r.baselineBudget ?? 0
      w.pv += r.pv
      w.ev += r.ev
      if (w.ac != null) w.ac += r.ac ?? 0
      wbsMap.set(n.key, w)
    }
  }
  const wbs = [...wbsMap.values()].map(w => ({
    ...w, bac: round(w.bac), pv: round(w.pv), ev: round(w.ev), ac: w.ac == null ? null : round(w.ac),
    sv: round(w.ev - w.pv), cv: w.ac == null ? null : round(w.ev - w.ac), spi: ratio(w.ev, w.pv), cpi: w.ac == null ? null : ratio(w.ev, w.ac),
  })).sort((x, y) => x.key.localeCompare(y.key))

  // Cumulative PV curve: weekly (coarser for long projects), plus the data date and the baseline finish.
  const span = tp.f0 + 1 - tp.s0
  const step = Math.max(7, Math.ceil(span / 150))
  const pts = new Set<number>()
  for (let n = tp.s0; n <= tp.f0 + 1; n += step) pts.add(n)
  pts.add(tp.f0 + 1)
  if (ddn >= tp.s0 && ddn <= tp.f0 + 1) pts.add(ddn)
  const curve = [...pts].sort((a, b) => a - b).map(n => ({ date: fromDayNumber(n), pv: round(tp.pvAt(fromDayNumber(n))) }))

  const checks = evmChecks(input, rows, bac)
  const status: EvmStatus = missing2.length ? 'partial' : 'available'
  return {
    status, missing: missing2, labels,
    scheduleId: input.scheduleId, version: input.version, dataDate: dd,
    currency: cost.currency, baseline: { source: input.baseline.source, header: input.baseline.header }, costSource: cost.kind,
    methods: {
      bac: `Sum of the baseline budget: ${bb.basis}.`,
      pv: fileBcwsAll ? 'The file\'s own BCWS (MS Project / sheet), stated for every budgeted activity against the file\'s baseline.'
        : `Time-phased from the baseline budget: spread linearly over the working days of each activity's calendar between its baseline start and finish, summed for the working days before the data date ${fmtDate(dd)}.`,
      ev: `Baseline budget × percent complete. ${cost.evMethod} Completed activities earn 100%; level-of-effort activities earn their planned value.`,
      ac: ac == null ? 'Not available.' : isP6Cost(cost.kind) ? 'Actual cost to date: P6 resource assignment actual regular + overtime cost plus expense actual cost.' : cost.kind === 'ms_xml' ? 'Actual cost to date: MS Project Actual Cost.' : "Actual cost to date: the sheet's actual cost column.",
      es: 'Earned schedule: the day on which the baseline\'s cumulative planned value equals EV (interpolated), measured in calendar days from the baseline start; SPI(t) = ES ÷ AT, SV(t) = ES − AT.',
    },
    metrics, earnedSchedule, wbs, activities: rows, curve, checks, notes,
    baselineBudgetByCode: bb.byCode,
  }
}

/** Integrity checks oriented to ANSI/EIA-748 principles (data checks, not a compliance determination). */
export function evmChecks(input: EvmInput, rows: EvmActivityRow[], bac: number): EvmCheck[] {
  const cost = input.cost!
  const acts = new Map(input.activities.map(a => [a.activityId, a]))
  const out: EvmCheck[] = []
  const check = (id: EvmCheckId, title: string, principle: string, codes: string[], flagged: string, ok: string, na?: string | null) =>
    out.push({ id, title, principle, result: na ? 'n/a' : codes.length ? 'flag' : 'pass', detail: na ?? (codes.length ? flagged.replace('{n}', String(codes.length)) : ok), activityCodes: codes })

  // 1. Baseline budget changed vs the prior update's baseline, with no recorded revision (same baseline designation).
  const prior = input.prior
  if (!prior) check('baseline_budget_changed', 'Baseline budget changed without a recorded revision', 'Baseline control: changes to the performance measurement baseline are made through a recorded revision.', [], '', '', 'Needs an earlier update of this project to compare with.')
  else if (prior.baselineHeader !== input.baseline.header) {
    check('baseline_budget_changed', 'Baseline budget changed without a recorded revision', 'Baseline control: changes to the performance measurement baseline are made through a recorded revision.', [], '', `The baseline was re-designated since ${prior.version} (from "${prior.baselineHeader.replace(/^Baseline:\s*/, '')}"): a recorded revision, so budget changes are expected.`)
  } else {
    const codes = new Set([...Object.keys(prior.baselineBudgetByCode), ...Object.keys(input.baselineBudget?.byCode ?? {})])
    const changed = [...codes].filter(c => Math.abs((prior.baselineBudgetByCode[c] ?? 0) - (input.baselineBudget?.byCode[c] ?? 0)) > 0.005).sort()
    check('baseline_budget_changed', 'Baseline budget changed without a recorded revision', 'Baseline control: changes to the performance measurement baseline are made through a recorded revision.', changed,
      `{n} activities have a different baseline budget than in ${prior.version} although the baseline designation is the same (no recorded revision).`, `Baseline budgets match ${prior.version}.`)
  }
  // 2. EV on activities with no actual start.
  check('ev_without_actual_start', 'Earned value on activities with no actual start', 'Performance is measured on work that has actually begun (objective indicators of accomplishment).',
    rows.filter(r => r.ev > 0 && r.percentType !== 'loe' && !acts.get(r.code)?.actualStart).map(r => r.code),
    '{n} activities earn value but have no actual start date.', 'Every activity earning value has an actual start.')
  // 3. AC on not-started activities.
  check('ac_not_started', 'Actual cost on activities not started', 'Actual costs are recorded consistently with the work performed.',
    cost.fields.actualCost ? rows.filter(r => (cost.byCode[r.code]?.actualCost ?? 0) > 0 && !acts.get(r.code)?.actualStart && acts.get(r.code)?.status === 'not_started').map(r => r.code) : [],
    '{n} activities carry actual cost but have not started.', 'No actual cost on not-started activities.', cost.fields.actualCost ? null : 'The file carries no actual costs.')
  // 4. Percent complete > 0 with zero budget.
  check('progress_without_budget', 'Progress on activities with no budget', 'Work is budgeted where it is performed, so progress earns value.',
    rows.filter(r => r.percentType !== 'loe' && r.percent > 0 && !(r.baselineBudget ?? 0) && acts.get(r.code)?.activityType !== 'milestone').map(r => r.code),
    '{n} activities report progress but have no baseline budget, so their progress earns no value.', 'Every activity reporting progress has a baseline budget.')
  // 5. BAC mismatch between updates.
  if (!prior || prior.bac == null) check('bac_mismatch', 'BAC changed between updates', 'Budget at completion is stable unless the baseline is revised.', [], '', '', 'Needs an earlier update with earned value to compare with.')
  else {
    const same = Math.abs(prior.bac - bac) < 0.005
    out.push({ id: 'bac_mismatch', title: 'BAC changed between updates', principle: 'Budget at completion is stable unless the baseline is revised.', result: same ? 'pass' : 'flag',
      detail: same ? `BAC equals ${prior.version}'s (${fmtMoney(bac, cost.currency)}).` : `BAC is ${fmtMoney(bac, cost.currency)}; it was ${fmtMoney(prior.bac, cost.currency)} in ${prior.version} (${bac > prior.bac ? '+' : '−'}${fmtMoney(Math.abs(bac - prior.bac), cost.currency)})${prior.baselineHeader !== input.baseline.header ? ', after the baseline was re-designated' : ', with the same baseline designation'}.`,
      activityCodes: [] })
  }
  // 6. Negative values.
  const neg = new Set<string>()
  for (const [code, r] of Object.entries(cost.byCode)) if ([r.budget, r.baselineBudget, r.actualCost, r.remainingCost, r.fileBcws, r.fileBcwp].some(v => v != null && v < 0)) neg.add(code)
  for (const [code, v] of Object.entries(input.baselineBudget?.byCode ?? {})) if (v < 0) neg.add(code)
  check('negative_values', 'Negative cost values', 'Budgets and actual costs are recorded as positive amounts (credits are explained).', [...neg].sort(),
    '{n} activities carry a negative budget, actual, remaining or earned value figure.', 'No negative cost values.')
  return out
}

/* ─── Series trend ─────────────────────────────────────── */

export interface EvmTrendPoint {
  scheduleId: string; version: string; dataDate: string | null; status: EvmStatus
  bac: number | null; pv: number | null; ev: number | null; ac: number | null
  sv: number | null; cv: number | null; spi: number | null; cpi: number | null; spiT: number | null; eacCpi: number | null
}

export interface EvmSeries {
  points: EvmTrendPoint[]
  superseded: { id: string; version: string; dataDate: string | null }[]
  notes: string[]
  /** The latest analyzed update's full result (with between-update checks) */
  latest: EvmAnalysis | null
}

/**
 * Earned value per update of a series ordered by data date (orderSeries). A reissue with the same
 * data date supersedes the earlier upload (seriesPeriods, as the windows analysis does), so the trend
 * has one point per period. Each update's between-update checks compare with the previous point.
 */
export function evmSeries(updates: { input: EvmInput }[]): EvmSeries {
  const wrapped = updates.map(u => ({ schedule: { id: u.input.scheduleId, version: u.input.version, dataDate: u.input.dataDate }, input: u.input }))
  const { used, periods } = seriesPeriods(wrapped)
  const points: EvmTrendPoint[] = []
  let prev: EvmAnalysis | null = null
  let latest: EvmAnalysis | null = null
  for (const u of used) {
    const r: EvmAnalysis = computeEvm({ ...u.input, prior: prev && prev.metrics ? { version: prev.version, dataDate: prev.dataDate, bac: prev.metrics.bac, baselineHeader: prev.baseline.header, baselineBudgetByCode: prev.baselineBudgetByCode } : null })
    const m = r.metrics
    points.push({ scheduleId: r.scheduleId, version: r.version, dataDate: r.dataDate, status: r.status, bac: m?.bac ?? null, pv: m?.pv ?? null, ev: m?.ev ?? null, ac: m?.ac ?? null, sv: m?.sv ?? null, cv: m?.cv ?? null, spi: m?.spi ?? null, cpi: m?.cpi ?? null, spiT: r.earnedSchedule?.spiT ?? null, eacCpi: m?.eacCpi ?? null })
    if (r.metrics) prev = r
    latest = r
  }
  const superseded = periods.flatMap(p => p.superseded.map(s => ({ id: s.id, version: s.version, dataDate: p.dataDate })))
  const notes = periods.filter(p => p.superseded.length).map(p => `${p.uploads} uploads have the data date ${fmtDate(p.dataDate)}; ${p.superseded.map(x => x.version).join(', ')} ${p.superseded.length === 1 ? 'is' : 'are'} superseded by the reissue ${p.analyzed.map(x => x.version).join(', ')} and left out of the trend.`)
  const na = points.filter(p => p.status === 'not_available')
  if (na.length) notes.push(`${na.length} update${na.length === 1 ? ' has' : 's have'} no earned value (missing cost or baseline data): ${na.map(p => p.version).join(', ')}.`)
  return { points, superseded, notes, latest }
}

/* ─── Report section ───────────────────────────────────── */

const fmtIdx = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2))

/** Markdown for the variance / executive report; [] when earned value is not available (the section is omitted). */
export function evmMarkdown(e: EvmAnalysis | null | undefined, trend?: EvmTrendPoint[] | null): string[] {
  if (!e || e.status === 'not_available' || !e.metrics) return []
  const m = e.metrics
  const $ = (n: number | null | undefined) => fmtMoney(n, e.currency)
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '/')
  const t = (head: string[], rows: unknown[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n')
  const es = e.earnedSchedule
  const flagged = e.checks.filter(c => c.result === 'flag')
  return [
    '## Earned value (cost and schedule performance)',
    `${e.baseline.header}. Data date ${fmtDate(e.dataDate)}.${e.status === 'partial' ? ` **${e.labels[0]}**` : ''}`, '',
    t(['Measure', 'Value', 'Meaning'], [
      ['BAC (budget at completion)', $(m.bac), 'Total baseline budget'],
      ['PV (planned value, BCWS)', $(m.pv), 'Budget of the work planned by the data date'],
      ['EV (earned value, BCWP)', $(m.ev), 'Budget of the work actually done'],
      ['AC (actual cost, ACWP)', $(m.ac), 'What the work done actually cost'],
      ['SV = EV − PV', $(m.sv), m.sv < 0 ? 'Less work done than planned' : 'At or ahead of plan'],
      ['CV = EV − AC', $(m.cv), m.cv == null ? 'Needs actual cost' : m.cv < 0 ? 'Work done cost more than its budget' : 'At or under budget for the work done'],
      ['SPI = EV ÷ PV', fmtIdx(m.spi), m.spi == null ? '—' : `${Math.round(m.spi * 100)} cents of planned work done per dollar planned`],
      ['CPI = EV ÷ AC', fmtIdx(m.cpi), m.cpi == null ? 'Needs actual cost' : `${Math.round(m.cpi * 100)} cents of budgeted work per dollar spent`],
      ['EAC (BAC ÷ CPI)', $(m.eacCpi), 'Forecast cost at completion if cost efficiency continues'],
      ['EAC (AC + (BAC − EV) ÷ (CPI × SPI))', $(m.eacCpiSpi), 'Forecast if both cost and schedule efficiency continue'],
      ['ETC (EAC − AC, CPI method)', $(m.etcCpi), 'Cost still to spend'],
      ['VAC (BAC − EAC)', $(m.vac), m.vac == null ? '—' : m.vac < 0 ? 'Forecast overrun' : 'Forecast underrun'],
      ['TCPI to BAC', fmtIdx(m.tcpiBac), 'Cost efficiency needed on remaining work to finish on budget'],
      ['TCPI to EAC', fmtIdx(m.tcpiEac), 'Cost efficiency needed to finish at the CPI-method EAC'],
      ...(es ? [
        ['Earned schedule ES / actual time AT', `${es.es} / ${es.at} cd`, `Work done was planned by ${fmtDate(es.esDate)}`],
        ['SPI(t) = ES ÷ AT', fmtIdx(es.spiT), 'Time-based schedule efficiency'],
        ['SV(t) = ES − AT', `${es.svT > 0 ? '+' : ''}${es.svT} cd`, es.svT < 0 ? 'Calendar days behind the baseline plan' : 'At or ahead of the baseline plan'],
        ['IEAC(t) (planned duration ÷ SPI(t))', es.forecastFinish ? `${fmtDate(es.forecastFinish)} (${es.ieacT} cd)` : '—', `Baseline finish ${fmtDate(es.baselineFinish)}`],
      ] : []),
    ]), '',
    `_Methods. BAC: ${e.methods.bac} PV: ${e.methods.pv} EV: ${e.methods.ev} AC: ${e.methods.ac}_`, '',
    '### By WBS (top level)', t(['WBS', 'BAC', 'PV', 'EV', 'AC', 'SPI', 'CPI'], e.wbs.filter(w => w.level === 0).map(w => [w.label, $(w.bac), $(w.pv), $(w.ev), $(w.ac), fmtIdx(w.spi), fmtIdx(w.cpi)])), '',
    ...(trend && trend.length > 1 ? ['### Trend by update', t(['Update', 'Data date', 'PV', 'EV', 'AC', 'SPI', 'CPI', 'SPI(t)'], trend.map(p => [p.version, fmtDate(p.dataDate), $(p.pv), $(p.ev), $(p.ac), fmtIdx(p.spi), fmtIdx(p.cpi), fmtIdx(p.spiT)])), ''] : []),
    '### Earned value data integrity', `_${EVM_PRINCIPLE_NOTE}_`, '',
    flagged.length ? t(['Check', 'Finding', 'Activities'], flagged.map(c => [c.title, c.detail, c.activityCodes.slice(0, 12).join(', ') + (c.activityCodes.length > 12 ? ` (+${c.activityCodes.length - 12})` : '')])) : '_No findings._',
    ...(e.notes.length ? ['', ...e.notes.map(n => `- ${n}`)] : []),
  ]
}
