import { describe, expect, it } from 'vitest'
import type { Plan, Schedule } from '@/lib/db'
import type { Answer, AnswerValue } from './types'
import { generateSchedule } from './generator'
import { buildPortfolio, planRow, scheduleRow } from './portfolio'

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
  it('flags slipped finishes, overdue status updates and passed finish dates on uploaded schedules', () => {
    expect(scheduleRow(sched(), TODAY).status).toBe('on_track')
    expect(scheduleRow(sched({ varianceDays: 5 }), TODAY).status).toBe('attention')
    expect(scheduleRow(sched({ varianceDays: 30 }), TODAY).status).toBe('at_risk')
    expect(scheduleRow(sched({ dataDate: '2026-06-01' }), TODAY).alerts[0].code).toBe('stale_status')
    expect(scheduleRow(sched({ projectFinish: '2026-09-01' }), TODAY).alerts.map(a => a.code)).toContain('finish_passed')
    expect(scheduleRow(sched({ dataDate: '2026-06-01', percentComplete: 100, projectFinish: '2026-05-01' }), TODAY).alerts).toEqual([])
  })
  it('orders the most urgent first, skips published copies and totals the alerts', () => {
    const p = buildPortfolio([plan()], [sched({ id: 'ok' }), sched({ id: 'bad', varianceDays: 30 }), sched({ id: 'gen', sourceType: 'generated' })], TODAY)
    expect(p.rows.map(r => r.id)).toEqual(['bad', 'ok', 'p1'])
    expect(p.totals).toMatchObject({ projects: 3, atRisk: 1, onTrack: 1, attention: 0 })
    expect(p.totals.alerts).toBe(1)
  })
})
