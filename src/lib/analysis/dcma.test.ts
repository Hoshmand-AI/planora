import { describe, it, expect } from 'vitest'
import type { AnalyzableActivity, AnalyzableSchedule, CpmLink } from '@/lib/planning/types'
import { runDcma, normalizeConstraintType, scheduleToCpmInput, baselineExecution } from '@/lib/analysis/dcma'
import { addWorkDays, defaultCalendar, finishFromStart } from '@/lib/planning/calendar'

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
    // CPLI at the finish milestone F against its baseline finish 12/31/2026 (well ahead of forecast)
    expect(Number(check(r, 13).metric)).toBeGreaterThan(1)
    expect(check(r, 13).explanation).toMatch(/^F Milestone F .*baseline finish 12\/31\/2026.*Standard 5-Day calendar/)
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
    // A4 is baselined to finish ON the data date (03/09): not yet due (strictly before only).
    expect(check(r, 11).offenders).toEqual(['A2', 'A3'])
    expect(check(r, 14).result).toBe('fail')
    expect(check(r, 14).metric).toBe('0.50') // 2 complete / 4 due (S, A1, A2, A3)
  })
  it('11/14 count baseline finishes strictly before the data date', () => {
    const s = goodSchedule()
    // Everything else is baselined in December; one task baselined to finish on the data date only.
    s.activities[2].baselineFinish = '2026-03-09'
    const r = runDcma(s)
    expect(check(r, 11).offenders).not.toContain('A2')
    expect(check(r, 11).result).toBe('pass')
    expect(check(r, 14).metric).toBe('1.00') // 2 complete / 2 due (S, A1)
    expect(baselineExecution(s.activities, '2026-03-09')).toMatchObject({ due: 2, missed: 0 })
    // One day later it is due and missed.
    expect(baselineExecution(s.activities, '2026-03-10')).toMatchObject({ due: 3, missed: 1, missedCodes: ['A2'] })
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
    expect(check(r, 12).offenders).toEqual(['A', 'Z'])
    expect(check(r, 12).explanation).toMatch(/mandatory constraint on Z \(Mandatory Start 03\/16\/2026\)/)
  })
  it('13 CPLI with negative float at the finish', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02',
      dataDate: '2026-03-09',
      projectFinish: '2026-04-03',
      mustFinishBy: '2026-03-06',
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
    expect(normalizeConstraintType('CS_MSO')).toBe('SO')
    expect(normalizeConstraintType('CS_MANDFIN')).toBe('MFO')
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

describe('organization quality thresholds', () => {
  it('normalizes rules and clamps out-of-range values', async () => {
    const { normalizeDcmaRules, DEFAULT_DCMA_RULES } = await import('./dcma')
    expect(normalizeDcmaRules(null)).toEqual(DEFAULT_DCMA_RULES)
    expect(normalizeDcmaRules({ maxPct: 99, minFsPct: 10, highFloatDays: 'x', indexTarget: 0.953 })).toEqual({ ...DEFAULT_DCMA_RULES, maxPct: 25, minFsPct: 50, indexTarget: 0.95 })
  })
})

describe('custom thresholds change the verdict', () => {
  it('a 70-day duration limit lets a 60-day task pass and reports the threshold used', () => {
    const s = goodSchedule()
    s.activities[3].duration = 60
    expect(check(runDcma(s), 8).result).toBe('fail')
    const r = runDcma(s, { highDurationDays: 70, maxPct: 10 })
    expect(check(r, 8).result).toBe('pass')
    expect(check(r, 8).threshold).toBe('≤ 10% with remaining > 70d')
    expect(check(runDcma(s, { minFsPct: 100 }), 4).threshold).toBe('≥ 100% FS')
  })
})

describe('runDcma: pilot findings', () => {
  it('CPLI fails when a mandatory finish hides negative float on the path to completion', () => {
    // 10-day chain finishing Fri 03/13 into a completion milestone pinned (MFO) to Wed 03/11.
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [ms('S'), task('A', 10), ms('F', { constraint: { type: 'MFO', date: '2026-03-11' } })],
      links: [fs('S', 'A'), fs('A', 'F')],
    }
    const r = runDcma(s)
    expect(check(r, 7).result).toBe('fail')
    expect(check(r, 13).result).toBe('fail')
    expect(Number(check(r, 13).metric)).toBeLessThan(1)
  })
  it('a fresh baseline does not fail Missed Tasks or BEI', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [ms('NTP', { baselineStart: '2026-03-02', baselineFinish: '2026-03-02' }), task('A', 5, { baselineStart: '2026-03-03', baselineFinish: '2026-03-09' }), ms('F', { baselineFinish: '2026-03-09' })],
      links: [fs('NTP', 'A'), fs('A', 'F')],
    }
    const r = runDcma(s)
    expect(check(r, 11).result).toBe('n/a')
    expect(check(r, 14).result).toBe('n/a')
  })
  it('Logic: a completed start milestone does not exempt an open dangling activity, and a dangling last task is flagged', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-09', calendars: [cal], defaultCalendarId: cal.id,
      activities: [
        ms('NTP', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }),
        task('A', 5), task('ORPHAN', 3), task('B', 5), ms('F'), task('LATE', 40),
      ],
      links: [fs('NTP', 'A'), fs('A', 'B'), fs('B', 'F'), fs('A', 'LATE')],
    }
    const offenders = check(runDcma(s), 1).offenders
    expect(offenders).toContain('ORPHAN')
    expect(offenders).toContain('LATE')
    expect(offenders).not.toContain('F')
  })
  it('Critical path test runs on the longest path even when a later required finish leaves positive float', () => {
    const s = goodSchedule()
    const r = runDcma(s)
    expect(check(r, 12).result).toBe('pass')
    expect(check(r, 12).metric).toMatch(/\+600d finish/)
  })
})

describe('runDcma: pilot findings (contract milestone, CPLI units, pinned paths, offenders)', () => {
  const cal7 = { id: 'cal7', name: '7-Day', workDays: [0, 1, 2, 3, 4, 5, 6] as const, hoursPerDay: 8, holidays: [] }
  it('CPLI is measured at Substantial Completion on its own calendar, not at an interim MFO milestone or Final Completion', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal, { ...cal7, workDays: [...cal7.workDays] }], defaultCalendarId: cal.id,
      activities: [
        ms('NTP', { name: 'Notice to Proceed', actualStart: '2026-03-02', actualFinish: '2026-03-02' }),
        task('A', 20),
        ms('DRY', { name: 'Dry-In', constraint: { type: 'MFO', date: '2026-12-31' } }),
        ms('SC', { name: 'Substantial Completion', calendarId: 'cal7', constraint: { type: 'FNLT', date: '2026-03-24' } }),
        task('PUNCH', 10),
        ms('FC', { name: 'Final Completion', constraint: { type: 'FNLT', date: '2026-12-31' } }),
      ],
      links: [fs('NTP', 'A'), fs('A', 'DRY'), fs('A', 'SC'), fs('SC', 'PUNCH'), fs('PUNCH', 'FC')],
    }
    const c = check(runDcma(s), 13)
    expect(c.result).toBe('fail')
    expect(c.offenders).toEqual(['SC'])
    expect(c.explanation).toMatch(/^SC Substantial Completion is forecast .* with total float of -\d+ work days on the 7-Day calendar \(its own float, as shown on the activity; target its FNLT constraint date 03\/24\/2026\), against \d+ remaining work days on the 7-Day calendar/)
    expect(c.explanation).not.toMatch(/realistically achievable/)
  })
  it('CPLI is n/a (not 1.00) when the finish milestone has no constraint, required finish or baseline', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }), task('A', 10), ms('F', { name: 'Substantial Completion' })],
      links: [fs('S', 'A'), fs('A', 'F')],
    }
    const c = check(runDcma(s), 13)
    expect(c.result).toBe('n/a')
    expect(c.explanation).toMatch(/no target/)
  })
  it('a failing CPLI is never shown rounded up to the threshold', () => {
    const ef = finishFromStart('2026-03-02', 200, cal)
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id, mustFinishBy: addWorkDays(ef, -10, cal),
      activities: [ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }), task('A', 200), ms('F', { name: 'Substantial Completion' })],
      links: [fs('S', 'A'), fs('A', 'F')],
    }
    const c = check(runDcma(s), 13)
    // (199 - 10) / 199 = 0.9497: shown as 0.94, not 0.95, and it fails
    expect(c.result).toBe('fail')
    expect(c.metric).toBe('0.94')
  })
  it('12 Critical path test FAILS (not n/a) when the only open path is pinned by a mandatory constraint', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-16', calendars: [cal], defaultCalendarId: cal.id,
      activities: [
        ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }),
        task('A', 5, { actualStart: '2026-03-02', actualFinish: '2026-03-06' }),
        ms('F', { name: 'Substantial Completion', constraint: { type: 'MFO', date: '2026-06-30' } }),
      ],
      links: [fs('S', 'A'), fs('A', 'F')],
    }
    const c = check(runDcma(s), 12)
    expect(c.result).toBe('fail')
    expect(c.offenders).toEqual(['F'])
    expect(c.explanation).toMatch(/held by a mandatory constraint on F \(Mandatory Finish 06\/30\/2026\)/)
  })
  it('lists every offender (no 25-activity cap)', () => {
    const s = goodSchedule()
    for (let i = 0; i < 30; i++) s.activities.push(task(`X${i}`, 3, { baselineFinish: '2026-12-31' }))
    const c = check(runDcma(s), 1)
    expect(c.result).toBe('fail')
    expect(c.offenders).toHaveLength(30)
  })
})
