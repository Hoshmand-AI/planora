import { describe, it, expect } from 'vitest'
import type { AnalyzableActivity, AnalyzableSchedule, CpmLink, WorkCalendar } from '@/lib/planning/types'
import { checkInputs, MAX_PER_RULE } from '@/lib/analysis/input-checks'

const cal5: WorkCalendar = { id: 'c5', name: '5-Day', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: ['2026-07-03'] }

function act(code: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity {
  return { id: code, code, name: `Activity ${code}`, type: 'task', duration: 5, calendarId: 'c5', ...extra }
}
function sched(activities: AnalyzableActivity[], links: CpmLink[] = [], extra: Partial<AnalyzableSchedule> = {}): AnalyzableSchedule {
  return { activities, links, calendars: [cal5], defaultCalendarId: 'c5', dataDate: '2026-03-02', ...extra }
}
const rules = (qs: ReturnType<typeof checkInputs>) => qs.map((q) => q.rule)

describe('checkInputs', () => {
  it('asks about weekend work (the canonical example)', () => {
    const qs = checkInputs(sched([act('A1040', { name: 'Pour Level 2 Deck', earlyStart: '2026-03-14', earlyFinish: '2026-03-16', duration: 1 })]))
    const q = qs.find((x) => x.rule === 'weekend_work')!
    expect(q.question).toBe(
      "Calendar '5-Day' is a 5-day week, but activity A1040 'Pour Level 2 Deck' is scheduled to start on Saturday 2026-03-14 — is weekend work intentional?",
    )
    expect(q.id).toBe('weekend_work:A1040')
    expect(q.severity).toBe('warning')
    expect(q.activityCodes).toEqual(['A1040'])
  })

  it('groups weekend findings per activity and uses actual dates', () => {
    const qs = checkInputs(sched([act('A1', { actualStart: '2026-02-28', actualFinish: '2026-03-01', earlyStart: '2026-02-28', earlyFinish: '2026-03-01' })], [], { dataDate: '2026-03-02' }))
    const w = qs.filter((q) => q.rule === 'weekend_work')
    expect(w).toHaveLength(1)
    expect(w[0].question).toMatch(/actually started on Saturday 2026-02-28/)
  })

  it('caps individual questions per rule and adds a summary', () => {
    const acts = Array.from({ length: MAX_PER_RULE + 5 }, (_, i) => act(`W${i}`, { earlyStart: '2026-03-07', earlyFinish: '2026-03-13' }))
    const qs = checkInputs(sched(acts)).filter((q) => q.rule === 'weekend_work')
    expect(qs).toHaveLength(MAX_PER_RULE + 1)
    const more = qs.find((q) => q.id === 'weekend_work:_more')!
    expect(more.activityCodes).toHaveLength(5)
    expect(more.question).toMatch(/^5 more/)
  })

  it('asks about holiday work separately', () => {
    const qs = checkInputs(sched([act('H1', { earlyStart: '2026-07-03', earlyFinish: '2026-07-09' })], [], { dataDate: '2026-06-01' }))
    expect(rules(qs)).toContain('holiday_work')
    expect(rules(qs)).not.toContain('weekend_work')
    expect(qs.find((q) => q.rule === 'holiday_work')!.question).toMatch(/Friday 2026-07-03, which is a holiday on calendar '5-Day'/)
  })

  it('finish_before_start', () => {
    const qs = checkInputs(sched([act('F1', { earlyStart: '2026-03-10', earlyFinish: '2026-03-05' })]))
    const q = qs.find((x) => x.rule === 'finish_before_start')!
    expect(q.severity).toBe('error')
    expect(q.id).toBe('finish_before_start:F1')
  })

  it('actual_after_data_date and forecast_before_data_date', () => {
    const qs = checkInputs(
      sched([
        act('X1', { actualStart: '2026-03-05', earlyStart: '2026-03-05', earlyFinish: '2026-03-11' }),
        act('X2', { earlyStart: '2026-02-23', earlyFinish: '2026-02-27' }),
        act('X3', { earlyStart: '2026-02-23', earlyFinish: '2026-02-27', actualStart: '2026-02-23', actualFinish: '2026-02-27' }),
      ]),
    )
    expect(qs.find((q) => q.id === 'actual_after_data_date:X1')).toBeDefined()
    expect(qs.find((q) => q.id === 'forecast_before_data_date:X2')).toBeDefined()
    expect(qs.find((q) => q.id === 'forecast_before_data_date:X3')).toBeUndefined()
  })

  it('progress_without_actual_start and complete_without_actual_finish', () => {
    const qs = checkInputs(
      sched([
        act('P1', { percentComplete: 30 }),
        act('P2', { status: 'in_progress' }),
        act('P3', { status: 'complete', actualStart: '2026-02-02' }),
      ]),
    )
    expect(qs.filter((q) => q.rule === 'progress_without_actual_start').map((q) => q.activityCodes[0])).toEqual(['P1', 'P2'])
    expect(qs.find((q) => q.id === 'complete_without_actual_finish:P3')!.question).toMatch(/when did it finish\?/)
  })

  it('zero_duration_task and milestone_with_duration', () => {
    const qs = checkInputs(sched([act('Z1', { duration: 0 }), act('M1', { type: 'milestone', duration: 3 })]))
    expect(qs.find((q) => q.id === 'zero_duration_task:Z1')!.question).toMatch(/should it be a milestone\?/)
    expect(qs.find((q) => q.id === 'milestone_with_duration:M1')).toBeDefined()
  })

  it('dangling_link', () => {
    const qs = checkInputs(sched([act('A')], [{ from: 'A', to: 'GHOST', type: 'FS', lag: 0 }]))
    const q = qs.find((x) => x.rule === 'dangling_link')!
    expect(q.id).toBe('dangling_link:A->GHOST')
    expect(q.severity).toBe('error')
    expect(q.question).toMatch(/GHOST/)
  })

  it('duration_mismatch beyond one day', () => {
    const qs = checkInputs(
      sched([
        act('D1', { duration: 5, earlyStart: '2026-03-02', earlyFinish: '2026-03-13' }), // 10 wd
        act('D2', { duration: 5, earlyStart: '2026-03-02', earlyFinish: '2026-03-09' }), // 6 wd, within tolerance
      ]),
    )
    expect(qs.filter((q) => q.rule === 'duration_mismatch').map((q) => q.activityCodes[0])).toEqual(['D1'])
  })

  it('out_of_sequence', () => {
    const qs = checkInputs(
      sched([act('A', { actualStart: '2026-02-16' }), act('B', { actualStart: '2026-02-23' })], [{ from: 'A', to: 'B', type: 'FS', lag: 0 }]),
    )
    const q = qs.find((x) => x.rule === 'out_of_sequence')!
    expect(q.id).toBe('out_of_sequence:B')
    expect(q.activityCodes).toEqual(['B', 'A'])
  })

  it('out_of_sequence on SS / FF lag links and historical FS', () => {
    const oos = (acts: AnalyzableActivity[], links: CpmLink[]) => checkInputs(sched(acts, links)).filter((x) => x.rule === 'out_of_sequence')
    // Historical FS: both actuals recorded, the successor started before the predecessor finished.
    const fs = oos([act('A', { actualStart: '2026-02-02', actualFinish: '2026-02-13', status: 'complete' }), act('B', { actualStart: '2026-02-10', actualFinish: '2026-02-20', status: 'complete' })], [{ from: 'A', to: 'B', type: 'FS', lag: 0 }])
    expect(fs.map((q) => q.activityCodes)).toEqual([['B', 'A']])
    expect(fs[0].question).toMatch(/started 2026-02-10, before its finish-to-start predecessor A 'Activity A' allowed it \(finished 2026-02-13\)/)
    // In sequence: FS successor starting the next work day is fine.
    expect(oos([act('A', { actualStart: '2026-02-02', actualFinish: '2026-02-13' }), act('B', { actualStart: '2026-02-16' })], [{ from: 'A', to: 'B', type: 'FS', lag: 0 }])).toEqual([])
    // SS lag 5: successor started 2 work days after the predecessor.
    const ss = oos([act('A', { actualStart: '2026-02-02' }), act('B', { actualStart: '2026-02-04' })], [{ from: 'A', to: 'B', type: 'SS', lag: 5 }])
    expect(ss[0].question).toMatch(/earlier than its start-to-start predecessor A 'Activity A' allows \(started 2026-02-02 \+ 5 wd lag\)/)
    expect(oos([act('A', { actualStart: '2026-02-02' }), act('B', { actualStart: '2026-02-09' })], [{ from: 'A', to: 'B', type: 'SS', lag: 5 }])).toEqual([])
    // SS: successor started, predecessor not.
    expect(oos([act('A'), act('B', { actualStart: '2026-02-04' })], [{ from: 'A', to: 'B', type: 'SS', lag: 0 }])).toHaveLength(1)
    // FF lag 2: successor finished before the predecessor (+ lag); and successor finished, predecessor open.
    expect(oos([act('A', { actualStart: '2026-02-02', actualFinish: '2026-02-13' }), act('B', { actualStart: '2026-02-02', actualFinish: '2026-02-16' })], [{ from: 'A', to: 'B', type: 'FF', lag: 2 }])[0].question).toMatch(/finished 2026-02-16, earlier than its finish-to-finish predecessor/)
    expect(oos([act('A', { actualStart: '2026-02-02' }), act('B', { actualStart: '2026-02-02', actualFinish: '2026-02-16' })], [{ from: 'A', to: 'B', type: 'FF', lag: 0 }])[0].question).toMatch(/has finished \(2026-02-16\) although its finish-to-finish predecessor/)
    expect(oos([act('A', { actualStart: '2026-02-02', actualFinish: '2026-02-13' }), act('B', { actualStart: '2026-02-02', actualFinish: '2026-02-17' })], [{ from: 'A', to: 'B', type: 'FF', lag: 2 }])).toEqual([])
  })

  it('long_duration is info', () => {
    const qs = checkInputs(sched([act('L1', { duration: 60 })]))
    const q = qs.find((x) => x.rule === 'long_duration')!
    expect(q.severity).toBe('info')
  })

  it('calendar_mismatch_hours', () => {
    const odd: WorkCalendar = { id: 'c7', name: 'Odd', workDays: [1, 2, 3, 4, 5], hoursPerDay: 7.5, holidays: [] }
    const qs = checkInputs(sched([act('A')], [], { calendars: [cal5, odd] }))
    const q = qs.find((x) => x.rule === 'calendar_mismatch_hours')!
    expect(q.id).toBe('calendar_mismatch_hours:c7')
    expect(q.severity).toBe('info')
  })

  it('duplicate_names only at 3 or more', () => {
    const qs = checkInputs(
      sched([
        act('N1', { name: 'Install Drywall' }),
        act('N2', { name: 'Install Drywall' }),
        act('N3', { name: 'install drywall ' }),
        act('N4', { name: 'Tape' }),
        act('N5', { name: 'Tape' }),
      ]),
    )
    const d = qs.filter((q) => q.rule === 'duplicate_names')
    expect(d).toHaveLength(1)
    expect(d[0].activityCodes).toEqual(['N1', 'N2', 'N3'])
  })

  it('sorts errors first and returns nothing for a clean schedule', () => {
    const qs = checkInputs(
      sched([act('L1', { duration: 60 }), act('W', { earlyStart: '2026-03-07', earlyFinish: '2026-03-13' }), act('F', { earlyStart: '2026-03-10', earlyFinish: '2026-03-05' })]),
    )
    const sev = qs.map((q) => q.severity)
    expect(sev.indexOf('error')).toBe(0)
    expect(sev.lastIndexOf('error')).toBeLessThan(sev.indexOf('warning'))
    expect(sev.lastIndexOf('warning')).toBeLessThan(sev.indexOf('info'))

    const clean = checkInputs(sched([act('A', { earlyStart: '2026-03-02', earlyFinish: '2026-03-06' })]))
    expect(clean).toEqual([])
  })

  it('ids are unique', () => {
    const qs = checkInputs(
      sched([act('A', { actualStart: '2026-02-16' }), act('B', { actualStart: '2026-02-23' }), act('C')], [
        { from: 'A', to: 'B', type: 'FS', lag: 0 },
        { from: 'C', to: 'B', type: 'FS', lag: 0 },
      ]),
    )
    const ids = qs.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
