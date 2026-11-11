// Regression tests for the second line-by-line review (medium findings) of the standards packs.
import { describe, expect, it } from 'vitest'
import type { AnalyzableActivity, CpmLink } from '@/lib/planning/types'
import { defaultCalendar } from '@/lib/planning/calendar'
import { runDcma } from '@/lib/analysis/dcma'
import { DCMA_RULES } from './dcma-pack'
import { GAO_RULES } from './gao'
import { engineConfig, evaluateRule } from './engine'
import { buildNetwork } from './network'
import type { RuleResult, StandardsInput } from './types'

const cal = defaultCalendar()
const task = (id: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name: `Task ${id}`, type: 'task', duration: 10, earlyStart: '2026-04-01', earlyFinish: '2026-04-14', ...extra })
const ms = (id: string, name: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name, type: 'milestone', duration: 0, ...extra })
const fs = (from: string, to: string): CpmLink => ({ from, to, type: 'FS', lag: 0 })
const rule = (id: string) => [...GAO_RULES, ...DCMA_RULES].find(r => r.ruleId === id)!
const run = (id: string, input: StandardsInput): RuleResult => evaluateRule(rule(id), buildNetwork(input), engineConfig())

/** NTP → A → Foundations → B → Substantial Completion (designated) → Punch list → Final Completion. */
function closeout(over: Partial<StandardsInput['schedule']> = {}): StandardsInput {
  const activities = [
    ms('NTP', 'Notice to Proceed', { status: 'complete', actualStart: '2026-01-05', earlyStart: '2026-01-05', earlyFinish: '2026-01-05', milestoneKind: 'start' }),
    task('A', { status: 'complete', actualStart: '2026-01-05', actualFinish: '2026-02-01', percentComplete: 100 }),
    ms('FDN', 'Foundations complete', { status: 'complete', actualFinish: '2026-02-01', milestoneKind: 'finish' }),
    task('B', { earlyStart: '2026-03-02', earlyFinish: '2026-03-13' }),
    ms('SC', 'Substantial Completion', { earlyStart: '2026-03-13', earlyFinish: '2026-03-13', milestoneKind: 'finish' }),
    task('PL', { name: 'Punch list', earlyStart: '2026-03-16', earlyFinish: '2026-03-27' }),
    ms('FC', 'Final Completion', { earlyStart: '2026-03-27', earlyFinish: '2026-03-27', milestoneKind: 'finish' }),
  ]
  return {
    subject: { kind: 'schedule', id: 's', name: 's' },
    schedule: { dataDate: '2026-03-02', projectStart: '2026-01-05', finishMilestoneId: 'SC', calendars: [cal], defaultCalendarId: cal.id, links: [fs('NTP', 'A'), fs('A', 'FDN'), fs('FDN', 'B'), fs('B', 'SC'), fs('SC', 'PL'), fs('PL', 'FC')], activities, ...over },
    wbs: {}, baseline: { source: 'none' }, riskAnalysis: { recordedAt: '2026-01-10T10:00:00Z', ranges: 2, events: 1, source: 'x' },
  }
}

describe('work after the designated finish milestone (M2)', () => {
  it('the network ends at the last finish milestone, as DCMA #1 already treats it', () => {
    const inp = closeout()
    expect(buildNetwork(inp).finishId).toBe('FC')
    expect(run('GAO-BP2-01', inp)).toMatchObject({ result: 'pass', evidence: [] })
    const r = run('GAO-BP5-03', inp)
    expect(r).toMatchObject({ result: 'pass', evidence: [] })
    expect(r.metric).toMatch(/no logic path to FC$/)
    expect(runDcma(inp.schedule).checks.find(c => c.id === 1)).toMatchObject({ result: 'pass', offenders: [] })
  })
  it('a designated milestone with nothing after it is still the finish', () => {
    const inp = closeout()
    inp.schedule.links = inp.schedule.links.filter(l => l.from !== 'SC')
    expect(buildNetwork(inp).finishId).toBe('SC')
    // Punch list and Final Completion no longer lead to it: reported, as before.
    expect(run('GAO-BP5-03', inp).evidence).toEqual(['PL', 'FC'])
    expect(run('GAO-BP2-01', inp).evidence).toEqual(['PL', 'FC'])
  })
  it('work that really is cut off from the finish is still reported', () => {
    const inp = closeout()
    inp.schedule.activities.push(task('X'))
    inp.schedule.links.push(fs('B', 'X'))
    expect(run('GAO-BP2-01', inp).evidence).toEqual(['X'])
    expect(run('GAO-BP5-03', inp).evidence).toEqual(['X'])
  })
})

describe('milestones with the actual date of their kind carry actual dates (M3)', () => {
  it('a start milestone with only an actual start and a finish milestone with only an actual finish pass', () => {
    expect(run('GAO-BP9-04', closeout())).toMatchObject({ result: 'pass', evidence: [] })
  })
  it('a milestone of unknown kind passes on either date; a completed one with none still fails', () => {
    const inp = closeout()
    inp.schedule.activities.push(ms('M1', 'Permit', { status: 'complete', actualFinish: '2026-02-01' }), ms('M2', 'Dry-in', { status: 'complete' }))
    expect(run('GAO-BP9-04', inp)).toMatchObject({ result: 'fail', evidence: ['M2 (no actual start)', 'M2 (no actual finish)'] })
  })
  it('the wrong date for the kind, and a task missing a date, still fail', () => {
    const inp = closeout()
    const a = (id: string) => inp.schedule.activities.find(x => x.id === id)!
    Object.assign(a('NTP'), { actualStart: null, actualFinish: '2026-01-05' })
    Object.assign(a('A'), { actualStart: null })
    expect(run('GAO-BP9-04', inp).evidence).toEqual(['NTP (no actual start)', 'A (no actual start)'])
  })
})

describe('dates in metric text are shown MM/DD/YYYY (M4)', () => {
  it('risk analysis, future actuals and forecast before the data date', () => {
    const inp = closeout()
    expect(run('GAO-BP8-01', inp).metric).toBe('2 ranges, 1 risk event recorded (01/10/2026)')
    expect(run('GAO-BP9-02', inp).metric).toBe('0 activities with an actual date after 03/02/2026')
    expect(run('GAO-BP9-05', inp).metric).toBe('0 open activities forecast before 03/02/2026')
    for (const r of GAO_RULES) expect(evaluateRule(r, buildNetwork(inp), engineConfig()).metric).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
