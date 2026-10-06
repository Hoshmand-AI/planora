import { describe, it, expect } from 'vitest'
import type { Activity, Relationship } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import type { WorkCalendar } from '@/lib/planning/types'
import { compareSchedules, orderSeries, pickDefaultBase, type CompareSide } from '@/lib/analysis/compare'
import { exportComparisonCsv } from '@/lib/export/csv'

const a = (sched: string, code: string, f: Partial<Activity> = {}) => makeActivity(sched, { activityId: code, name: code, duration: 5, ...f })
const rel = (sched: string, p: Activity, s: Activity, lag = 0): Relationship => ({ id: `${p.id}${s.id}`, scheduleId: sched, predecessorId: p.id, successorId: s.id, type: 'FS', lag })
const side = (id: string, version: string, finish: string, acts: Activity[], rels: Relationship[]): CompareSide =>
  ({ schedule: { id, name: 'P', version, dataDate: null, forecastFinish: finish }, activities: acts, relationships: rels })

describe('compareSchedules', () => {
  const b1 = a('b', 'A100', { actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete' })
  const b2 = a('b', 'A200', { earlyFinish: '2026-03-20', totalFloat: 10 })
  const b3 = a('b', 'A300', { earlyFinish: '2026-03-27', totalFloat: 0 })
  const b4 = a('b', 'A400', { earlyFinish: '2026-04-03' })
  const before = side('B', 'Update 5', '2026-04-03', [b1, b2, b3, b4], [rel('b', b1, b2), rel('b', b2, b3), rel('b', b3, b4, 2)])

  const c1 = a('c', 'A100', { actualStart: '2026-03-02', actualFinish: '2026-03-09', status: 'complete' }) // actual rewritten
  const c2 = a('c', 'A200', { earlyFinish: '2026-04-01', totalFloat: 2, duration: 12, actualStart: '2026-03-16', status: 'in_progress' })
  const c3 = a('c', 'A300', { earlyFinish: '2026-04-08', totalFloat: 0, constraintType: 'FNLT', constraintDate: '2026-04-10' })
  const c5 = a('c', 'A500', { earlyFinish: '2026-04-15' })
  const after = side('C', 'Update 6', '2026-04-15', [c1, c2, c3, c5], [rel('c', c1, c2), rel('c', c2, c3), rel('c', c3, c5)])
  const r = compareSchedules(before, after)

  it('measures finish movement and adds/deletes by activity ID', () => {
    expect(r.finishMovement).toBe(12)
    expect(r.added).toEqual([{ code: 'A500', name: 'A500' }])
    expect(r.deleted).toEqual([{ code: 'A400', name: 'A400' }])
    expect(r.matched).toBe(3)
  })
  it('finds logic, duration and constraint changes', () => {
    expect(r.logicAdded).toEqual([{ pred: 'A300', succ: 'A500', type: 'FS', lag: 0 }])
    expect(r.logicDeleted).toEqual([{ pred: 'A300', succ: 'A400', type: 'FS', lag: 2 }])
    expect(r.changes.find(c => c.field === 'duration')).toMatchObject({ code: 'A200', before: 5, after: 12, delta: 7 })
    expect(r.changes.find(c => c.field === 'constraint')).toMatchObject({ code: 'A300', before: null, after: 'FNLT 2026-04-10' })
  })
  it('flags rewritten actuals, float erosion and progress', () => {
    expect(r.actualsRewritten).toEqual([expect.objectContaining({ code: 'A100', field: 'actual_finish', delta: 3 })])
    expect(r.floatErosion[0]).toMatchObject({ code: 'A200', before: 10, after: 2, delta: -8 })
    expect(r.progress.started).toEqual(['A200'])
    expect(r.summary.join(' ')).toMatch(/moved 12 calendar days later/)
  })
})

describe('compareSchedules: calendars, pairing and the finish', () => {
  const cal = (id: string, name: string, f: Partial<WorkCalendar> = {}): WorkCalendar => ({ id, name, workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: ['2026-07-03'], ...f })
  const mk = (sched: string, version: string, dataDate: string, finish: string, acts: Activity[], rels: Relationship[], extra: Partial<CompareSide> = {}): CompareSide =>
    ({ schedule: { id: sched, name: 'P', version, dataDate, forecastFinish: finish, projectKey: 'riverside' }, activities: acts, relationships: rels, ...extra })

  it('matches calendars by name, so renumbered calendar ids are not a change', () => {
    const b = [a('b', 'A1', { calendarId: '100', earlyStart: '2026-03-02' }), a('b', 'A2', { calendarId: '200' })]
    const c = [a('c', 'A1', { calendarId: '7', earlyStart: '2026-03-02' }), a('c', 'A2', { calendarId: '8' })]
    const r = compareSchedules(
      mk('B', 'U1', '2026-03-01', '2026-04-01', b, [], { calendars: [cal('100', '5 Day'), cal('200', '7 Day', { workDays: [0, 1, 2, 3, 4, 5, 6] })] }),
      mk('C', 'U2', '2026-04-01', '2026-04-01', c, [], { calendars: [cal('7', '5 Day'), cal('8', '7 Day', { workDays: [0, 1, 2, 3, 4, 5, 6] })] }))
    expect(r.changes.filter(x => x.field === 'calendar')).toEqual([])
    expect(r.calendarChanges).toEqual([])
  })

  it('reports activity calendar moves by name and calendar definition / holiday edits', () => {
    const b = [a('b', 'A1', { calendarId: '100' })]
    const c = [a('c', 'A1', { calendarId: '8' })]
    const r = compareSchedules(
      mk('B', 'U1', '2026-03-01', '2026-04-01', b, [], { calendars: [cal('100', '5 Day'), cal('200', '6 Day', { workDays: [1, 2, 3, 4, 5, 6] })] }),
      mk('C', 'U2', '2026-04-01', '2026-04-01', c, [], { calendars: [cal('7', '5 Day', { holidays: ['2026-07-03', '2026-11-26'], hoursPerDay: 10 }), cal('8', '6 Day', { workDays: [1, 2, 3, 4, 5, 6] })] }))
    expect(r.changes.find(x => x.field === 'calendar')).toMatchObject({ code: 'A1', before: '5 Day', after: '6 Day' })
    expect(r.calendarChanges).toEqual(expect.arrayContaining([
      { calendar: '5 Day', field: 'hours_per_day', before: '8', after: '10' },
      { calendar: '5 Day', field: 'holidays_added', before: null, after: '11/26/2026' },
    ]))
    const s = r.summary.join(' ')
    expect(s).toMatch(/Calendar changes: .*"5 Day" hours per day 8 → 10; "5 Day" non-work days added: 11\/26\/2026/)
    expect(s).toMatch(/1 activity moved to a different calendar \(e\.g\. A1: "5 Day" → "6 Day"\)/)
  })

  it('reports start-date movement', () => {
    const r = compareSchedules(
      mk('B', 'U1', '2026-03-01', '2026-04-01', [a('b', 'A1', { earlyStart: '2026-03-02' }), a('b', 'A2', { earlyStart: '2026-03-09' })], []),
      mk('C', 'U2', '2026-04-01', '2026-04-01', [a('c', 'A1', { earlyStart: '2026-03-12' }), a('c', 'A2', { earlyStart: '2026-03-06' })], []))
    expect(r.changes.filter(x => x.field === 'start').map(x => [x.code, x.delta])).toEqual([['A1', 10], ['A2', -3]])
    expect(r.summary.join(' ')).toMatch(/2 start dates moved \(1 later, 1 earlier\); the largest is A1, 10 calendar days later/)
  })

  it('warns when the two schedules are different projects or the order is reversed', () => {
    const diff = compareSchedules(
      { ...mk('B', 'U1', '2026-03-01', '2026-04-01', [a('b', 'X1')], []), schedule: { id: 'B', name: 'P', version: 'U1', dataDate: '2026-03-01', forecastFinish: null, projectKey: 'other job' } },
      mk('C', 'U2', '2026-04-01', '2026-04-01', [a('c', 'A1')], []))
    expect(diff.warnings[0]).toMatch(/different projects/)
    const noCommon = compareSchedules(mk('B', 'U1', '2026-03-01', '2026-04-01', [a('b', 'X1')], []), mk('C', 'U2', '2026-04-01', '2026-04-01', [a('c', 'A1')], []))
    expect(noCommon.warnings[0]).toMatch(/no activity IDs in common/)
    const reversed = compareSchedules(mk('C', 'U2', '2026-04-01', '2026-04-01', [a('c', 'A1')], []), mk('B', 'U1', '2026-03-01', '2026-04-01', [a('b', 'A1')], []))
    expect(reversed.warnings[0]).toMatch(/reversed: the base U2 has a later data date \(04\/01\/2026\) than U1 \(03\/01\/2026\)/)
    expect(reversed.summary[0]).toBe(reversed.warnings[0])
  })

  it('measures the finish on the same finish activity in both updates', () => {
    const b = [a('b', 'FIN', { earlyFinish: '2026-06-30' }), a('b', 'PUNCH', { earlyFinish: '2026-06-15' })]
    const c = [a('c', 'FIN', { earlyFinish: '2026-07-03' }), a('c', 'PUNCH', { earlyFinish: '2026-07-20' })]
    const r = compareSchedules(
      mk('B', 'U1', '2026-03-01', '2026-06-30', b, [], { finishMilestone: { code: 'FIN', forecastFinish: '2026-06-30' } }),
      // PUNCH now finishes last, so the project forecast moved 20 days, but the finish milestone moved 3.
      mk('C', 'U2', '2026-04-01', '2026-07-20', c, [], { finishMilestone: { code: 'FIN', forecastFinish: '2026-07-03' } }))
    expect(r.finishActivity).toBe('FIN')
    expect(r.finishMovement).toBe(3)
    expect(r.projectFinishMovement).toBe(20)
    expect(r.summary.join(' ')).toMatch(/The forecast finish \(FIN\) moved 3 calendar days later \(06\/30\/2026 → 07\/03\/2026\)/)
  })

  it('lists a deleted driving-path activity as having left the path', () => {
    const b1 = a('b', 'A1'), b2 = a('b', 'A2'), b3 = a('b', 'A3')
    const c1 = a('c', 'A1'), c3 = a('c', 'A3')
    const r = compareSchedules(
      mk('B', 'U1', '2026-03-01', '2026-04-01', [b1, b2, b3], [rel('b', b1, b2), rel('b', b2, b3)], { longestPath: [b1.id, b2.id, b3.id] }),
      mk('C', 'U2', '2026-04-01', '2026-04-01', [c1, c3], [rel('c', c1, c3)], { longestPath: [c1.id, c3.id] }))
    expect(r.criticalPath.left).toEqual(['A2'])
    expect(r.criticalPath.leftDeleted).toEqual(['A2'])
    expect(r.summary.join(' ')).toMatch(/Driving path: 0 joined, 1 left \(A2 deleted\)/)
  })

  it('says when a Mandatory Finish absorbed the slip', () => {
    const fin = a('c', 'FIN', { earlyFinish: '2026-06-30', constraintType: 'MFO', constraintDate: '2026-06-30' })
    const r = compareSchedules(
      mk('B', 'U1', '2026-03-01', '2026-06-30', [a('b', 'FIN', { earlyFinish: '2026-06-30' })], [], { finishMilestone: { code: 'FIN', forecastFinish: '2026-06-30' } }),
      mk('C', 'U2', '2026-04-01', '2026-06-30', [fin], [], { finishMilestone: { code: 'FIN', forecastFinish: '2026-06-30' }, violations: [{ id: fin.id, type: 'MFO', constraintDate: '2026-06-30', logicDate: '2026-07-14', days: 10 }] }))
    expect(r.finishMovement).toBe(0)
    expect(r.finishHeldBy).toMatchObject({ code: 'FIN', days: 10 })
    expect(r.summary.join(' ')).toMatch(/did not move only because a Mandatory Finish constraint on FIN holds it at 06\/30\/2026; logic alone would finish it 07\/14\/2026, 10 work days later/)
  })
})

describe('default compare base', () => {
  const s = (id: string, dataDate: string | null, uploadedAt: string) => ({ id, dataDate, uploadedAt })
  it('is the latest upload with an earlier data date, never a same-data-date re-upload', () => {
    const u1 = s('u1', '2026-03-01', '2026-03-05T00:00:00Z')
    const u2 = s('u2', '2026-04-01', '2026-04-05T00:00:00Z')
    const u2b = s('u2b', '2026-04-01', '2026-04-06T00:00:00Z') // re-upload of the April update
    const late = s('u0', '2026-02-01', '2026-05-01T00:00:00Z') // older data date uploaded later
    const series = orderSeries([u2b, late, u2, u1])
    expect(series.map(x => x.id)).toEqual(['u0', 'u1', 'u2', 'u2b'])
    expect(pickDefaultBase(series, u2b)?.id).toBe('u1')
    expect(pickDefaultBase(series, u2)?.id).toBe('u1')
    expect(pickDefaultBase(series, u1)?.id).toBe('u0')
    expect(pickDefaultBase(series, late)).toBeUndefined()
  })
})

describe('comparison CSV', () => {
  it('lists activity-level differences and neutralizes formula text', () => {
    const b = a('b', '=HYPERLINK("x")', { earlyFinish: '2026-03-20' })
    const c = a('c', '=HYPERLINK("x")', { earlyFinish: '2026-03-25', duration: 9 })
    const r = compareSchedules(side('B', 'Update 5', '2026-04-03', [b], []), side('C', 'Update 6', '2026-04-08', [c], []))
    const csv = exportComparisonCsv(r)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Category,Activity ID,Activity Name,Field,Before (Update 5),After (Update 6),Change (days)')
    expect(csv).toContain(`Changed,"'=HYPERLINK(""x"")","'=HYPERLINK(""x"")",finish,03/20/2026,03/25/2026,5`)
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
  })
})
