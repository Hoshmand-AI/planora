import { describe, it, expect } from 'vitest'
import type { AnalyzableActivity, AnalyzableSchedule, CpmLink } from '@/lib/planning/types'
import { runDcma, normalizeConstraintType, scheduleToCpmInput } from '@/lib/analysis/dcma'
import { defaultCalendar } from '@/lib/planning/calendar'

const cal = defaultCalendar()

function task(id: string, duration = 5, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity {
  return { id, code: id, name: `Task ${id}`, type: 'task', duration, resourceCount: 1, ...extra }
}
function ms(id: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity {
  return { id, code: id, name: `Milestone ${id}`, type: 'milestone', duration: 0, ...extra }
}
const fs = (from: string, to: string, lag = 0): CpmLink => ({ from, to, type: 'FS', lag })

/** A clean 20-task chain with one completed task, baselines and resources. */
function goodSchedule(): AnalyzableSchedule {
  const acts: AnalyzableActivity[] = [ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02', baselineFinish: '2026-03-02' })]
  const links: CpmLink[] = []
  let prev = 'S'
  for (let i = 1; i <= 20; i++) {
    const id = `A${i}`
    acts.push(
      task(id, 5, i === 1
        ? { actualStart: '2026-03-02', actualFinish: '2026-03-06', baselineFinish: '2026-03-06', status: 'complete' }
        : { baselineFinish: '2026-12-31' }),
    )
    links.push(fs(prev, id))
    prev = id
  }
  acts.push(ms('F', { baselineFinish: '2026-12-31' }))
  links.push(fs(prev, 'F'))
  return { projectStart: '2026-03-02', dataDate: '2026-03-09', activities: acts, links, calendars: [cal], defaultCalendarId: cal.id }
}

const check = (r: ReturnType<typeof runDcma>, id: number) => r.checks.find((c) => c.id === id)!

describe('runDcma: clean schedule', () => {
  const r = runDcma(goodSchedule())
  it('passes all 14 checks', () => {
    expect(r.checks).toHaveLength(14)
    for (const c of r.checks) expect({ id: c.id, result: c.result }).toEqual({ id: c.id, result: 'pass' })
    expect(r.applicable).toBe(14)
    expect(r.passed).toBe(14)
    expect(r.score).toBe(100)
  })
  it('fills metric, threshold and explanation', () => {
    for (const c of r.checks) {
      expect(c.metric).not.toBe('')
      expect(c.threshold).not.toBe('')
      expect(c.explanation.length).toBeGreaterThan(20)
    }
    expect(check(r, 13).metric).toBe('1.00')
    expect(check(r, 14).metric).toBe('1.00')
    expect(check(r, 12).metric).toMatch(/\+600d/)
  })
})

describe('runDcma: failing checks', () => {
  it('1 Logic: open ends', () => {
    const s = goodSchedule()
    for (let i = 0; i < 3; i++) s.activities.push(task(`X${i}`))
    const r = runDcma(s)
    expect(check(r, 1).result).toBe('fail')
    expect(check(r, 1).offenders).toEqual(['X0', 'X1', 'X2'])
  })
  it('1 Logic: exempts exactly one start and one finish', () => {
    const s = goodSchedule()
    s.activities.push(task('Y'))
    s.links.push(fs('A5', 'Y'))
    const r = runDcma(s)
    expect(check(r, 1).offenders).toContain('Y') // Y has no successor; F is the exempt finish
  })
  it('2 Leads', () => {
    const s = goodSchedule()
    s.links[5] = fs(s.links[5].from, s.links[5].to, -2)
    const r = runDcma(s)
    expect(check(r, 2).result).toBe('fail')
    expect(check(r, 2).metric).toBe('1')
    expect(check(r, 2).offenders).toEqual([s.links[5].to])
  })
  it('3 Lags', () => {
    const s = goodSchedule()
    s.links[4] = fs(s.links[4].from, s.links[4].to, 3)
    s.links[6] = fs(s.links[6].from, s.links[6].to, 3)
    const r = runDcma(s)
    expect(check(r, 3).result).toBe('fail')
    expect(check(r, 3).metric).toBe('10.0%')
  })
  it('4 Relationship types', () => {
    const s = goodSchedule()
    for (let i = 2; i < 6; i++) s.links[i] = { ...s.links[i], type: 'SS' }
    const r = runDcma(s)
    expect(check(r, 4).result).toBe('fail')
    expect(check(r, 4).metric).toBe('80.0% FS')
  })
  it('5 Hard constraints (soft ones do not count)', () => {
    const s = goodSchedule()
    s.activities[5].constraint = { type: 'MSO', date: '2026-04-01' }
    s.activities[6].constraint = { type: 'CS_MEOB', date: '2026-05-01' }
    s.activities[7].constraint = { type: 'SNET', date: '2026-04-01' }
    const r = runDcma(s)
    expect(check(r, 5).result).toBe('fail')
    expect(check(r, 5).offenders).toEqual(['A5', 'A6'])
  })
  it('6/7 High and negative float from stored values', () => {
    const s = goodSchedule()
    s.activities.forEach((a) => (a.totalFloat = 0))
    s.activities[3].totalFloat = 50
    s.activities[4].totalFloat = 60
    s.activities[8].totalFloat = -4
    const r = runDcma(s)
    expect(check(r, 6).result).toBe('fail')
    expect(check(r, 6).offenders).toEqual(['A3', 'A4'])
    expect(check(r, 7).result).toBe('fail')
    expect(check(r, 7).offenders).toEqual(['A8'])
  })
  it('6 High float computed via CPM when no float is stored', () => {
    const s = goodSchedule()
    for (let i = 0; i < 3; i++) {
      s.activities.push(task(`P${i}`, 1))
      s.links.push(fs('A2', `P${i}`), fs(`P${i}`, 'F'))
    }
    const r = runDcma(s)
    expect(check(r, 6).result).toBe('fail')
    expect(check(r, 6).offenders).toEqual(['P0', 'P1', 'P2'])
  })
  it('8 High duration', () => {
    const s = goodSchedule()
    s.activities[3].duration = 60
    s.activities[4].duration = 30
    s.activities[4].remaining = 50
    const r = runDcma(s)
    expect(check(r, 8).result).toBe('fail')
    expect(check(r, 8).offenders).toEqual(['A3', 'A4'])
  })
  it('9 Invalid dates', () => {
    const s = goodSchedule()
    s.activities[3].earlyStart = '2026-03-05'
    s.activities[3].earlyFinish = '2026-03-11'
    s.activities[4].actualStart = '2026-03-12'
    s.activities[5].earlyStart = '2026-03-09'
    const r = runDcma(s)
    expect(check(r, 9).result).toBe('fail')
    expect(check(r, 9).offenders).toEqual(['A3', 'A4'])
  })
  it('10 Resources', () => {
    const s = goodSchedule()
    s.activities[3].resourceCount = 0
    const r = runDcma(s)
    expect(check(r, 10).result).toBe('fail')
    expect(check(r, 10).offenders).toEqual(['A3'])
  })
  it('11 Missed tasks and 14 BEI', () => {
    const s = goodSchedule()
    s.activities[2].baselineFinish = '2026-03-06'
    s.activities[3].baselineFinish = '2026-03-06'
    s.activities[4].baselineFinish = '2026-03-09'
    const r = runDcma(s)
    expect(check(r, 11).result).toBe('fail')
    expect(check(r, 11).offenders).toEqual(['A2', 'A3', 'A4'])
    expect(check(r, 14).result).toBe('fail')
    expect(check(r, 14).metric).toBe('0.40') // 2 complete / 5 due
  })
  it('12 Critical path test fails when a mandatory constraint pins the finish', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02',
      activities: [task('A'), task('B'), task('C'), task('Z', 30, { constraint: { type: 'MSO', date: '2026-03-16' } })],
      links: [fs('A', 'B'), fs('B', 'C'), fs('C', 'Z')],
      calendars: [cal],
    }
    const r = runDcma(s)
    expect(check(r, 12).result).toBe('fail')
    expect(check(r, 12).offenders).toEqual(['A'])
  })
  it('13 CPLI with negative float at the finish', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02',
      dataDate: '2026-03-09',
      projectFinish: '2026-04-03',
      activities: [
        task('A', 10, { earlyStart: '2026-03-09', earlyFinish: '2026-03-20', totalFloat: -20 }),
        task('B', 10, { earlyStart: '2026-03-23', earlyFinish: '2026-04-03', totalFloat: -20 }),
      ],
      links: [fs('A', 'B')],
      calendars: [cal],
    }
    const r = runDcma(s)
    expect(check(r, 13).result).toBe('fail')
    expect(check(r, 13).metric).toBe('-0.05') // (19 - 20) / 19
    expect(check(r, 13).offenders).toEqual(['B'])
  })
})

describe('runDcma: n/a handling', () => {
  it('marks checks n/a without data date, baselines, resources or start', () => {
    const s: AnalyzableSchedule = {
      activities: [task('A', 5, { resourceCount: undefined }), task('B', 5, { resourceCount: undefined })],
      links: [fs('A', 'B')],
      calendars: [cal],
    }
    const r = runDcma(s)
    for (const id of [6, 7, 9, 10, 11, 12, 13, 14]) expect(check(r, id).result).toBe('n/a')
    expect(r.applicable).toBe(6)
    expect(r.score).toBe(100)
  })
  it('excludes summary and LOE activities', () => {
    const s = goodSchedule()
    s.activities.push({ id: 'SUM', code: 'SUM', name: 'Summary', type: 'summary', duration: 400 })
    s.activities.push({ id: 'LOE', code: 'LOE', name: 'Supervision', type: 'loe', duration: 400 })
    const r = runDcma(s)
    expect(r.score).toBe(100)
  })
})

describe('helpers', () => {
  it('normalizes constraint names', () => {
    expect(normalizeConstraintType('CS_MSO')).toBe('MSO')
    expect(normalizeConstraintType('CS_MEOB')).toBe('FNLT')
    expect(normalizeConstraintType('Start No Earlier Than')).toBe('SNET')
    expect(normalizeConstraintType('weird')).toBeNull()
  })
  it('scheduleToCpmInput drops summaries and dangling links', () => {
    const s = goodSchedule()
    s.activities.push({ id: 'SUM', code: 'SUM', name: 'Summary', type: 'summary', duration: 4 })
    s.links.push(fs('SUM', 'A3'))
    const inp = scheduleToCpmInput(s)!
    expect(inp.activities.find((a) => a.id === 'SUM')).toBeUndefined()
    expect(inp.links.find((l) => l.from === 'SUM')).toBeUndefined()
    expect(scheduleToCpmInput({ activities: [], links: [], calendars: [] })).toBeNull()
  })
})
