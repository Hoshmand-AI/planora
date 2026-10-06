import { describe, expect, it } from 'vitest'
import type { Activity } from '@/lib/db'
import { nearTermOutlook } from './near-term'

const act = (over: Partial<Activity>): Activity => ({
  id: over.activityId || 'x', scheduleId: 's', activityId: 'A', name: 'Work', wbs: '', duration: 20, remainingDuration: 20, percentComplete: 0,
  earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
  totalFloat: 10, freeFloat: 0, isCritical: false, status: 'not_started', activityType: 'task', ...over,
})

describe('nearTermOutlook', () => {
  const acts = [
    act({ activityId: 'IP', status: 'in_progress', actualStart: '2026-05-01', earlyStart: '2026-05-01', earlyFinish: '2026-10-20', duration: 120, remainingDuration: 12, totalFloat: 0, isCritical: true }),
    act({ activityId: 'SOON', earlyStart: '2026-09-10', earlyFinish: '2026-09-20' }),
    act({ activityId: 'EDGE', earlyStart: '2026-09-15', earlyFinish: '2026-09-25' }),
    act({ activityId: 'LATER', earlyStart: '2026-11-03', earlyFinish: '2026-12-01' }),
    act({ activityId: 'DONE', status: 'complete', actualStart: '2026-04-01', actualFinish: '2026-04-30', earlyStart: '2026-04-01' }),
    act({ activityId: 'SUM', activityType: 'summary', earlyStart: '2026-09-05' }),
  ]

  it('windows on the data date, lists in-progress work separately with remaining duration', () => {
    const o = nearTermOutlook(acts, '2026-09-01', '2026-10-06')
    expect(o).toMatchObject({ windowStart: '2026-09-01', windowEnd: '2026-09-15', basis: 'data_date', inProgressCount: 1, startingCount: 2 })
    expect(o.inProgress.map(r => [r.activityId, r.remainingDuration])).toEqual([['IP', 12]])
    expect(o.starting.map(r => r.activityId)).toEqual(['SOON', 'EDGE'])
  })

  it('falls back to today without a data date and flags overdue starts', () => {
    const o = nearTermOutlook(acts, null, '2026-09-12')
    expect(o.basis).toBe('today')
    expect(o.windowEnd).toBe('2026-09-26')
    expect(o.starting.find(r => r.activityId === 'SOON')?.startOverdue).toBe(true)
    expect(o.starting.find(r => r.activityId === 'EDGE')?.startOverdue).toBeUndefined()
    expect(o.inProgress[0].startOverdue).toBeUndefined()
  })
})
