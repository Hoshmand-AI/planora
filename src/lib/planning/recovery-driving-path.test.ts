import { describe, it, expect } from 'vitest'
import { makeActivity } from '@/lib/parsers/types'
import type { Relationship } from '@/lib/db'
import { defaultCalendar } from './calendar'
import { uploadedRecoveryOptions, type NetworkInput } from './uploaded-recovery'

describe('recovery options: the driving path to the contract milestone', () => {
  // D1 Erect steel (20d) -> D2 Pour slab (10d) -> FS+10 -> M; N1 Install fence (38d) -> M.
  // N1 finishes later than D2, but D2 with its 10-day lag is what sets M: the drivers are D1 and D2.
  const cal = defaultCalendar()
  const acts = [
    makeActivity('s', { activityId: 'D1', name: 'Erect structural steel', duration: 20, remainingDuration: 20, calendarId: cal.id }),
    makeActivity('s', { activityId: 'D2', name: 'Pour slab on deck', duration: 10, remainingDuration: 10, calendarId: cal.id }),
    makeActivity('s', { activityId: 'N1', name: 'Install site fence', duration: 38, remainingDuration: 38, calendarId: cal.id }),
    makeActivity('s', { activityId: 'M', name: 'Substantial Completion', duration: 0, activityType: 'milestone', calendarId: cal.id }),
  ]
  const id = (c: string) => acts.find(a => a.activityId === c)!.id
  const rel = (p: string, q: string, lag = 0): Relationship => ({ id: `${p}${q}`, scheduleId: 's', predecessorId: id(p), successorId: id(q), type: 'FS', lag })
  const net: NetworkInput = {
    activities: acts, relationships: [rel('D1', 'D2'), rel('D2', 'M', 10), rel('N1', 'M')], calendars: [cal], defaultCalendarId: cal.id,
    projectStart: '2026-03-02', dataDate: '2026-03-02', mustFinishBy: null, progressMode: 'retained',
    contract: { milestoneId: id('M'), date: '2026-04-10', dateSource: 'Contract' },
  } as NetworkInput

  it('names the activities that actually drive the milestone, and offers options on them', () => {
    const plan = uploadedRecoveryOptions(net)
    expect(plan).not.toBeNull()
    const text = JSON.stringify(plan)
    expect(text).toMatch(/D1|D2/)
    expect(plan!.options.some(o => o.daysSaved > 0)).toBe(true)
    expect(plan!.options.filter(o => o.daysSaved > 0).every(o => !/N1 Install site fence/.test(o.title))).toBe(true)
  })
})

describe('finish when a mandatory constraint holds work later than logic', () => {
  it('is the last date on screen, in the what-if evaluation as on the dashboard', async () => {
    const { evaluateNetwork } = await import('./uploaded-recovery')
    const cal = defaultCalendar()
    const acts = [
      makeActivity('s', { activityId: 'A', name: 'A', duration: 5, remainingDuration: 5, calendarId: cal.id }),
      makeActivity('s', { activityId: 'B', name: 'B', duration: 5, remainingDuration: 5, calendarId: cal.id, constraintType: 'MFO', constraintDate: '2026-03-20' }),
      makeActivity('s', { activityId: 'C', name: 'C', duration: 5, remainingDuration: 5, calendarId: cal.id }),
    ]
    const id = (c: string) => acts.find(a => a.activityId === c)!.id
    const rel = (p: string, q: string): Relationship => ({ id: `${p}${q}`, scheduleId: 's', predecessorId: id(p), successorId: id(q), type: 'FS', lag: 0 })
    const r = evaluateNetwork({ activities: acts, relationships: [rel('A', 'B'), rel('B', 'C')], calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', dataDate: '2026-03-02', mustFinishBy: null, progressMode: 'retained' } as NetworkInput, [])
    expect(r.finish).toBe('2026-03-27')
    expect(r.measured).toBe('2026-03-27')
  })
})
