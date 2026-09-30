import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue } from './types'
import { generateSchedule } from './generator'
import { checkAnswerDates, elicit, questionBank } from './elicitation'
import { evaluatePlan, scheduleDateChecks, toAnalyzable } from './evaluation'
import { recoveryPlan } from './recovery'
import { completeSchedule } from './complete-schedule'
import { projectBrief } from '@/lib/analysis/brief'
import { guidanceFor } from '@/lib/analysis/dcma-guidance'
import { runDcma } from '@/lib/analysis/dcma'
import type { Activity, Schedule } from '@/lib/db'

const k = (value: AnswerValue, note?: string): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z', ...(note ? { note } : {}) })
const base = (): Record<string, Answer> => ({
  'project.type': k('data_center'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(200000),
  'project.stories': k(2), 'project.target_start': k('2026-11-02'), 'design.drawings': k(true), 'design.percent': k(60), 'project.federal': k(false),
})

describe('start date on a weekend', () => {
  it('moves NTP to the next working day and keeps DCMA #9 clean', () => {
    const g = generateSchedule({ answers: { ...base(), 'project.target_start': k('2026-10-31') }, today: '2026-09-30' })
    expect(g.projectStart).toBe('2026-11-02')
    expect(g.cpm!.times.ntp.earlyStart).toBe('2026-11-02')
    expect(g.notes!.join(' ')).toMatch(/not a working day/)
    expect(runDcma(toAnalyzable(g)).checks.find(c => c.id === 9)!.result).toBe('pass')
  })
})

describe('qualified answers', () => {
  it('carries the team note to the affected activities and the schedule', () => {
    const a = base()
    const bank = questionBank({ answers: a })
    const pm = bank.permits.find(p => /building/i.test(p.name))!
    a[`permit.${pm.id}.status`] = k('submitted', 'Issued for foundations only; superstructure still in review')
    const g = generateSchedule({ answers: a, today: '2026-09-30' })
    const q = g.qualifications!.find(x => x.questionId === `permit.${pm.id}.status`)!
    expect(q.note).toMatch(/foundations only/)
    expect(q.activityIds.length).toBeGreaterThan(0)
    const act = g.activities.find(x => x.id === q.activityIds[0])!
    expect(act.rationale.confidence).toBe('low')
    expect(act.rationale.assumptions!.join(' ')).toMatch(/foundations only/)
    expect(evaluatePlan(g, a, null, []).findings.join(' ')).toMatch(/qualified in the team's own words/)
  })
})

describe('date logic', () => {
  it('flags milestone targets out of sequence as soon as they are entered', () => {
    const a = { ...base(), 'milestone.structure.target': k('2027-09-01'), 'milestone.dry_in.target': k('2027-06-01') }
    const { permits, longLead } = questionBank({ answers: a })
    const issues = checkAnswerDates(a, permits, longLead)
    expect(issues.some(i => /Building dried-in.*before.*Structure complete/.test(i.text))).toBe(true)
    expect(elicit({ answers: a }).conflicts.join(' ')).toMatch(/dried-in/)
  })

  it('flags a delivery that arrives after the milestone it gates', () => {
    const a = base()
    const { longLead } = questionBank({ answers: a })
    const gear = longLead.find(l => /switchgear/i.test(l.name))!
    a[`procure.${gear.id}.status`] = k('released')
    a[`procure.${gear.id}.delivery`] = k('2028-06-01')
    a['milestone.electrical_service.target'] = k('2028-03-01')
    const { permits, longLead: ll } = questionBank({ answers: a })
    expect(checkAnswerDates(a, permits, ll).some(i => /switchgear/i.test(i.text) && /Permanent power/.test(i.text))).toBe(true)
  })

  it('checks targets against the network and says what drives them', () => {
    const a = { ...base(), 'milestone.dry_in.target': k('2027-01-15') }
    const g = generateSchedule({ answers: a, today: '2026-09-30' })
    expect(g.milestoneTargets![0].key).toBe('dry_in')
    const checks = scheduleDateChecks(g)
    const c = checks.find(x => x.questionIds.includes('milestone.dry_in.target'))!
    expect(c.severity).toBe('error')
    expect(c.text).toMatch(/days after your target of 01\/15\/2027/)
    expect(Math.min(...Object.values(g.cpm!.times).map(t => t.totalFloat))).toBeLessThan(0)
  })
})

describe('recovery options', () => {
  it('explains the gap and models options on the real network', () => {
    const a = { ...base(), 'project.required_finish': k('2028-06-30') }
    const g = generateSchedule({ answers: a, today: '2026-09-30' })
    expect(g.cpm!.projectFinish > '2028-06-30').toBe(true)
    const r = recoveryPlan(g, a, null)!
    expect(r.gapDays).toBeGreaterThan(0)
    expect(r.explanation[0]).toMatch(/06\/30\/2028/)
    const ids = r.options.map(o => o.id)
    expect(ids).toEqual(expect.arrayContaining(['workweek', 'early_packages', 'move_date']))
    expect(r.options.find(o => o.id === 'workweek')!.daysSaved).toBeGreaterThan(0)
    expect(r.options[r.options.length - 1].id).toBe('move_date')
    for (const o of r.options) expect(o.newFinish).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(recoveryPlan(generateSchedule({ answers: base(), today: '2026-09-30' }), base(), null)).toBeNull()
  })
})

describe('DCMA guidance', () => {
  it('gives meaning, steps and actions for every check', () => {
    for (let id = 1; id <= 14; id++) {
      const g = guidanceFor({ id, name: 'x', metric: '1', threshold: '0', result: 'fail', offenders: ['A1'], explanation: 'e' }, { generated: true, hasRecovery: true, offCalendarShare: 0.8 })
      expect(g.meaning.length).toBeGreaterThan(10)
    }
    expect(guidanceFor({ id: 7, name: '', metric: '', threshold: '', result: 'fail', offenders: [], explanation: '' }, { generated: true, hasRecovery: true }).actions[0].kind).toBe('recovery')
    expect(guidanceFor({ id: 6, name: '', metric: '', threshold: '', result: 'fail', offenders: ['A'], explanation: '' }, { generated: true, offCalendarShare: 0.9 }).actions.some(a => a.kind === 'accept')).toBe(true)
  })
})

describe('uploaded files without calculated results', () => {
  const mk = (id: string, dur: number): Activity => ({ id, scheduleId: 's', activityId: id, name: id, wbs: '', duration: dur, remainingDuration: dur, percentComplete: 0, earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null, totalFloat: 0, freeFloat: 0, isCritical: true, status: 'not_started', activityType: 'task' })
  const acts = [mk('A', 5), mk('B', 10), mk('C', 3), mk('D', 2)]
  const rel = (p: string, s: string) => ({ id: p + s, scheduleId: 's', predecessorId: p, successorId: s, type: 'FS' as const, lag: 0 })

  it('schedules from logic instead of calling everything critical', () => {
    const r = completeSchedule({ activities: acts, relationships: [rel('A', 'B'), rel('A', 'C'), rel('B', 'D'), rel('C', 'D')], calendars: [], defaultCalendarId: null, projectStart: '2026-09-01', projectFinish: null, dataDate: null })
    expect(r.projectFinish).toBeTruthy()
    expect(r.activities.find(a => a.id === 'C')!.isCritical).toBe(false)
    expect(r.activities.find(a => a.id === 'C')!.totalFloat).toBeGreaterThan(0)
    expect(r.activities.find(a => a.id === 'B')!.isCritical).toBe(true)
    expect(r.note).toMatch(/Planora scheduled/)
  })

  it('does not claim a critical path when the file has no logic', () => {
    const r = completeSchedule({ activities: acts, relationships: [], calendars: [], defaultCalendarId: null, projectStart: null, projectFinish: null, dataDate: null })
    expect(r.activities.every(a => !a.isCritical)).toBe(true)
    expect(r.note).toMatch(/no activity relationships/)
  })

  it('writes a short project overview', () => {
    const s = { id: 's', userId: 'u', orgId: 'o', name: 'Ashburn DC Phase 1', version: 'v1', sourceType: 'p6_xer', fileName: 'x', uploadedAt: '', activityCount: 4, relationshipCount: 3, projectStart: '2026-09-01', projectFinish: '2028-03-01', dataDate: '2026-09-01', varianceDays: null, criticalCount: 0, percentComplete: 0, calendars: [], defaultCalendarId: null, warnings: [], planId: null, projectType: null, region: 'VA', grossSqft: 250000 } as Schedule
    const b = projectBrief(s, [{ ...mk('M', 0), name: 'Substantial Completion', activityType: 'milestone', earlyFinish: '2028-02-15' }, { ...mk('F', 20), category: 'foundations', earlyStart: '2026-10-01' }])
    expect(b.summary).toMatch(/data center project in VA/)
    expect(b.summary).toMatch(/09\/01\/2026 to 03\/01\/2028/)
    expect(b.summary).toMatch(/Substantial Completion by 02\/15\/2028/)
  })
})
