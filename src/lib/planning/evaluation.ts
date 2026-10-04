// Proving the schedule is good:
//   1. Structural quality — DCMA 14-point on the generated network
//   2. Realism — durations vs how the firm's past projects ACTUALLY went
//   3. Risk-adjusted finish — P50/P80 dates from actual overrun ratios (or catalog high ranges)
//   4. Coverage — every applicable permit and long-lead item is scheduled or explicitly resolved
//   5. Expert review — sign-off recorded against the version reviewed
//   6. Backtest — leave-one-out: re-predict each completed firm project and compare to its actual duration

import type { Answer, AnalyzableSchedule, DcmaReport, GeneratedSchedule, ProjectType, WorkCalendar } from './types'
import { runCpm } from './cpm'
import { runDcma } from '@/lib/analysis/dcma'
import { computeFirmHistory, scaleForSize, type FirmHistory } from './history'
import { questionBank, elicit, profileFrom } from './elicitation'
import { generateSchedule } from './generator'
import type { ExpertReview, HistoryRow } from '@/lib/db'

export function toAnalyzable(s: GeneratedSchedule): AnalyzableSchedule {
  const t = s.cpm?.times || {}
  return {
    dataDate: s.projectStart,
    projectStart: s.projectStart,
    projectFinish: s.cpm?.projectFinish ?? null,
    calendars: s.calendars,
    defaultCalendarId: s.defaultCalendarId,
    links: s.links,
    activities: s.activities.map(a => ({
      id: a.id, code: a.code, name: a.name, type: a.type, duration: a.duration, calendarId: a.calendarId,
      status: 'not_started', percentComplete: 0,
      earlyStart: t[a.id]?.earlyStart, earlyFinish: t[a.id]?.earlyFinish, lateStart: t[a.id]?.lateStart, lateFinish: t[a.id]?.lateFinish,
      totalFloat: t[a.id]?.totalFloat, constraint: a.constraint ? { type: a.constraint.type, date: a.constraint.date } : null,
    })),
  }
}

export interface BenchmarkRow {
  activityId: string
  code: string
  name: string
  planned: number
  firmP20: number
  firmMedian: number
  firmP80: number
  projects: number
  verdict: 'optimistic' | 'in_range' | 'conservative'
}

export interface ScheduleDateCheck { text: string; severity: 'error' | 'warning' | 'info'; activityIds: string[]; questionIds: string[] }

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const us = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`

/** Checks the dates the team gave against what the logic can actually achieve. */
export function scheduleDateChecks(s: GeneratedSchedule): ScheduleDateCheck[] {
  const t = s.cpm?.times
  if (!t) return []
  const out: ScheduleDateCheck[] = []
  const byId = new Map(s.activities.map(a => [a.id, a]))
  for (const m of s.milestoneTargets || []) {
    const tm = t[m.activityId]
    if (!tm) continue
    const late = days(m.target, tm.earlyFinish)
    if (late > 0) {
      // What drives it: the longest critical activities that finish before this milestone.
      const drivers = s.activities.filter(a => t[a.id]?.critical && t[a.id].earlyFinish <= tm.earlyFinish && a.id !== m.activityId && a.type === 'task')
        .sort((x, y) => y.duration - x.duration).slice(0, 3)
      out.push({
        severity: 'error', activityIds: [m.activityId, ...drivers.map(d => d.id)], questionIds: [`milestone.${m.key}.target`],
        text: `“${m.label}” is forecast for ${us(tm.earlyFinish)}, ${late} days after your target of ${us(m.target)}. It is driven by ${drivers.map(d => `${d.code} ${d.name} (${d.duration}d)`).join(', ') || 'the activities before it'}. Shorten one of those, change the sequence, or move the target.`,
      })
    } else {
      out.push({ severity: 'info', activityIds: [m.activityId], questionIds: [`milestone.${m.key}.target`], text: `“${m.label}” is forecast for ${us(tm.earlyFinish)}, ${-late} days ahead of your target of ${us(m.target)}.` })
    }
  }
  for (const a of s.activities) {
    if (!a.id.endsWith('-delivered') || !a.constraint) continue
    const tm = t[a.id]
    if (!tm) continue
    const itemId = a.id.replace(/^ll-/, '').replace(/-delivered$/, '')
    if (tm.totalFloat <= 0) {
      out.push({ severity: 'warning', activityIds: [a.id], questionIds: [`procure.${itemId}.delivery`], text: `The committed delivery of ${a.name.replace(/ delivered.*$/, '')} (${us(a.constraint.date)}) now drives the finish date — any slip moves completion day for day. Ask the supplier for an earlier date or a partial shipment.` })
    } else if (tm.freeFloat > 60) {
      const succ = s.links.filter(l => l.from === a.id).map(l => byId.get(l.to)).find(Boolean)
      out.push({ severity: 'info', activityIds: [a.id], questionIds: [`procure.${itemId}.delivery`], text: `${a.name.replace(/ delivered.*$/, '')} arrives ${us(a.constraint.date)}, about ${tm.freeFloat} days before it's needed${succ ? ` for ${succ.code} ${succ.name}` : ''}. Plan protected storage and insurance, or push the delivery later.` })
    }
  }
  return out
}

export interface Evaluation {
  score: number
  grade: 'A' | 'B' | 'C' | 'D'
  dcma: DcmaReport
  readiness: number
  openAssumptions: number
  benchmark: { rows: BenchmarkRow[]; basis: string }
  forecast: { deterministic: string; p50: string; p80: string; basis: string; requiredFinish?: string; p80MeetsRequired?: boolean }
  coverage: { item: string; kind: 'permit' | 'long_lead'; status: 'scheduled' | 'resolved' | 'missing'; detail: string }[]
  review: { status: 'none' | 'approved' | 'changes_requested' | 'stale'; latest?: ExpertReview; reviewedVersion?: string }
  findings: string[]
  dateChecks: ScheduleDateCheck[]
}

export function evaluatePlan(s: GeneratedSchedule, answers: Record<string, Answer>, history: FirmHistory | null, reviews: ExpertReview[]): Evaluation {
  const profile = profileFrom(answers)
  const dcma = runDcma(toAnalyzable(s))
  const elic = elicit({ answers })
  const findings: string[] = []

  /* Realism vs firm actuals */
  const rows: BenchmarkRow[] = []
  if (history) {
    // Compare whole work packages: segments "t-finishes#1..n" are summed back into one package.
    const packages = new Map<string, { a: GeneratedSchedule['activities'][number]; total: number }>()
    for (const a of s.activities) {
      // Only trade packages from the template compare like-for-like with a firm's category history;
      // permit, procurement and regulation add-ons (e.g. a 10-day acceptance test) would not.
      if (a.type !== 'task' || a.placeholder || !a.id.startsWith('t-')) continue
      const base = a.id.split('#')[0]
      const p = packages.get(base)
      if (p) p.total += a.duration
      else packages.set(base, { a, total: a.duration })
    }
    packages.forEach(({ a, total }, base) => {
      const st = history.byCategory[a.category]
      if (!st || st.projects < 2) return
      const f = (x: number) => Math.round(profile.grossSqft && st.meanSqft ? scaleForSize(x, 100_000, profile.grossSqft) : x)
      const p20 = f(st.actualP20), med = f(st.actualMedian), p80 = f(st.actualP80)
      const verdict = total < p20 ? 'optimistic' : total > p80 * 1.25 ? 'conservative' : 'in_range'
      rows.push({ activityId: base, code: a.code, name: a.name.replace(/ — (Level|Levels|Area|Sequence) .*$/, ''), planned: total, firmP20: p20, firmMedian: med, firmP80: p80, projects: st.projects, verdict })
    })
    const opt = rows.filter(r => r.verdict === 'optimistic')
    if (opt.length) findings.push(`${opt.length} activit${opt.length > 1 ? 'ies are' : 'y is'} shorter than 80% of your firm's actual outcomes: ${opt.slice(0, 5).map(r => `${r.code} ${r.name} (${r.planned}d vs typical ${r.firmMedian}d)`).join('; ')}.`)
  }

  /* Risk-adjusted forecast */
  const forecast = riskForecast(s, history, answers)
  if (forecast.requiredFinish && forecast.p80MeetsRequired === false) findings.push(`At the P80 level the project finishes ${forecast.p80}, after the required ${forecast.requiredFinish}.`)

  /* Coverage of grounded requirements */
  const bank = questionBank({ answers })
  const actIds = new Set(s.activities.map(a => a.id))
  const removedIds = new Set((s.removed || []).map(r => r.id))
  const coverage: Evaluation['coverage'] = []
  for (const pm of bank.permits) {
    const st = answers[`permit.${pm.id}.status`]
    const v = st?.status === 'known' ? String(st.value) : undefined
    if (v === 'issued' || v === 'not_required') coverage.push({ item: pm.name, kind: 'permit', status: 'resolved', detail: v === 'issued' ? 'Already issued' : 'Marked not required' })
    else if (actIds.has(`permit-${pm.id}`)) coverage.push({ item: pm.name, kind: 'permit', status: 'scheduled', detail: `${pm.reviewWeeks.typical}-week review carried` })
    else coverage.push({ item: pm.name, kind: 'permit', status: 'missing', detail: removedIds.has(`permit-${pm.id}`) ? 'Removed by scheduler' : 'Not in schedule' })
  }
  for (const it of bank.longLead) {
    const st = answers[`procure.${it.id}.status`]
    const v = st?.status === 'known' ? String(st.value) : undefined
    if (v === 'not_in_scope') coverage.push({ item: it.name, kind: 'long_lead', status: 'resolved', detail: 'Not in scope' })
    else if (actIds.has(`ll-${it.id}-fab`) || actIds.has(`ll-${it.id}-delivered`)) coverage.push({ item: it.name, kind: 'long_lead', status: 'scheduled', detail: 'Procurement chain linked to installation' })
    else coverage.push({ item: it.name, kind: 'long_lead', status: 'missing', detail: 'Not in schedule' })
  }
  const missing = coverage.filter(c => c.status === 'missing')
  if (missing.length) findings.push(`${missing.length} grounded requirement(s) are not in the schedule: ${missing.map(m => m.item).join(', ')}.`)

  /* Expert review */
  const latest = reviews[reviews.length - 1]
  let reviewStatus: Evaluation['review']['status'] = 'none'
  if (latest) {
    // Any regeneration or override after the review makes it stale.
    const stale = latest.at < lastOverrideAt(s)
    reviewStatus = stale ? 'stale' : latest.verdict === 'reject' ? 'changes_requested' : 'approved'
  }
  if (reviewStatus === 'none') findings.push('No expert review recorded yet. A senior scheduler should review before baselining.')
  if (reviewStatus === 'stale') findings.push('The schedule changed after the last expert review.')

  const failed = dcma.checks.filter(c => c.result === 'fail')
  if (failed.length) findings.push(`DCMA checks failing: ${failed.map(c => `#${c.id} ${c.name}`).join(', ')}.`)
  // Context for reviewers: agency reviews and fabrication legitimately run long and carry float.
  const offCal = new Set(s.activities.filter(a => a.calendarId === 'cal-7d' || a.phase === 'design').map(a => a.code))
  for (const c of failed.filter(c => c.id === 6 || c.id === 8)) {
    const share = c.offenders.length ? c.offenders.filter(o => offCal.has(o)).length / c.offenders.length : 0
    if (share >= 0.5) findings.push(`DCMA #${c.id} (${c.name}): ${Math.round(share * 100)}% of flagged activities are design phases, permit reviews or fabrication/delivery, which normally run long${c.id === 6 ? ' and carry float off the critical path' : ''}. Field work is detailed to ≤44-day segments.`)
  }
  // What drives the finish? Procurement or permitting on the critical path is the key insight to surface.
  const byId = new Map(s.activities.map(a => [a.id, a]))
  const drivers = (s.cpm?.criticalPath || []).map(id => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a && (a.category === 'procurement' || a.category === 'submittals' || a.category.startsWith('permit')))
  if (drivers.length) {
    const field = s.activities.filter(a => a.calendarId !== 'cal-7d' && a.type === 'task' && a.phase !== 'design' && (s.cpm?.times[a.id]?.totalFloat ?? 0) > 20).length
    findings.push(`The critical path runs through ${drivers.map(d => `${d.code} ${d.name}`).slice(0, 3).join(' → ')}. ${field ? `${field} field activities have 20+ days of float waiting on it — ` : ''}expediting it (early release, alternate supplier, or temporary equipment) moves the finish; accelerating field work does not.`)
  }
  const qualified = (s.qualifications || []).filter(q => q.activityIds.length)
  if (qualified.length) findings.push(`${qualified.length} answer(s) were qualified in the team's own words (e.g. “${qualified[0].note.slice(0, 80)}”). The related activities are marked low-confidence — open them on the Schedule tab and adjust durations or logic if needed.`)
  const placeholders = s.activities.filter(a => a.placeholder)
  if (placeholders.length) findings.push(`${placeholders.length} placeholder(s) reserve time for withheld constraints; a cleared scheduler should position them on-site.`)

  /* Score */
  const realism = rows.length ? 100 * rows.filter(r => r.verdict !== 'optimistic').length / rows.length : 70
  const cov = coverage.length ? 100 * (coverage.length - missing.length) / coverage.length : 100
  const rev = reviewStatus === 'approved' ? 100 : reviewStatus === 'none' ? 50 : 30
  const score = Math.round(dcma.score * 0.35 + elic.readiness * 0.2 + realism * 0.2 + cov * 0.15 + rev * 0.1)
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D'

  const dateChecks = scheduleDateChecks(s)
  for (const c of dateChecks.filter(c => c.severity !== 'info')) findings.unshift(c.text)
  return {
    dateChecks,
    score, grade, dcma, readiness: elic.readiness,
    openAssumptions: s.assumptions.filter(a => a.kind !== 'inferred').length,
    benchmark: { rows, basis: history ? `${history.projectCount} of your firm's past schedules (${history.similarCount} same type). Private to your firm.` : 'No firm history uploaded yet — upload past schedules with actual dates to benchmark durations.' },
    forecast,
    coverage,
    review: { status: reviewStatus, latest, reviewedVersion: latest?.at },
    findings,
  }
}

function lastOverrideAt(s: GeneratedSchedule): string {
  let last = s.generatedAt
  for (const a of s.activities) for (const o of a.overrides || []) if (o.at > last) last = o.at
  for (const l of s.links) for (const o of l.overrides || []) if (o.at > last) last = o.at
  for (const r of s.removed || []) if (r.override.at > last) last = r.override.at
  return last
}

function riskForecast(s: GeneratedSchedule, history: FirmHistory | null, answers: Record<string, Answer>): Evaluation['forecast'] {
  const deterministic = s.cpm?.projectFinish || s.projectStart
  const required = typeof answers['project.required_finish']?.value === 'string' && answers['project.required_finish'].status === 'known' ? String(answers['project.required_finish'].value) : undefined
  const scenario = (factor: (a: GeneratedSchedule['activities'][number]) => number) => runCpm({
    projectStart: s.projectStart,
    activities: s.activities.map(a => ({ ...a, duration: a.type === 'milestone' ? 0 : Math.max(1, Math.round(a.duration * factor(a))) })),
    links: s.links,
    calendars: s.calendars,
    defaultCalendarId: s.defaultCalendarId,
  }).projectFinish

  const permitHigh = (a: GeneratedSchedule['activities'][number], p: 'p50' | 'p80') => {
    // Catalog-based uncertainty for agency reviews and fabrication (no firm history needed).
    if (a.category.startsWith('permit') && a.calendarId === 'cal-7d') return p === 'p80' ? 1.35 : 1.1
    if (a.category === 'procurement' && a.calendarId === 'cal-7d') return p === 'p80' ? 1.3 : 1.05
    return 1
  }
  let basis: string
  let p50: string, p80: string
  if (history && history.overallOverrunMedian) {
    const cat = (a: GeneratedSchedule['activities'][number], q: 'overrunMedian' | 'overrunP80') => {
      const st = history.byCategory[a.category]
      // Durations already taken from firm actuals are not inflated twice.
      if (a.rationale.sources.some(x => x.kind === 'firm_history' || x.kind === 'override')) return 1
      return st?.[q] ?? (q === 'overrunMedian' ? history.overallOverrunMedian! : history.overallOverrunP80!)
    }
    p50 = scenario(a => Math.max(1, cat(a, 'overrunMedian')) * permitHigh(a, 'p50'))
    p80 = scenario(a => Math.max(1, cat(a, 'overrunP80')) * permitHigh(a, 'p80'))
    basis = `Rule-based scenario (not a Monte Carlo simulation): firm actual-vs-planned ratios (median ×${history.overallOverrunMedian.toFixed(2)}, P80 ×${(history.overallOverrunP80 ?? history.overallOverrunMedian).toFixed(2)}) plus catalog review/lead-time ranges.`
  } else {
    p50 = scenario(a => permitHigh(a, 'p50'))
    p80 = scenario(a => permitHigh(a, 'p80') * (a.calendarId === 'cal-7d' ? 1 : 1.1))
    basis = 'Rule-based scenario (not a Monte Carlo simulation). No firm history yet: catalog high-end review and lead times, plus 10% on field work for P80.'
  }
  return { deterministic, p50, p80, basis, requiredFinish: required, p80MeetsRequired: required ? p80 <= required : undefined }
}

/* ─── Backtest against the firm's completed projects ── */

export interface BacktestProject {
  scheduleId: string
  name: string
  projectType: ProjectType | null
  state: string | null
  grossSqft: number | null
}

export interface BacktestResult {
  projects: { scheduleId: string; name: string; actualDays: number; predictedDays: number; errorPct: number }[]
  /** Mean absolute percentage error of predicted construction duration */
  mape: number | null
  /** Mean signed error: positive = tool predicts longer than reality */
  biasPct: number | null
  skipped: { name: string; reason: string }[]
}

const CONSTRUCTION_EXCLUDE = new Set(['design_sd', 'design_dd', 'design_cd', 'design_review', 'permit_site', 'permit_building', 'permit_other', 'submittals', 'procurement', 'ntp'])

export function backtest(projects: BacktestProject[], rows: HistoryRow[], calendars: Record<string, WorkCalendar[]>): BacktestResult {
  const out: BacktestResult = { projects: [], mape: null, biasPct: null, skipped: [] }
  for (const p of projects) {
    const own = rows.filter(r => r.scheduleId === p.scheduleId && !CONSTRUCTION_EXCLUDE.has(r.category))
    const starts = own.map(r => r.actualStart).filter((x): x is string => !!x).sort()
    const finishes = own.map(r => r.actualFinish).filter((x): x is string => !!x).sort()
    if (!p.projectType || !p.grossSqft) { out.skipped.push({ name: p.name, reason: 'Project type and area not tagged' }); continue }
    if (starts.length < 5 || finishes.length < 5) { out.skipped.push({ name: p.name, reason: 'Not enough actual dates (needs a completed or mostly completed project)' }); continue }
    const actualStart = starts[0], actualFinish = finishes[finishes.length - 1]
    const actualDays = Math.round((Date.parse(actualFinish) - Date.parse(actualStart)) / 86_400_000)
    if (actualDays < 30) { out.skipped.push({ name: p.name, reason: 'Actual span under 30 days' }); continue }

    // Leave-one-out: the project being predicted never informs its own prediction.
    const others = rows.filter(r => r.scheduleId !== p.scheduleId)
    const hist = others.length ? computeFirmHistory(others, calendars, p.projectType) : null
    const now = new Date().toISOString()
    const ans = (value: Answer['value']): Answer => ({ status: 'known', value, answeredAt: now })
    const answers: Record<string, Answer> = {
      'project.type': ans(p.projectType), 'project.gross_sqft': ans(p.grossSqft), 'project.target_start': ans(actualStart),
      'project.scope': ans('new_construction'), 'design.drawings': ans(true), 'design.percent': ans(100),
      ...(p.state ? { 'project.state': ans(p.state) } : {}),
    }
    // Construction-only comparison: permits issued and equipment already ordered.
    const bank = questionBank({ answers })
    for (const pm of bank.permits) answers[`permit.${pm.id}.status`] = ans('issued')
    for (const it of bank.longLead) answers[`procure.${it.id}.status`] = ans('not_in_scope')
    for (const q of bank.all) if (!answers[q.id]) answers[q.id] = { status: 'unknown', answeredAt: now }
    answers['calendar.weather'] = ans(false)
    const gen = generateSchedule({ answers, history: hist, today: actualStart })
    const noContingency = gen.activities.filter(a => a.category !== 'contingency')
    const ids = new Set(noContingency.map(a => a.id))
    const cpm = runCpm({ projectStart: gen.projectStart, activities: noContingency, links: gen.links.filter(l => ids.has(l.from) && ids.has(l.to)), calendars: gen.calendars, defaultCalendarId: gen.defaultCalendarId })
    const predictedDays = Math.round((Date.parse(cpm.projectFinish) - Date.parse(gen.projectStart)) / 86_400_000)
    out.projects.push({ scheduleId: p.scheduleId, name: p.name, actualDays, predictedDays, errorPct: Math.round(((predictedDays - actualDays) / actualDays) * 1000) / 10 })
  }
  if (out.projects.length) {
    out.mape = Math.round(out.projects.reduce((s, x) => s + Math.abs(x.errorPct), 0) / out.projects.length * 10) / 10
    out.biasPct = Math.round(out.projects.reduce((s, x) => s + x.errorPct, 0) / out.projects.length * 10) / 10
  }
  return out
}
