// One forecast, scheduler inputs respected by the Monte Carlo, and the firm-history opt-out honored.

import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, GeneratedSchedule } from './types'
import { questionBank } from './elicitation'
import { generateSchedule } from './generator'
import { applyEdit } from './overrides'
import { evaluatePlan, findingsFor, headlineForecast } from './evaluation'
import { computeFirmHistory, historyForPlan } from './history'
import { committedActivities, distributionFor, runSra } from './sra'
import { recoveryPlan } from './recovery'
import { basisOfSchedule } from '@/lib/export/narrative'
import { profileFrom } from './elicitation'
import type { HistoryRow } from '@/lib/db'

const AT = '2026-01-01T00:00:00.000Z'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })

const dataCenter = (): Record<string, Answer> => ({
  'project.type': k('data_center'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(200000),
  'project.stories': k(2), 'project.target_start': k('2026-11-02'), 'design.drawings': k(true), 'design.percent': k(60), 'project.federal': k(false),
})

const healthcareCA = (): Record<string, Answer> => ({
  'project.type': k('healthcare'), 'project.state': k('CA'), 'project.city': k('Sacramento'),
  'project.scope': k('new_construction'), 'project.gross_sqft': k(120000), 'project.stories': k(4),
  'project.target_start': k('2026-03-02'), 'project.delivery': k('dbb'), 'project.federal': k(false),
  'design.drawings': k(true), 'design.percent': k(60), 'calendar.workweek': k('5x8'),
})

/** Three healthcare projects whose work ran ~30% longer than planned. */
function overrunHistory() {
  const rows: HistoryRow[] = []
  const cats = ['foundations', 'framing_drywall', 'finishes', 'mep_rough', 'commissioning']
  ;['p1', 'p2', 'p3'].forEach((sid, i) => {
    cats.forEach((cat, j) => {
      const start = `2023-0${j + 1}-02`
      rows.push({ scheduleId: sid, projectType: 'healthcare', region: 'CA', grossSqft: 100000, category: cat, name: cat, calendarId: null, duration: 22, baselineStart: start, baselineFinish: `2023-0${j + 2}-02`, actualStart: start, actualFinish: `2023-0${j + 2}-${String(12 + i * 2).padStart(2, '0')}` })
    })
  })
  return computeFirmHistory(rows, {}, 'healthcare')
}

describe('Monte Carlo respects the scheduler’s inputs', () => {
  it('centers an overridden duration on the override, not the catalog lead-time range', () => {
    const answers = { ...dataCenter() }
    const bank = questionBank({ answers })
    const item = bank.longLead[0]
    const g = generateSchedule({ answers, today: '2026-09-30' })
    const fab = g.activities.find(a => a.id === `ll-${item.id}-fab`)!
    const quoted = Math.max(7, Math.round(fab.duration * 0.5))
    const edited = applyEdit(g, { kind: 'duration', activityId: fab.id, value: quoted, reason: 'Vendor quote' }, 'Ana').schedule
    const a = edited.activities.find(x => x.id === fab.id)!
    const d = distributionFor(a, { history: null, catalog: new Map([[fab.id, { ...item.leadWeeks, label: item.name }]]) })!
    expect(d).toMatchObject({ min: 0.95, mode: 1, max: 1.15 })
    expect(d.basis).toMatch(/Scheduler override/)
    const r = runSra(edited, answers, null, { iterations: 300 })
    const s = r.sensitivity.find(x => x.id === fab.id)
    if (s) expect(s.basis).toMatch(/Scheduler override/)
  })

  it('holds expected permit issuance and committed delivery dates near-deterministic; P10 is not after the deterministic finish', () => {
    const base = dataCenter()
    const bank = questionBank({ answers: base })
    expect(bank.permits.length).toBeGreaterThan(0)
    const answers: Record<string, Answer> = { ...base }
    for (const p of bank.permits) { answers[`permit.${p.id}.status`] = k('submitted'); answers[`permit.${p.id}.expected`] = k('2027-01-15') }
    for (const l of bank.longLead) { answers[`procure.${l.id}.status`] = k('released'); answers[`procure.${l.id}.delivery`] = k('2027-03-01') }
    const g = generateSchedule({ answers, today: '2026-09-30' })
    const committed = committedActivities(answers, bank)
    let checked = 0
    const catalog = new Map(bank.permits.map(p => [`permit-${p.id}`, { ...p.reviewWeeks, label: p.name }]))
    for (const p of bank.permits) {
      const a = g.activities.find(x => x.id === `permit-${p.id}`)
      if (!a) continue
      checked++
      const d = distributionFor(a, { history: null, catalog, committed })!
      expect(d).toMatchObject({ min: 1, mode: 1, max: 1.05 })
      expect(d.basis).toMatch(/expected issuance date/)
      // Without the interview date it would have been sampled from the catalog range.
      expect(distributionFor(a, { history: null, catalog })!.basis).toMatch(/catalog/)
    }
    expect(checked).toBeGreaterThan(0)
    expect([...committed.keys()].some(id => id.startsWith('ll-'))).toBe(bank.longLead.length > 0)
    const r = runSra(g, answers, null, { iterations: 300 })
    expect(r.percentiles.p10 <= r.deterministic).toBe(true)
    expect(r.assumptions.join(' ')).toMatch(/near-deterministic/)
  })
})

describe('firm history opt-out (history.use = No)', () => {
  const history = overrunHistory()
  const optedOut = { ...healthcareCA(), 'history.use': k(false) }

  it('is honored by the helper', () => {
    expect(historyForPlan(history, optedOut)).toBeNull()
    expect(historyForPlan(history, { ...healthcareCA(), 'history.use': k(true) })).toBe(history)
    expect(historyForPlan(history, healthcareCA())).toBe(history)
  })

  it('does not shape generated durations', () => {
    const g = generateSchedule({ answers: optedOut, history, today: '2026-01-15' })
    expect(g.activities.some(a => a.rationale.sources.some(s => s.kind === 'firm_history'))).toBe(false)
    const plain = generateSchedule({ answers: optedOut, history: null, today: '2026-01-15' })
    expect(g.cpm!.projectFinish).toBe(plain.cpm!.projectFinish)
  })

  it('does not shape the Monte Carlo distributions', () => {
    const g = generateSchedule({ answers: optedOut, history: null, today: '2026-01-15' })
    const withHist = runSra(g, optedOut, history, { iterations: 200, seed: 7 })
    const without = runSra(g, optedOut, null, { iterations: 200, seed: 7 })
    expect(withHist.percentiles).toEqual(without.percentiles)
    expect(withHist.sensitivity.map(s => s.basis).join(' ')).not.toMatch(/Firm history|firm’s actuals/)
    expect(withHist.assumptions.join(' ')).toMatch(/opted out/)
  })

  it('does not shape the forecast ratios, benchmark or recovery', () => {
    const g = generateSchedule({ answers: optedOut, history: null, today: '2026-01-15' })
    const ev = evaluatePlan(g, optedOut, history, [])
    const plain = evaluatePlan(g, optedOut, null, [])
    expect(ev.forecast.p50).toBe(plain.forecast.p50)
    expect(ev.forecast.p80).toBe(plain.forecast.p80)
    expect(ev.forecast.basis).not.toMatch(/firm actual-vs-planned|×1\./)
    expect(ev.benchmark.rows).toEqual([])
    const late: GeneratedSchedule = { ...g, mustFinishBy: '2027-01-01' }
    expect(JSON.stringify(recoveryPlan(late, optedOut, historyForPlan(history, optedOut)))).toBe(JSON.stringify(recoveryPlan(late, optedOut, null)))
  })

  it('still uses firm history when the team said yes', () => {
    const answers = { ...healthcareCA(), 'history.use': k(true) }
    const g = generateSchedule({ answers, history, today: '2026-01-15' })
    expect(evaluatePlan(g, answers, history, []).forecast.basis).toMatch(/firm actual-vs-planned/)
  })
})

describe('one P50/P80 forecast', () => {
  const answers = dataCenter()
  const g = generateSchedule({ answers, today: '2026-09-30' })
  const ev = evaluatePlan(g, answers, null, [])

  it('is the rule-based estimate, labeled, when no simulation is available', () => {
    const f = headlineForecast(ev.forecast)!
    expect(f.method).toBe('rule_based')
    expect(f.label).toMatch(/Rule-based/)
    expect(f.p80).toBe(ev.forecast.p80)
  })

  it('is the Monte Carlo result when it has been run', () => {
    const sra = runSra(g, answers, null, { iterations: 200 })
    const f = headlineForecast(ev.forecast, sra)!
    expect(f.method).toBe('monte_carlo')
    expect([f.p50, f.p80]).toEqual([sra.percentiles.p50, sra.percentiles.p80])
  })

  it('appears once in the Basis of Schedule, never as two competing forecasts', () => {
    const sra = runSra(g, answers, null, { iterations: 200 })
    const md = basisOfSchedule({ planName: 'DC', profile: profileFrom(answers), schedule: g, evaluation: ev, reviews: [], generatedBy: 'Ana', aiMode: 'offline', sra })
    const keyDates = md.slice(md.indexOf('## 2. Key dates'), md.indexOf('### Schedule risk analysis'))
    expect(keyDates.match(/P50 \/ P80/g)?.length).toBe(1)
    expect(keyDates).toMatch(/Monte Carlo/)
    expect(md).not.toMatch(/Rule-based scenario P50/)
    const noSra = basisOfSchedule({ planName: 'DC', profile: profileFrom(answers), schedule: g, evaluation: ev, reviews: [], generatedBy: 'Ana', aiMode: 'offline' })
    expect(noSra).toMatch(/P50 \/ P80 \(Rule-based estimate\)/)
    expect(noSra).not.toMatch(/Monte Carlo P50/)
  })

  it('states the required-date finding from the shown forecast only', () => {
    const sra = runSra(g, answers, null, { iterations: 200 })
    const required = { ...ev, forecast: { ...ev.forecast, requiredFinish: '2020-01-01', p80MeetsRequired: false }, findings: [...ev.findings, `At the P80 level (rule-based estimate) the project finishes ${ev.forecast.p80}, after the required 2020-01-01.`] }
    const f = findingsFor(required, sra).filter(x => x.startsWith('At the P80 level'))
    expect(f).toEqual([`At the P80 level (Monte Carlo) the project finishes ${sra.percentiles.p80}, after the required 2020-01-01.`])
  })
})
