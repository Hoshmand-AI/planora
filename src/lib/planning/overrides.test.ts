import { describe, expect, it } from 'vitest'
import type { GeneratedSchedule, PlanActivity, PlanLink } from './types'
import { applyEdit, nextActivityCode } from './overrides'

describe('nextActivityCode follows the schedule ID scheme', () => {
  it('continues a stepped series after its highest ID', () => {
    expect(nextActivityCode(['A1000', 'A1010', 'A1020'])).toBe('A1030')
    expect(nextActivityCode(['A1000', 'A1010'])).toBe('A1020')
    // gaps in the middle do not matter; the series continues from the top
    expect(nextActivityCode(['A1000', 'A1010', 'A1020', 'A1050'])).toBe('A1060')
  })

  it('keeps prefix and zero-padded width, and the dominant series wins', () => {
    expect(nextActivityCode(['EW-0100', 'EW-0105', 'EW-0110', 'MS01'])).toBe('EW-0115')
    expect(nextActivityCode(['CN1000', 'CN1001', 'CN1002', 'A1', 'B2'])).toBe('CN1003')
    expect(nextActivityCode(['A0005', 'A0010', 'A0015'])).toBe('A0020')
  })

  it('uses the most common gap as the step', () => {
    // gaps 10, 10, 10, 5 → step 10, continuing after the highest ID
    expect(nextActivityCode(['A1000', 'A1010', 'A1020', 'A1030', 'A1035'])).toBe('A1045')
  })

  it('falls back to U-codes only when there is no pattern', () => {
    expect(nextActivityCode([])).toBe('U0000')
    expect(nextActivityCode(['Start', 'Finish', 'X'])).toBe('U0003')
    expect(nextActivityCode(['Start', 'U0002', 'X'])).toBe('U0003')
  })
})

describe('add_activity uses the existing ID scheme', () => {
  const rationale = { summary: 'x', sources: [], confidence: 'high' as const }
  const act = (id: string, code: string, duration: number, extra: Partial<PlanActivity> = {}): PlanActivity =>
    ({ id, code, name: code, duration, type: duration ? 'task' : 'milestone', category: 'other', phase: 'structure', rationale, ...extra })
  const link = (from: string, to: string): PlanLink => ({ id: `${from}>${to}`, from, to, type: 'FS', lag: 0, rationale })
  const s: GeneratedSchedule = {
    generatedAt: '2026-01-01T00:00:00Z', projectStart: '2026-03-02', defaultCalendarId: 'std', assumptions: [],
    calendars: [{ id: 'std', name: 'Std', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] }],
    activities: [
      act('a', 'A1000', 0, { category: 'ntp' }),
      act('b', 'A1010', 5),
      act('c', 'A1020', 0, { category: 'substantial_completion' }),
    ],
    links: [link('a', 'b'), link('b', 'c')],
  }

  it('gives the added activity the next ID in the series and leaves other IDs alone', () => {
    const { schedule } = applyEdit(s, { kind: 'add_activity', name: 'Owner equipment', duration: 3, after: 'b', reason: 'Owner scope' }, 'Ana')
    const added = schedule.activities.find(a => a.name === 'Owner equipment')!
    expect(added.code).toBe('A1030')
    expect(schedule.activities.filter(a => a.id !== added.id).map(a => a.code)).toEqual(['A1000', 'A1010', 'A1020'])
    const again = applyEdit(schedule, { kind: 'add_activity', name: 'Second add', duration: 2, after: 'b', reason: 'More scope' }, 'Ana').schedule
    expect(again.activities.find(a => a.name === 'Second add')!.code).toBe('A1040')
  })
})
