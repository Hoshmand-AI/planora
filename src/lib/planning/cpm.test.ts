import { describe, it, expect } from 'vitest'
import type { CpmActivity, CpmInput, CpmLink, WorkCalendar } from '@/lib/planning/types'
import { runCpm } from '@/lib/planning/cpm'
import { defaultCalendar } from '@/lib/planning/calendar'

// 2026-03-02 is a Monday.
const START = '2026-03-02'
const cal5 = defaultCalendar()
const cal7: WorkCalendar = { id: '7d', name: '7-Day', workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: 10, holidays: [] }

function act(id: string, duration: number, extra: Partial<CpmActivity> = {}): CpmActivity {
  return { id, code: id, name: `Activity ${id}`, duration, type: duration === 0 ? 'milestone' : 'task', ...extra }
}
function fs(from: string, to: string, lag = 0): CpmLink {
  return { from, to, type: 'FS', lag }
}
function input(activities: CpmActivity[], links: CpmLink[], extra: Partial<CpmInput> = {}): CpmInput {
  return { projectStart: START, activities, links, calendars: [cal5, cal7], defaultCalendarId: 'default-5d', ...extra }
}

describe('runCpm: simple chain', () => {
  const r = runCpm(input([act('A', 5), act('B', 3), act('C', 2), act('D', 2)], [fs('A', 'B'), fs('B', 'C'), fs('A', 'D'), fs('D', 'C')]))
  it('computes early dates', () => {
    expect(r.times.A).toMatchObject({ earlyStart: '2026-03-02', earlyFinish: '2026-03-06' })
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-09', earlyFinish: '2026-03-11' })
    expect(r.times.C).toMatchObject({ earlyStart: '2026-03-12', earlyFinish: '2026-03-13' })
    expect(r.projectFinish).toBe('2026-03-13')
  })
  it('computes late dates and float', () => {
    expect(r.times.A).toMatchObject({ lateStart: '2026-03-02', lateFinish: '2026-03-06', totalFloat: 0, critical: true })
    expect(r.times.D).toMatchObject({ earlyStart: '2026-03-09', earlyFinish: '2026-03-10', lateStart: '2026-03-10', lateFinish: '2026-03-11' })
    expect(r.times.D.totalFloat).toBe(1)
    expect(r.times.D.freeFloat).toBe(1)
    expect(r.times.D.critical).toBe(false)
    expect(r.times.C.freeFloat).toBe(0)
  })
  it('returns the critical path in order', () => {
    expect(r.criticalPath).toEqual(['A', 'B', 'C'])
    expect(r.cycles).toEqual([])
    expect(r.warnings).toEqual([])
  })
})

describe('runCpm: milestones', () => {
  it('start milestone at project start, finish milestone on last work day', () => {
    const r = runCpm(input([act('S', 0), act('A', 5), act('M', 0), act('B', 1)], [fs('S', 'A'), fs('A', 'M'), fs('M', 'B')]))
    expect(r.times.S.earlyStart).toBe('2026-03-02')
    expect(r.times.A.earlyStart).toBe('2026-03-02')
    expect(r.times.M).toMatchObject({ earlyStart: '2026-03-06', earlyFinish: '2026-03-06', totalFloat: 0 })
    expect(r.times.B.earlyStart).toBe('2026-03-09')
    expect(r.criticalPath).toEqual(['S', 'A', 'M', 'B'])
  })
})

describe('runCpm: relationship types and lags', () => {
  it('FS with positive and negative lag', () => {
    const r = runCpm(input([act('A', 5), act('B', 2), act('C', 2)], [fs('A', 'B', 2), fs('A', 'C', -2)]))
    expect(r.times.B.earlyStart).toBe('2026-03-11')
    expect(r.times.C.earlyStart).toBe('2026-03-05')
  })
  it('SS with lag', () => {
    const r = runCpm(input([act('A', 5), act('B', 3)], [{ from: 'A', to: 'B', type: 'SS', lag: 2 }]))
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-04', earlyFinish: '2026-03-06' })
    expect(r.times.B.totalFloat).toBe(0)
  })
  it('FF with lag', () => {
    const r = runCpm(input([act('A', 5), act('B', 3)], [{ from: 'A', to: 'B', type: 'FF', lag: 1 }]))
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-05', earlyFinish: '2026-03-09' })
    expect(r.projectFinish).toBe('2026-03-09')
    expect(r.times.A.totalFloat).toBe(0)
    expect(r.criticalPath).toEqual(['A', 'B'])
  })
  it('SF with lag', () => {
    const r = runCpm(input([act('A', 5), act('B', 2)], [{ from: 'A', to: 'B', type: 'SF', lag: 3 }]))
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-03', earlyFinish: '2026-03-04' })
  })
  it('SS with negative lag cannot start before project start', () => {
    const r = runCpm(input([act('A', 5), act('B', 3)], [{ from: 'A', to: 'B', type: 'SS', lag: -3 }]))
    expect(r.times.B.earlyStart).toBe('2026-03-02')
  })
})

describe('runCpm: multi-calendar', () => {
  it('uses each activity calendar; lags on the successor calendar', () => {
    const r = runCpm(
      input(
        [act('A', 5), act('B', 2, { calendarId: '7d' }), act('C', 1), act('D', 1, { calendarId: '7d' }), act('E', 1)],
        [fs('A', 'B'), fs('B', 'C'), fs('A', 'D', 2), fs('A', 'E', 2)],
      ),
    )
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-07', earlyFinish: '2026-03-08' })
    expect(r.times.C.earlyStart).toBe('2026-03-09')
    expect(r.times.D.earlyStart).toBe('2026-03-09') // Sat+Sun are the 2 lag days on 7d
    expect(r.times.E.earlyStart).toBe('2026-03-11') // Mon+Tue lag days on 5d
  })
  it('float on a 7-day calendar counts weekend days', () => {
    const r = runCpm(input([act('A', 10), act('B', 1, { calendarId: '7d' }), act('Z', 0)], [fs('B', 'Z'), fs('A', 'Z')]))
    // A: 3/2-3/13, Z finishes 3/13. B on 7d: 3/2, late 3/13 -> 11 calendar days of float
    expect(r.times.B.totalFloat).toBe(11)
  })
  it('falls back for unknown calendars with a warning', () => {
    const r = runCpm(input([act('A', 2, { calendarId: 'nope' })], []))
    expect(r.times.A.earlyFinish).toBe('2026-03-03')
    expect(r.warnings.join(' ')).toMatch(/nope/)
  })
  it('treats a calendar with no work days as 7-day and warns', () => {
    const empty: WorkCalendar = { id: 'e', name: 'Empty', workDays: [], hoursPerDay: 8, holidays: [] }
    const r = runCpm({ ...input([act('A', 7, { calendarId: 'e' })], []), calendars: [cal5, empty] })
    expect(r.times.A.earlyFinish).toBe('2026-03-08')
    expect(r.warnings.join(' ')).toMatch(/7-day/)
  })
  it('respects holidays', () => {
    const hol: WorkCalendar = { ...cal5, id: 'h', holidays: ['2026-03-04'] }
    const r = runCpm({ ...input([act('A', 5, { calendarId: 'h' })], []), calendars: [hol] })
    expect(r.times.A.earlyFinish).toBe('2026-03-09')
  })
})

describe('runCpm: constraints', () => {
  it('SNET and FNET push early dates', () => {
    const r = runCpm(
      input(
        [act('A', 2, { constraint: { type: 'SNET', date: '2026-03-10' } }), act('B', 2, { constraint: { type: 'FNET', date: '2026-03-13' } })],
        [],
      ),
    )
    expect(r.times.A.earlyStart).toBe('2026-03-10')
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-12', earlyFinish: '2026-03-13' })
  })
  it('MSO fixes dates regardless of logic', () => {
    const r = runCpm(input([act('A', 5), act('B', 2, { constraint: { type: 'MSO', date: '2026-03-04' } }), act('C', 10)], [fs('A', 'B')]))
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-04', lateStart: '2026-03-04' })
  })
  it('MFO fixes the finish', () => {
    const r = runCpm(input([act('A', 3, { constraint: { type: 'MFO', date: '2026-03-13' } }), act('B', 20)], []))
    expect(r.times.A).toMatchObject({ earlyStart: '2026-03-11', earlyFinish: '2026-03-13', lateFinish: '2026-03-13', totalFloat: 0 })
  })
  it('SNLT / FNLT cap late dates and produce negative float', () => {
    const r = runCpm(
      input([act('A', 5), act('B', 3, { constraint: { type: 'SNLT', date: '2026-03-05' } }), act('C', 3, { constraint: { type: 'FNLT', date: '2026-03-10' } })], [fs('A', 'B'), fs('A', 'C')]),
    )
    expect(r.times.B.lateStart).toBe('2026-03-05')
    expect(r.times.B.totalFloat).toBe(-2)
    expect(r.times.C.lateFinish).toBe('2026-03-10')
    expect(r.times.C.totalFloat).toBe(-1)
    expect(r.times.A.totalFloat).toBe(-2)
    expect(r.times.A.critical).toBe(true)
  })
})

describe('runCpm: progress and data date', () => {
  const r = runCpm(
    input(
      [
        act('A', 5, { actualStart: '2026-03-02', actualFinish: '2026-03-06' }),
        act('B', 5, { actualStart: '2026-03-05', remaining: 3 }),
        act('C', 2),
        act('D', 1),
      ],
      [fs('A', 'B'), fs('B', 'C')],
      { dataDate: '2026-03-09' },
    ),
  )
  it('completed activities use actuals, float 0, not critical', () => {
    expect(r.times.A).toMatchObject({ earlyStart: '2026-03-02', earlyFinish: '2026-03-06', totalFloat: 0, critical: false })
  })
  it('in-progress remaining work starts at the data date', () => {
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-05', earlyFinish: '2026-03-11', critical: true })
    expect(r.times.C).toMatchObject({ earlyStart: '2026-03-12', earlyFinish: '2026-03-13' })
  })
  it('nothing incomplete starts before the data date', () => {
    expect(r.times.D.earlyStart).toBe('2026-03-09')
    expect(r.criticalPath).toEqual(['B', 'C'])
  })
})

describe('runCpm: mustFinishBy', () => {
  it('produces negative float along the path', () => {
    const r = runCpm(input([act('A', 5), act('B', 3), act('C', 2)], [fs('A', 'B'), fs('B', 'C')], { mustFinishBy: '2026-03-11' }))
    expect(r.projectFinish).toBe('2026-03-13')
    for (const id of ['A', 'B', 'C']) expect(r.times[id].totalFloat).toBe(-2)
    expect(r.times.C.lateFinish).toBe('2026-03-11')
    expect(r.criticalPath).toEqual(['A', 'B', 'C'])
  })
  it('positive float when the deadline is later', () => {
    const r = runCpm(input([act('A', 5)], [], { mustFinishBy: '2026-03-13' }))
    expect(r.times.A.totalFloat).toBe(5)
    expect(r.times.A.critical).toBe(false)
  })
})

describe('runCpm: critical path with branches', () => {
  it('follows the driving predecessor', () => {
    const r = runCpm(input([act('A', 2), act('B', 10), act('C', 3), act('D', 1)], [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')]))
    expect(r.criticalPath).toEqual(['A', 'B', 'D'])
    expect(r.times.C.totalFloat).toBe(7)
  })
})

describe('runCpm: bad data', () => {
  it('detects cycles and still returns times', () => {
    const r = runCpm(input([act('A', 1), act('B', 1), act('C', 1), act('D', 1)], [fs('A', 'B'), fs('B', 'C'), fs('C', 'A'), fs('C', 'D')]))
    expect(r.cycles).toHaveLength(1)
    expect([...r.cycles[0]].sort()).toEqual(['A', 'B', 'C'])
    expect(Object.keys(r.times).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(r.warnings.join(' ')).toMatch(/loop/)
    expect(r.times.D.earlyStart).toBeDefined()
  })
  it('detects self loops', () => {
    const r = runCpm(input([act('A', 1)], [fs('A', 'A')]))
    expect(r.cycles).toEqual([['A']])
    expect(r.times.A.earlyStart).toBe('2026-03-02')
  })
  it('ignores links to unknown ids with a warning', () => {
    const r = runCpm(input([act('A', 1)], [fs('A', 'ZZZ')]))
    expect(r.warnings.join(' ')).toMatch(/unknown/)
    expect(r.times.A.earlyFinish).toBe('2026-03-02')
  })
  it('handles an empty schedule', () => {
    const r = runCpm(input([], []))
    expect(r.projectFinish).toBe(START)
    expect(r.criticalPath).toEqual([])
  })
})

describe('runCpm: performance', () => {
  it('2,000 activities / 4,000 links well under a second', () => {
    let seed = 42
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const acts: CpmActivity[] = []
    for (let i = 0; i < 2000; i++) acts.push(act(`A${i}`, 1 + Math.floor(rand() * 20), i % 3 === 0 ? { calendarId: '7d' } : {}))
    const links: CpmLink[] = []
    const types = ['FS', 'SS', 'FF', 'SF'] as const
    for (let i = 0; i < 4000; i++) {
      const to = 1 + Math.floor(rand() * 1999)
      const from = Math.max(0, to - 1 - Math.floor(rand() * 30))
      links.push({ from: `A${from}`, to: `A${to}`, type: types[Math.floor(rand() * 4)], lag: Math.floor(rand() * 5) - 1 })
    }
    const t0 = performance.now()
    const r = runCpm(input(acts, links))
    const ms = performance.now() - t0
    expect(Object.keys(r.times)).toHaveLength(2000)
    expect(r.cycles).toEqual([])
    expect(r.criticalPath.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(1000)
    // sanity: every FS relationship is honoured
    for (const l of links) {
      if (l.type !== 'FS' || l.lag !== 0) continue
      expect(r.times[l.to].earlyStart > r.times[l.from].earlyFinish).toBe(true)
    }
  })
})

describe('constrained milestones', () => {
  it('shows a finish milestone with SNET on the constraint date, and successors start after it', () => {
    const r = runCpm(input(
      [act('A', 0, { type: 'milestone' }), act('D', 0, { type: 'milestone', constraint: { type: 'SNET', date: '2026-11-02' } }), act('I', 5)],
      [fs('A', 'D'), fs('D', 'I')],
    ))
    expect(r.times.D.earlyStart).toBe('2026-11-02')
    expect(r.times.I.earlyStart).toBe('2026-11-03')
  })
})
