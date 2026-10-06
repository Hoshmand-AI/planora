import { describe, it, expect } from 'vitest'
import type { Activity, Relationship } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import { compareSchedules, type CompareSide } from '@/lib/analysis/compare'

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
