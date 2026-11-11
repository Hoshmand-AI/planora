// Regression tests for the second line-by-line review (medium findings) of the analysis code.
import { describe, expect, it } from 'vitest'
import type { AnalyzableActivity, AnalyzableSchedule, CpmLink } from '@/lib/planning/types'
import { addWorkDays, defaultCalendar, finishFromStart } from '@/lib/planning/calendar'
import { baselineExecution, DEFAULT_DCMA_RULES, normalizeDcmaRules, runDcma } from './dcma'
import { guidanceFor } from './dcma-guidance'
import { checkInputs } from './input-checks'
import { computeEvm, type EvmInput } from './evm'

const cal = defaultCalendar()
const task = (id: string, duration = 5, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name: `Task ${id}`, type: 'task', duration, resourceCount: 1, ...extra })
const ms = (id: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name: `Milestone ${id}`, type: 'milestone', duration: 0, ...extra })
const fs = (from: string, to: string): CpmLink => ({ from, to, type: 'FS', lag: 0 })
const check = (r: ReturnType<typeof runDcma>, id: number) => r.checks.find(c => c.id === id)!

describe('BEI counts the same tasks above and below the line (M1)', () => {
  // 100 baselined tasks due before the data date, 80 finished; 30 tasks added after the baseline, all finished.
  const acts: AnalyzableActivity[] = []
  for (let i = 0; i < 100; i++) acts.push(task(`B${i}`, 5, { status: i < 80 ? 'complete' : 'not_started', actualFinish: i < 80 ? '2026-02-10' : null, baselineStart: '2026-01-05', baselineFinish: '2026-02-10' }))
  for (let i = 0; i < 30; i++) acts.push(task(`N${i}`, 5, { status: 'complete', actualFinish: '2026-02-20' }))

  it('completed tasks with no baseline do not lift the index over missed work', () => {
    const ex = baselineExecution(acts, '2026-03-02')!
    expect(ex).toMatchObject({ due: 100, missed: 20, completed: 80, unbaselinedCompleted: 30 })
    expect(ex.bei).toBeCloseTo(0.8)
  })
  it('the check fails and its text says what is and is not counted', () => {
    const c = check(runDcma({ projectStart: '2026-01-05', dataDate: '2026-03-02', activities: acts, links: [], calendars: [cal], defaultCalendarId: cal.id }), 14)
    expect(c).toMatchObject({ metric: '0.80', result: 'fail' })
    expect(c.explanation).toMatch(/Only 80 baselined tasks are complete against 100 baselined to finish before the data date/)
    expect(c.explanation).toMatch(/30 completed tasks with no baseline are not counted\./)
  })
  it('a baselined task finished ahead of its baseline still counts (BEI can exceed 1)', () => {
    const early = [task('A', 5, { status: 'complete', actualFinish: '2026-02-01', baselineStart: '2026-01-05', baselineFinish: '2026-02-10' }), task('B', 5, { status: 'complete', actualFinish: '2026-02-20', baselineStart: '2026-03-10', baselineFinish: '2026-03-20' })]
    expect(baselineExecution(early, '2026-03-02')).toMatchObject({ due: 1, completed: 2, bei: 2, unbaselinedCompleted: 0 })
  })
})

describe('an emptied DCMA threshold falls back to the default (M6)', () => {
  it('empty, null, zero (what an emptied number field sends) and text are "not set"', () => {
    expect(normalizeDcmaRules({ maxPct: null, minFsPct: '', highFloatDays: null, highDurationDays: '  ', indexTarget: '' })).toEqual(DEFAULT_DCMA_RULES)
    expect(normalizeDcmaRules({ maxPct: 0, minFsPct: 0, highFloatDays: 0, highDurationDays: 0, indexTarget: 0 })).toEqual(DEFAULT_DCMA_RULES)
    expect(normalizeDcmaRules({ maxPct: 'abc', indexTarget: true, minFsPct: [] })).toEqual(DEFAULT_DCMA_RULES)
  })
  it('real values are still kept, clamped to the range, and numeric strings accepted', () => {
    expect(normalizeDcmaRules({ maxPct: 99, minFsPct: 10, highFloatDays: '20', indexTarget: 0.9 })).toEqual({ ...DEFAULT_DCMA_RULES, maxPct: 25, minFsPct: 50, highFloatDays: 20, indexTarget: 0.9 })
  })
})

describe('CPLI metric says why a ratio above the target fails (M7)', () => {
  it('negative float on the completion milestone is named in the metric', () => {
    const ef = finishFromStart('2026-03-02', 200, cal)
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }), task('A', 200), ms('F', { name: 'Substantial Completion', constraint: { type: 'FNLT', date: addWorkDays(ef, -2, cal) } })],
      links: [fs('S', 'A'), fs('A', 'F')],
    }
    const c = check(runDcma(s), 13)
    expect(c.result).toBe('fail')
    expect(c.metric).toBe('0.99 (negative float)')
  })
  it('a passing index and a ratio below the target stay a plain number', () => {
    const ef = finishFromStart('2026-03-02', 20, cal)
    const mk = (d: number): AnalyzableSchedule => ({
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }), task('A', 20), ms('F', { constraint: { type: 'FNLT', date: addWorkDays(ef, d, cal) } })],
      links: [fs('S', 'A'), fs('A', 'F')],
    })
    expect(check(runDcma(mk(5)), 13).metric).toMatch(/^\d\.\d\d$/)
    expect(check(runDcma(mk(5)), 13).result).toBe('pass')
    expect(check(runDcma(mk(-10)), 13).metric).toMatch(/^-?\d\.\d\d$/)
    expect(check(runDcma(mk(-10)), 13).result).toBe('fail')
  })
})

describe('guidance quotes the threshold the check was judged against (M5)', () => {
  const g = (id: number, threshold: string) => guidanceFor({ id, name: 'x', metric: 'x', threshold, result: 'fail', offenders: [], explanation: '' }, { generated: false }).meaning
  it('organization thresholds', () => {
    expect(g(4, '≥ 75% FS')).toBe('Fewer than 75% of relationships are finish-to-start.')
    expect(g(13, '≥ 0.90')).toMatch(/^Critical Path Length Index below 0\.90:/)
    expect(g(14, '≥ 0.85')).toMatch(/^Baseline Execution Index below 0\.85:/)
  })
  it('the real checks at tuned thresholds', () => {
    const r = runDcma({ projectStart: '2026-03-02', dataDate: '2026-03-02', activities: [task('A')], links: [], calendars: [cal], defaultCalendarId: cal.id }, { minFsPct: 75, indexTarget: 0.9 })
    const of = (id: number) => guidanceFor(check(r, id), { generated: false }).meaning
    expect(of(4)).toMatch(/Fewer than 75%/)
    expect(of(13)).toMatch(/below 0\.90/)
    expect(of(14)).toMatch(/below 0\.90/)
  })
  it('defaults are unchanged', () => {
    expect(g(4, '≥ 90% FS')).toBe('Fewer than 90% of relationships are finish-to-start.')
    expect(g(13, '≥ 0.95')).toMatch(/below 0\.95/)
  })
})

describe('milestones with the actual date of their kind are statused (M3, input checks)', () => {
  const rules = (acts: AnalyzableActivity[]) => checkInputs({ projectStart: '2026-01-05', dataDate: '2026-03-02', activities: acts, links: [], calendars: [cal], defaultCalendarId: cal.id })
    .filter(q => q.rule === 'progress_without_actual_start' || q.rule === 'complete_without_actual_finish').map(q => q.id)
  it('a start milestone with only an actual start and a finish milestone with only an actual finish raise no question', () => {
    expect(rules([
      ms('NTP', { status: 'complete', actualStart: '2026-01-05', milestoneKind: 'start' }),
      ms('FDN', { status: 'complete', actualFinish: '2026-02-01', milestoneKind: 'finish' }),
      ms('M1', { status: 'complete', actualFinish: '2026-02-01' }),
    ])).toEqual([])
  })
  it('a completed milestone with no actual date, and a task missing one, are still asked about', () => {
    expect(rules([
      ms('M0', { status: 'complete', milestoneKind: 'finish' }),
      ms('M2', { status: 'complete', actualStart: '2026-01-05', milestoneKind: 'finish' }),
      task('T', 5, { status: 'complete', actualFinish: '2026-02-01' }),
    ])).toEqual(['progress_without_actual_start:M0', 'complete_without_actual_finish:M0', 'complete_without_actual_finish:M2', 'progress_without_actual_start:T'])
  })
})

describe('earned value: a baseline finish before the baseline start (Low)', () => {
  const act = (code: string, bs: string, bf: string) => ({ id: code, activityId: code, name: code, wbs: 'W', activityType: 'task', status: 'not_started', percentComplete: 0, actualStart: null, actualFinish: null, baselineStart: bs, baselineFinish: bf, calendarId: null })
  const rec = (budget: number) => ({ budget, baselineBudget: budget, actualCost: 0, remainingCost: budget, fileBcws: null, fileBcwp: null, fileAcwp: null, evPercent: null, evPercentType: null })
  const input = (acts: ReturnType<typeof act>[], dataDate: string): EvmInput => ({
    scheduleId: 's', version: 'U1', dataDate, activities: acts, calendars: [cal], defaultCalendarId: cal.id,
    baseline: { source: 'file', header: 'Baseline: file' },
    cost: { kind: 'sheet', byCode: Object.fromEntries(acts.map(a => [a.activityId, rec(10000)])), fields: { budget: true, baselineBudget: true, actualCost: true, remainingCost: true, fileBcws: false, fileBcwp: false }, currency: { code: 'USD', symbol: '$' }, evMethod: '', notes: [] },
    baselineBudget: { byCode: Object.fromEntries(acts.map(a => [a.activityId, 10000])), basis: 'file' },
  } as unknown as EvmInput)

  it('does not throw when it is the only dated activity, plans its whole budget, and says so', () => {
    // Mon 03/02 – Fri 03/13 entered the wrong way round.
    const e = computeEvm(input([act('R', '2026-03-13', '2026-03-02')], '2026-03-23'))
    expect(e.status).not.toBe('not_available')
    expect(e.metrics!.pv).toBe(10000)
    expect(e.notes.join(' ')).toMatch(/1 budgeted activity has a baseline finish before the baseline start \(R\)/)
  })
  it('does not lose planned value when the reversed dates reach outside the other activities', () => {
    const e = computeEvm(input([act('A', '2026-03-09', '2026-03-13'), act('R', '2026-03-20', '2026-03-02')], '2026-03-30'))
    expect(e.metrics!.pv).toBe(20000)
    expect(e.metrics!.bac).toBe(20000)
  })
  it('correct dates add no note', () => {
    expect(computeEvm(input([act('A', '2026-03-02', '2026-03-13')], '2026-03-23')).notes.join(' ')).not.toMatch(/finish before the baseline start/)
  })
})
