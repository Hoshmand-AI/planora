import { describe, expect, it } from 'vitest'
import type { Plan, Schedule } from '@/lib/db'
import type { Answer, AnswerValue } from './types'
import { generateSchedule } from './generator'
import { buildPortfolio, latestUpdates, planRow, scheduleRow } from './portfolio'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'

const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
const answers = (): Record<string, Answer> => ({
  'project.type': k('data_center'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(200000),
  'project.stories': k(2), 'project.target_start': k('2026-11-02'), 'design.drawings': k(true), 'design.percent': k(60), 'project.federal': k(false),
})
const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', orgId: 'o', userId: 'u', name: 'Data hall', answers: answers(), extraQuestions: [], generated: null, reviews: [], audit: [], decisions: {},
  scheduleId: null, createdAt: '2026-10-01', updatedAt: '2026-10-01T00:00:00Z', version: 1, ...over,
})
const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: 's1', userId: 'u', orgId: 'o', name: 'Clinic', version: 'v3', sourceType: 'p6_xer', fileName: 'c.xer', uploadedAt: '2026-09-01T00:00:00Z',
  activityCount: 100, relationshipCount: 120, projectStart: '2026-01-05', projectFinish: '2027-06-30', dataDate: '2026-09-01', varianceDays: 0,
  criticalCount: 10, percentComplete: 40, calendars: [], defaultCalendarId: null, warnings: [], planId: null, projectType: null, region: null, grossSqft: null, ...over,
})
const analysis = (over: Partial<ScheduleAnalysis> = {}): ScheduleAnalysis => ({
  version: 1, progressMode: 'retained', forecastFinish: '2027-06-30', reportedFinish: null, mustFinishBy: null, finishMilestone: null,
  varianceDays: 0, varianceBasis: 'FM Finish: forecast vs baseline', minFloat: 0, negativeFloatCount: 0, violations: [], longestPath: [],
  status: 'on_track', statusReasons: [], recalc: null, ...over,
})
const TODAY = '2026-10-04'

describe('portfolio', () => {
  it('flags a plan that finishes after its required date as at risk', () => {
    const a = { ...answers(), 'project.required_finish': k('2028-06-30') }
    const g = generateSchedule({ answers: a, today: '2026-09-30' })
    const r = planRow(plan({ answers: a, generated: g }), TODAY)
    expect(r.status).toBe('at_risk')
    expect(r.gapDays).toBeGreaterThan(0)
    expect(r.alerts.map(x => x.code)).toEqual(expect.arrayContaining(['late', 'review_none', 'unpublished']))
    expect(r.alerts.find(x => x.code === 'late')!.text).toMatch(/06\/30\/2028/)
  })
  it('reads Postgres-style timestamps for staleness', () => {
    const fresh = planRow(plan({ updatedAt: 'Sun Oct 04 2026 07:00:00 GMT+0000 (Coordinated Universal Time)' }), TODAY)
    expect(fresh.alerts.map(x => x.code)).not.toContain('stale')
    expect(fresh.updatedAt).toBe('2026-10-04T07:00:00.000Z')
  })
  it('shows a plan still in the interview, and stale plans', () => {
    const r = planRow(plan({ updatedAt: '2026-08-01T00:00:00Z' }), TODAY)
    expect(r.status).toBe('not_started')
    expect(r.alerts.map(x => x.code)).toEqual(expect.arrayContaining(['not_generated', 'stale']))
  })
  it('takes status, variance and reasons from the stored analysis, not its own computation', () => {
    expect(scheduleRow(sched({ analysis: analysis() }), TODAY).status).toBe('on_track')
    const behind = scheduleRow(sched({ analysis: analysis({ varianceDays: 5, status: 'attention', statusReasons: ['Forecast finish is 5 calendar days behind baseline.'] }) }), TODAY)
    expect(behind).toMatchObject({ status: 'attention', gapDays: 5 })
    expect(behind.alerts[0]).toMatchObject({ code: 'behind', severity: 'warning' })
    // A legacy variance column (e.g. against one baselined activity) is ignored when the analysis has none.
    const noBaseline = scheduleRow(sched({ varianceDays: 116, analysis: analysis({ varianceDays: null, varianceBasis: 'Only 1 of 100 activities carry baseline dates, so a project variance would be misleading.' }) }), TODAY)
    expect(noBaseline).toMatchObject({ status: 'on_track', gapDays: null })
    expect(noBaseline.alerts.map(a => a.code)).not.toContain('behind')
    expect(noBaseline.varianceBasis).toMatch(/Only 1 of 100/)
    const passed = scheduleRow(sched({ analysis: analysis({ status: 'at_risk', statusReasons: ['Forecast finish 2026-09-01 has already passed.'] }) }), TODAY)
    expect(passed.status).toBe('at_risk')
    expect(passed.alerts[0]).toMatchObject({ code: 'finish_passed', severity: 'error', text: 'Forecast finish 09/01/2026 has already passed.' })
    expect(scheduleRow(sched({ analysis: analysis({ status: 'complete' }), percentComplete: 100 }), TODAY).status).toBe('complete')
  })
  it('flags overdue status updates without changing the analysis status, and marks unanalyzed uploads', () => {
    const stale = scheduleRow(sched({ dataDate: '2026-06-01', analysis: analysis() }), TODAY)
    expect(stale.status).toBe('on_track')
    expect(stale.alerts[0].code).toBe('stale_status')
    expect(scheduleRow(sched({ dataDate: '2026-06-01', percentComplete: 100, analysis: analysis({ status: 'complete' }) }), TODAY).alerts).toEqual([])
    const legacy = scheduleRow(sched({ varianceDays: 186 }), TODAY)
    expect(legacy).toMatchObject({ status: 'not_started', gapDays: null })
    expect(legacy.alerts.map(a => a.code)).toEqual(['not_analyzed'])
  })
  it('shows only the latest update of each project, with the update count', () => {
    const series = [
      sched({ id: 'u1', projectKey: 'clinic', dataDate: '2026-06-01', uploadedAt: '2026-06-02T00:00:00Z', analysis: analysis({ status: 'at_risk', statusReasons: ['Forecast finish 2026-05-01 has already passed.'] }) }),
      sched({ id: 'u3', projectKey: 'clinic', dataDate: '2026-09-01', uploadedAt: '2026-09-01T00:00:00Z', analysis: analysis() }),
      sched({ id: 'u3b', projectKey: 'clinic', dataDate: '2026-09-01', uploadedAt: '2026-09-03T00:00:00Z', analysis: analysis() }),
      sched({ id: 'u2', projectKey: 'clinic', dataDate: '2026-08-01', uploadedAt: '2026-09-05T00:00:00Z', analysis: analysis() }),
      sched({ id: 'solo1', projectKey: null, analysis: analysis() }),
      sched({ id: 'solo2', projectKey: null, analysis: analysis() }),
    ]
    expect(latestUpdates(series).map(x => [x.schedule.id, x.updates])).toEqual([['solo1', 1], ['solo2', 1], ['u3b', 4]])
    const p = buildPortfolio([], series, TODAY)
    expect(p.rows.map(r => r.id).sort()).toEqual(['solo1', 'solo2', 'u3b'])
    expect(p.rows.find(r => r.id === 'u3b')).toMatchObject({ updates: 4, href: '/dashboard?schedule=u3b', status: 'on_track' })
    expect(p.totals).toMatchObject({ projects: 3, atRisk: 0 })
  })
  it('orders the most urgent first, skips published copies and totals the alerts', () => {
    const p = buildPortfolio([plan()], [
      sched({ id: 'ok', analysis: analysis() }),
      sched({ id: 'bad', analysis: analysis({ varianceDays: 30, status: 'at_risk', statusReasons: ['Forecast finish is 30 calendar days behind baseline.'] }) }),
      sched({ id: 'gen', sourceType: 'generated' }),
    ], TODAY)
    expect(p.rows.map(r => r.id)).toEqual(['bad', 'ok', 'p1'])
    expect(p.totals).toMatchObject({ projects: 3, atRisk: 1, onTrack: 1, attention: 0 })
    expect(p.totals.alerts).toBe(1)
  })
})
