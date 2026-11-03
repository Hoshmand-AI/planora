import { describe, it, expect } from 'vitest'
import { schedulePercentComplete } from './progress'

type A = Parameters<typeof schedulePercentComplete>[0][number]
const t = (duration: number, percentComplete: number, f: Partial<A> = {}): A => ({ activityType: 'task', duration, percentComplete, status: percentComplete >= 100 ? 'complete' : percentComplete > 0 ? 'in_progress' : 'not_started', actualFinish: null, ...f })

describe('schedulePercentComplete', () => {
  it('weights physical % complete by duration (every activity under way is not 0%)', () => {
    expect(schedulePercentComplete([t(10, 50), t(10, 50)])).toBe(50)
    expect(schedulePercentComplete([t(30, 100), t(10, 0)])).toBe(75)
  })
  it('ignores milestones, LOE and WBS summaries', () => {
    expect(schedulePercentComplete([t(10, 40), t(0, 100, { activityType: 'milestone' }), t(500, 0, { activityType: 'loe' }), t(200, 0, { activityType: 'summary' })])).toBe(40)
  })
  it('never shows a started project as 0% or an unfinished one as 100%', () => {
    expect(schedulePercentComplete([t(1, 50), t(999, 0)])).toBe(1)
    expect(schedulePercentComplete([t(999, 100), t(1, 50)])).toBe(99)
    expect(schedulePercentComplete([t(5, 0), t(5, 0)])).toBe(0)
  })
  it('a finished activity counts 100% whatever its % field says', () => {
    expect(schedulePercentComplete([t(10, 0, { status: 'complete' }), t(10, 0)])).toBe(50)
  })
})
