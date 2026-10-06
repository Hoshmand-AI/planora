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
  it('uses each activity calendar; lags on the predecessor calendar (P6 default)', () => {
    const r = runCpm(
      input(
        [act('A', 5), act('B', 2, { calendarId: '7d' }), act('C', 1), act('D', 1, { calendarId: '7d' }), act('E', 1)],
        [fs('A', 'B'), fs('B', 'C'), fs('A', 'D', 2), fs('A', 'E', 2)],
      ),
    )
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-07', earlyFinish: '2026-03-08' })
    expect(r.times.C.earlyStart).toBe('2026-03-09')
    // A is on the 5-day calendar, so the 2 lag days are Mon+Tue even though D works weekends
    expect(r.times.D.earlyStart).toBe('2026-03-11')
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

describe('runCpm: P6 constraint semantics (pilot findings)', () => {
  // A (10d, Mon 03/02-Fri 03/13) -> M finish milestone
  it('Finish On keeps logic in charge and shows the slip as negative float', () => {
    const r = runCpm(input([act('A', 10), act('M', 0, { constraint: { type: 'FO', date: '2026-03-11' } })], [fs('A', 'M')]))
    expect(r.times.M.earlyFinish).toBe('2026-03-13') // logic wins over the Finish On date
    expect(r.times.M.totalFloat).toBe(-2)
    expect(r.times.A.totalFloat).toBe(-2)
    expect(r.violations).toEqual([])
  })
  it('Start On keeps logic in charge for a task', () => {
    const r = runCpm(input([act('A', 10), act('B', 2, { constraint: { type: 'SO', date: '2026-03-12' } })], [fs('A', 'B')]))
    expect(r.times.B.earlyStart).toBe('2026-03-16')
    expect(r.times.B.totalFloat).toBe(-2)
  })
  it('a mandatory finish overrules logic: float 0 on itself, the overrun as negative float on predecessors, reported', () => {
    const r = runCpm(input([act('A', 10), act('M', 0, { constraint: { type: 'MFO', date: '2026-03-11' } })], [fs('A', 'M')]))
    expect(r.times.M).toMatchObject({ earlyFinish: '2026-03-11', lateFinish: '2026-03-11', totalFloat: 0 })
    expect(r.times.A.totalFloat).toBe(-2)
    expect(r.violations).toEqual([{ id: 'M', type: 'MFO', constraintDate: '2026-03-11', logicDate: '2026-03-13', days: 2 }])
    expect(r.logicFinish).toBe('2026-03-13')
    expect(r.logicLongestPath).toEqual(['A', 'M'])
    // A (finishing 03/13) is the scheduled finish; M's date comes from its constraint, not from A
    expect(r.longestPath).toEqual(['A'])
  })
})

describe('runCpm: out-of-sequence progress', () => {
  // A (10d) is half done; B started early (out of sequence) with 3d remaining. Data date Mon 03/09.
  const acts = [
    act('A', 10, { actualStart: '2026-03-02', remaining: 5 }),
    act('B', 6, { actualStart: '2026-03-04', remaining: 3 }),
    act('C', 1),
  ]
  const links = [fs('A', 'B'), fs('B', 'C')]
  it('retained logic (default) resumes the out-of-sequence work after its predecessor', () => {
    const r = runCpm(input(acts, links, { dataDate: '2026-03-09' }))
    expect(r.progressMode).toBe('retained')
    expect(r.times.A.earlyFinish).toBe('2026-03-13')
    expect(r.times.B.earlyFinish).toBe('2026-03-18')
    expect(r.times.C.earlyFinish).toBe('2026-03-19')
    expect(r.longestPath).toEqual(['A', 'B', 'C'])
  })
  it('progress override continues the remaining work from the data date', () => {
    const r = runCpm(input(acts, links, { dataDate: '2026-03-09', progressMode: 'override' }))
    expect(r.times.B.earlyFinish).toBe('2026-03-11')
    expect(r.times.C.earlyFinish).toBe('2026-03-12')
  })
})

describe('runCpm: longest path with a later required finish', () => {
  it('finds the driving path even when no activity has zero float', () => {
    const r = runCpm(input([act('A', 5), act('B', 3), act('C', 1)], [fs('A', 'B'), fs('A', 'C')], { mustFinishBy: '2026-04-30' }))
    expect(r.criticalPath).toEqual([])
    expect(r.longestPath).toEqual(['A', 'B'])
  })
})

describe('runCpm: P6 parity (scheduler pilot, round 2)', () => {
  // A: 5d Mon 03/02 - Fri 03/06
  it('a start milestone after a predecessor is at the start of the next work day; its FS successor starts the same day', () => {
    const r = runCpm(input([act('A', 5), act('M', 0, { milestoneKind: 'start' }), act('B', 2)], [fs('A', 'M'), fs('M', 'B')]))
    expect(r.times.M).toMatchObject({ earlyStart: '2026-03-09', earlyFinish: '2026-03-09', totalFloat: 0 })
    expect(r.times.B.earlyStart).toBe('2026-03-09')
    expect(r.longestPath).toEqual(['A', 'M', 'B'])
  })
  it('a start milestone with Start On or After and predecessors does not push its FS successor a day', () => {
    const r = runCpm(input(
      [act('A', 2), act('M', 0, { milestoneKind: 'start', constraint: { type: 'SNET', date: '2026-03-10' } }), act('B', 2)],
      [fs('A', 'M'), fs('M', 'B')],
    ))
    expect(r.times.M.earlyStart).toBe('2026-03-10')
    expect(r.times.B.earlyStart).toBe('2026-03-10')
  })
  it('a finish milestone keeps finish semantics (successor starts the next work day)', () => {
    const r = runCpm(input([act('A', 5), act('M', 0, { milestoneKind: 'finish' }), act('B', 2)], [fs('A', 'M'), fs('M', 'B')]))
    expect(r.times.M.earlyFinish).toBe('2026-03-06')
    expect(r.times.B.earlyStart).toBe('2026-03-09')
  })
  it('a finish milestone without predecessors (TT_FinMile) with SNET pushes its successor to the next day', () => {
    const r = runCpm(input([act('M', 0, { milestoneKind: 'finish', constraint: { type: 'SNET', date: '2026-03-10' } }), act('B', 2)], [fs('M', 'B')]))
    expect(r.times.M.earlyFinish).toBe('2026-03-10')
    expect(r.times.B.earlyStart).toBe('2026-03-11')
  })

  it('counts relationship lag on the predecessor calendar', () => {
    // P (7-day) finishes Sat 03/07; its 2 lag days are Sun 03/08 and Mon 03/09
    const r = runCpm(input([act('P', 6, { calendarId: '7d' }), act('S', 1)], [fs('P', 'S', 2)]))
    expect(r.times.P.earlyFinish).toBe('2026-03-07')
    expect(r.times.S.earlyStart).toBe('2026-03-10')
    // the backward pass uses the same calendar: P is critical, with no float
    expect(r.times.P.totalFloat).toBe(0)
    expect(r.times.P.freeFloat).toBe(0)
  })

  it('a past-dated mandatory finish measures negative float from the constraint date, not the data date', () => {
    const r = runCpm(input(
      [act('A', 2), act('B', 3, { constraint: { type: 'MFO', date: '2026-03-04' } })],
      [fs('A', 'B')],
      { dataDate: '2026-03-09' },
    ))
    expect(r.times.A).toMatchObject({ earlyStart: '2026-03-09', earlyFinish: '2026-03-10' })
    expect(r.times.B).toMatchObject({ earlyStart: '2026-03-09', earlyFinish: '2026-03-11', lateStart: '2026-03-02', lateFinish: '2026-03-04' })
    expect(r.times.B.totalFloat).toBe(-5) // finishes 03/11, 5 work days after 03/04
    expect(r.times.A.totalFloat).toBeLessThan(r.times.B.totalFloat)
    expect(r.warnings.join(' ')).toMatch(/before the data date/)
  })

  it('free float never exceeds total float', () => {
    // B finishes 03/13 but the required finish is 03/11: A (no successors) has 3 days of total float
    const r = runCpm(input([act('A', 5), act('B', 10)], [], { mustFinishBy: '2026-03-11' }))
    expect(r.times.A.totalFloat).toBe(3)
    expect(r.times.A.freeFloat).toBe(3)
    // a successor with negative float (SNLT) caps its predecessor's free float at 0
    const r2 = runCpm(input([act('A', 2), act('B', 2, { constraint: { type: 'SNLT', date: '2026-03-03' } }), act('C', 10)], [fs('A', 'B')]))
    expect(r2.times.A.totalFloat).toBeLessThan(0)
    expect(r2.times.A.freeFloat).toBe(0)
  })

  it('a Mandatory Start on a Saturday stays on Saturday on a 7-day calendar', () => {
    const r = runCpm(input(
      [act('A', 3), act('B', 2, { calendarId: '7d', constraint: { type: 'MSO', date: '2026-03-07' } }),
        act('S', 0, { calendarId: '7d', milestoneKind: 'start', constraint: { type: 'MSO', date: '2026-03-07' } }),
        act('F', 0, { calendarId: '7d', milestoneKind: 'finish', constraint: { type: 'MSO', date: '2026-03-07' } })],
      [fs('A', 'B'), fs('A', 'S'), fs('A', 'F')],
    ))
    for (const id of ['B', 'S', 'F']) {
      expect(r.times[id]).toMatchObject({ earlyStart: '2026-03-07', lateStart: '2026-03-07', totalFloat: 0 })
    }
  })

  it('a Mandatory Start that drives the finish ends the longest path, and is reported', () => {
    // A -> B (MSO 03/16, later than logic) -> C; D (8d) alone would be the logic-driven finish
    const r = runCpm(input(
      [act('A', 3), act('B', 2, { constraint: { type: 'MSO', date: '2026-03-16' } }), act('C', 2), act('D', 8)],
      [fs('A', 'B'), fs('B', 'C')],
    ))
    expect(r.projectFinish).toBe('2026-03-19')
    expect(r.longestPath).toEqual(['B', 'C'])
    expect(r.longestPathConstraint).toEqual({ id: 'B', type: 'MSO', date: '2026-03-16' })
    expect(r.logicFinish).toBe('2026-03-11')
    expect(r.logicLongestPath).toEqual(['D'])
    expect(r.times.A.totalFloat).toBeGreaterThan(0)
  })

  it('date and float invariants hold on a large mixed network', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const acts: CpmActivity[] = []
    const types = ['SNET', 'SNLT', 'FNET', 'FNLT', 'SO', 'FO', 'MSO', 'MFO'] as const
    for (let i = 0; i < 400; i++) {
      const ms = rand() < 0.1
      const extra: Partial<CpmActivity> = { calendarId: i % 3 === 0 ? '7d' : undefined }
      if (ms) extra.milestoneKind = rand() < 0.5 ? 'start' : 'finish'
      if (rand() < 0.08) extra.constraint = { type: types[Math.floor(rand() * types.length)], date: `2026-0${3 + Math.floor(rand() * 4)}-1${Math.floor(rand() * 9)}` }
      acts.push(act(`A${i}`, ms ? 0 : 1 + Math.floor(rand() * 15), extra))
    }
    const links: CpmLink[] = []
    const lt = ['FS', 'SS', 'FF', 'SF'] as const
    for (let i = 0; i < 800; i++) {
      const to = 1 + Math.floor(rand() * 399)
      const from = Math.max(0, to - 1 - Math.floor(rand() * 20))
      links.push({ from: `A${from}`, to: `A${to}`, type: lt[Math.floor(rand() * 4)], lag: Math.floor(rand() * 4) - 1 })
    }
    for (const mustFinishBy of [undefined, '2026-05-01']) {
      const r = runCpm(input(acts, links, { mustFinishBy }))
      for (const a of acts) {
        const t = r.times[a.id]
        expect(t.freeFloat).toBeLessThanOrEqual(Math.max(0, t.totalFloat))
        if (t.totalFloat >= 0) {
          expect(t.lateStart >= t.earlyStart, `${a.id} LS ${t.lateStart} < ES ${t.earlyStart} with TF ${t.totalFloat}`).toBe(true)
          expect(t.lateFinish >= t.earlyFinish, `${a.id} LF < EF with TF ${t.totalFloat}`).toBe(true)
        }
      }
    }
  })
})
