import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, GeneratedSchedule, PlanActivity, PlanLink } from './types'
import { defaultCalendar } from './calendar'
import { generateSchedule } from './generator'
import { runSra, triangular, phi, spearman } from './sra'

const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
const answers = (): Record<string, Answer> => ({
  'project.type': k('data_center'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(200000),
  'project.stories': k(2), 'project.target_start': k('2026-11-02'), 'design.drawings': k(true), 'design.percent': k(60), 'project.federal': k(false),
})

describe('Monte Carlo math', () => {
  it('triangular inverse CDF hits min, mode and max', () => {
    const d = { min: 0.8, mode: 1, max: 1.5 }
    expect(triangular(0, d)).toBeCloseTo(0.8)
    expect(triangular(1, d)).toBeCloseTo(1.5)
    expect(triangular((d.mode - d.min) / (d.max - d.min), d)).toBeCloseTo(1)
  })
  it('normal CDF is accurate', () => {
    expect(phi(0)).toBeCloseTo(0.5, 6)
    expect(phi(1.2816)).toBeCloseTo(0.9, 3)
    expect(phi(-1.6449)).toBeCloseTo(0.05, 3)
  })
  it('Spearman correlation', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1)
  })
})

describe('schedule risk analysis', () => {
  const g = generateSchedule({ answers: answers(), today: '2026-09-30' })
  const r = runSra(g, answers(), null, { iterations: 300 })

  it('produces ordered percentiles around the deterministic finish', () => {
    const p = r.percentiles
    expect(p.p10 <= p.p50 && p.p50 <= p.p80 && p.p80 <= p.p90).toBe(true)
    expect(r.histogram.reduce((s, b) => s + b.count, 0)).toBe(300)
    expect(r.method).toMatch(/Monte Carlo/)
    expect(r.assumptions.join(' ')).toMatch(/contingency/)
  })

  it('is reproducible for the same schedule', () => {
    const again = runSra(g, answers(), null, { iterations: 300 })
    expect(again.percentiles).toEqual(r.percentiles)
  })

  it('ranks drivers with criticality and sensitivity', () => {
    expect(r.criticality.length).toBeGreaterThan(3)
    expect(r.criticality[0].index).toBeGreaterThan(0.5)
    expect(r.sensitivity.length).toBeGreaterThan(0)
    expect(r.sensitivity.every(s => s.correlation >= -1 && s.correlation <= 1 && s.basis)).toBe(true)
  })

  it('gives the probability of meeting a required date', () => {
    const early: GeneratedSchedule = { ...g, mustFinishBy: r.percentiles.p10 }
    const late: GeneratedSchedule = { ...g, mustFinishBy: r.percentiles.p90 }
    const pe = runSra(early, answers(), null, { iterations: 300 }).required!.probability
    const pl = runSra(late, answers(), null, { iterations: 300 }).required!.probability
    expect(pe).toBeLessThan(0.25)
    expect(pl).toBeGreaterThan(0.85)
  })

  it('reports no warnings for a schedule without mandatory constraints', () => {
    expect(r.warnings).toEqual([])
  })

  it('runs fast enough to use interactively', () => {
    const t = runSra(g, answers(), null)
    expect(t.iterations).toBeGreaterThanOrEqual(200)
    expect(t.ms).toBeLessThan(20_000)
  })
})

describe('schedule risk analysis: criticality and mandatory constraints (scheduler pilot)', () => {
  const why = { summary: 'test', sources: [], confidence: 'medium' as const }
  const task = (id: string, duration: number, extra: Partial<PlanActivity> = {}): PlanActivity => ({
    id, code: id, name: id, duration, type: duration ? 'task' : 'milestone', category: 'sitework', phase: 'sitework', rationale: why, ...extra,
  } as PlanActivity)
  const link = (from: string, to: string): PlanLink => ({ id: `${from}-${to}`, from, to, type: 'FS', lag: 0, rationale: why })
  // Y (40d) drives the finish. X (5d) feeds M, a mandatory finish milestone set before X can finish,
  // so X carries negative float without driving anything. W (10d) then C (Start On, too early) also
  // shows negative float off the driving path.
  const s: GeneratedSchedule = {
    generatedAt: '2026-01-01T00:00:00Z', projectStart: '2026-03-02', calendars: [defaultCalendar()], defaultCalendarId: 'default-5d',
    activities: [
      task('Y', 40), task('X', 5), task('M', 0, { constraint: { type: 'MFO', date: '2026-03-04' } }),
      task('W', 10), task('C', 2, { constraint: { type: 'SO', date: '2026-03-05' } }), task('END', 0),
    ],
    links: [link('X', 'M'), link('W', 'C'), link('Y', 'END'), link('M', 'END'), link('C', 'END')],
    assumptions: [],
  }
  const r = runSra(s, {}, null, { iterations: 200 })
  const ci = (id: string) => r.criticality.find(c => c.id === id)?.index ?? 0

  it('counts an activity critical only when it is on the driving path to the finish in that iteration', () => {
    expect(ci('Y')).toBe(1)
    expect(ci('X')).toBe(0) // negative float from the mandatory finish, but never driving
    expect(ci('C')).toBe(0) // negative float from a Start On constraint, but never driving
    expect(ci('W')).toBe(0)
  })

  it('relaxes mandatory constraints for the simulation and says so', () => {
    expect(r.warnings.join(' ')).toMatch(/M \(Mandatory Finish 2026-03-04\).*relaxed/)
    expect(r.assumptions.join(' ')).toMatch(/driving/)
  })

  it('a mandatory finish does not pin the simulated finish', () => {
    const pinned: GeneratedSchedule = { ...s, activities: [task('X', 30), task('M', 0, { constraint: { type: 'MFO', date: '2026-03-04' } })], links: [link('X', 'M')] }
    const rr = runSra(pinned, {}, null, { iterations: 200 })
    expect(rr.percentiles.p10 > '2026-03-04').toBe(true)
    expect(rr.percentiles.p90 > rr.percentiles.p10).toBe(true)
  })
})
