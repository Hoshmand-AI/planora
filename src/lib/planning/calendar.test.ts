import { describe, it, expect } from 'vitest'
import type { WorkCalendar } from '@/lib/planning/types'
import {
  addWorkDays,
  calendarWarnings,
  countWorkDaysInclusive,
  defaultCalendar,
  finishFromStart,
  isWorkDay,
  nextWorkDay,
  prevWorkDay,
  startFromFinish,
  toDayNumber,
  fromDayNumber,
  usFederalHolidays,
  weekdayOf,
  workDaysBetween,
} from '@/lib/planning/calendar'

const cal5 = defaultCalendar()
const cal7: WorkCalendar = { id: '7d', name: '7-Day', workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: 10, holidays: [] }
const calHol: WorkCalendar = {
  ...cal5,
  id: 'hol',
  holidays: ['2026-03-04'], // Wednesday
  extraWorkDays: ['2026-03-07'], // Saturday
}

describe('day numbers', () => {
  it('round-trips and ignores time parts', () => {
    expect(fromDayNumber(toDayNumber('2026-03-02'))).toBe('2026-03-02')
    expect(toDayNumber('2026-03-02T15:30:00Z')).toBe(toDayNumber('2026-03-02'))
    expect(Number.isNaN(toDayNumber('2026-02-30'))).toBe(true)
    expect(weekdayOf('2026-03-02')).toBe(1)
    expect(weekdayOf('2026-03-14')).toBe(6)
    expect(weekdayOf('1969-12-31')).toBe(3)
  })
})

describe('defaultCalendar', () => {
  it('is a 5-day, 8h calendar', () => {
    expect(cal5.id).toBe('default-5d')
    expect(cal5.workDays).toEqual([1, 2, 3, 4, 5])
    expect(cal5.hoursPerDay).toBe(8)
    expect(cal5.holidays).toEqual([])
  })
})

describe('isWorkDay', () => {
  it('honours weekdays, holidays and extra work days', () => {
    expect(isWorkDay('2026-03-02', cal5)).toBe(true)
    expect(isWorkDay('2026-03-07', cal5)).toBe(false)
    expect(isWorkDay('2026-03-04', calHol)).toBe(false)
    expect(isWorkDay('2026-03-07', calHol)).toBe(true)
    expect(isWorkDay('2026-03-08', cal7)).toBe(true)
  })
})

describe('snap', () => {
  it('nextWorkDay / prevWorkDay are inclusive', () => {
    expect(nextWorkDay('2026-03-02', cal5)).toBe('2026-03-02')
    expect(nextWorkDay('2026-03-07', cal5)).toBe('2026-03-09')
    expect(prevWorkDay('2026-03-08', cal5)).toBe('2026-03-06')
    expect(nextWorkDay('2026-03-04', calHol)).toBe('2026-03-05')
    expect(prevWorkDay('2026-03-04', calHol)).toBe('2026-03-03')
  })
})

describe('addWorkDays', () => {
  it('moves forward, backward and zero', () => {
    expect(addWorkDays('2026-03-02', 0, cal5)).toBe('2026-03-02')
    expect(addWorkDays('2026-03-02', 4, cal5)).toBe('2026-03-06')
    expect(addWorkDays('2026-03-06', 1, cal5)).toBe('2026-03-09')
    expect(addWorkDays('2026-03-09', -1, cal5)).toBe('2026-03-06')
    expect(addWorkDays('2026-03-02', -1, cal5)).toBe('2026-02-27')
    expect(addWorkDays('2026-03-02', 10, cal5)).toBe('2026-03-16')
  })
  it('skips holidays and uses extra work days', () => {
    // Mon 3/2 +2: Tue 3/3, (Wed holiday) Thu 3/5
    expect(addWorkDays('2026-03-02', 2, calHol)).toBe('2026-03-05')
    // Fri 3/6 +1 -> Sat 3/7 (extra work day)
    expect(addWorkDays('2026-03-06', 1, calHol)).toBe('2026-03-07')
    expect(addWorkDays('2026-03-09', -1, calHol)).toBe('2026-03-07')
    expect(addWorkDays('2026-03-05', -2, calHol)).toBe('2026-03-02')
  })
  it('from a non-work day counts strictly after', () => {
    expect(addWorkDays('2026-03-07', 1, cal5)).toBe('2026-03-09')
    expect(addWorkDays('2026-03-08', -1, cal5)).toBe('2026-03-06')
  })
  it('crosses year boundary', () => {
    expect(addWorkDays('2026-12-31', 1, cal5)).toBe('2027-01-01')
    expect(addWorkDays('2027-01-01', 1, cal5)).toBe('2027-01-04')
  })
})

describe('finishFromStart / startFromFinish', () => {
  it('finish is the last occupied work day', () => {
    expect(finishFromStart('2026-03-02', 1, cal5)).toBe('2026-03-02')
    expect(finishFromStart('2026-03-02', 5, cal5)).toBe('2026-03-06')
    expect(finishFromStart('2026-03-02', 6, cal5)).toBe('2026-03-09')
    expect(finishFromStart('2026-03-07', 1, cal5)).toBe('2026-03-09') // snaps start forward
    expect(finishFromStart('2026-03-02', 5, cal7)).toBe('2026-03-06')
    expect(finishFromStart('2026-03-02', 7, cal7)).toBe('2026-03-08')
  })
  it('milestones: finish == start', () => {
    expect(finishFromStart('2026-03-02', 0, cal5)).toBe('2026-03-02')
    expect(startFromFinish('2026-03-06', 0, cal5)).toBe('2026-03-06')
  })
  it('startFromFinish is the inverse', () => {
    expect(startFromFinish('2026-03-06', 5, cal5)).toBe('2026-03-02')
    expect(startFromFinish('2026-03-09', 6, cal5)).toBe('2026-03-02')
    expect(startFromFinish('2026-03-08', 1, cal5)).toBe('2026-03-06') // snaps finish backward
    for (let d = 1; d < 30; d++) {
      const f = finishFromStart('2026-03-03', d, calHol)
      expect(startFromFinish(f, d, calHol)).toBe('2026-03-03')
      expect(countWorkDaysInclusive('2026-03-03', f, calHol)).toBe(d)
    }
  })
})

describe('workDaysBetween / countWorkDaysInclusive', () => {
  it('is signed and consistent with addWorkDays', () => {
    expect(workDaysBetween('2026-03-02', '2026-03-02', cal5)).toBe(0)
    expect(workDaysBetween('2026-03-02', '2026-03-09', cal5)).toBe(5)
    expect(workDaysBetween('2026-03-09', '2026-03-02', cal5)).toBe(-5)
    expect(workDaysBetween('2026-03-06', '2026-03-09', cal5)).toBe(1)
    expect(workDaysBetween('2026-03-02', '2026-03-09', calHol)).toBe(5) // -Wed +Sat
    for (let k = -20; k <= 20; k++) {
      const b = addWorkDays('2026-03-05', k, calHol)
      expect(workDaysBetween('2026-03-05', b, calHol)).toBe(k)
    }
  })
  it('counts inclusive ranges', () => {
    expect(countWorkDaysInclusive('2026-03-02', '2026-03-08', cal5)).toBe(5)
    expect(countWorkDaysInclusive('2026-03-02', '2026-03-08', calHol)).toBe(5)
    expect(countWorkDaysInclusive('2026-03-02', '2026-03-08', cal7)).toBe(7)
    expect(countWorkDaysInclusive('2026-03-09', '2026-03-02', cal5)).toBe(0)
    expect(countWorkDaysInclusive('2026-01-01', '2026-12-31', cal5)).toBe(261)
  })
})

describe('degenerate calendars', () => {
  it('treats a calendar with no work days as 7-day and warns', () => {
    const empty: WorkCalendar = { id: 'x', name: 'Empty', workDays: [], hoursPerDay: 8, holidays: [] }
    expect(calendarWarnings(empty)[0]).toMatch(/7-day/)
    expect(addWorkDays('2026-03-06', 1, empty)).toBe('2026-03-07')
  })
  it('throws a clear error instead of looping forever', () => {
    const all: string[] = []
    for (let i = 0; i < 12_000; i++) all.push(fromDayNumber(toDayNumber('2026-01-01') + i))
    const dead: WorkCalendar = { id: 'd', name: 'Dead', workDays: [1], hoursPerDay: 8, holidays: all }
    expect(() => nextWorkDay('2026-01-01', dead)).toThrow(/no work day/)
  })
})

describe('usFederalHolidays', () => {
  it('returns observed 2026 dates', () => {
    expect(usFederalHolidays(2026)).toEqual([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03',
      '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
    ])
  })
  it('handles Saturday New Year observed in prior year', () => {
    expect(usFederalHolidays(2021)).toContain('2021-12-31')
    expect(usFederalHolidays(2022)).not.toContain('2022-01-01')
    expect(usFederalHolidays(2022)).toContain('2022-12-26') // Christmas on Sunday
    expect(usFederalHolidays(2020)).not.toContain('2020-06-19')
  })
})
