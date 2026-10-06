// Expert P6 pilot findings: P6 scheduling behaviour, progress mode from the XER, LOE criticality,
// finish milestone late dates, the DCMA critical path test on seasonal calendars, float erosion order,
// and free float on generated plans.

import { describe, it, expect } from 'vitest'
import type { Answer, AnalyzableActivity, AnalyzableSchedule, CpmActivity, CpmInput, CpmLink, WorkCalendar } from './types'
import { PROJECT_TYPES } from './types'
import { runCpm } from './cpm'
import { defaultCalendar } from './calendar'
import { completeSchedule } from './complete-schedule'
import { generateSchedule } from './generator'
import { resolveProgressMode, progressModeWarning } from './upload-rules'
import { makeActivity } from '@/lib/parsers/types'
import { isPlanoraXer, parseXER, progressModeFromSchedOptions, readXerTables } from '@/lib/parsers/xer-parser'
import { exportXer, exportXerFromOriginal } from '@/lib/export/xer'
import { runDcma } from '@/lib/analysis/dcma'
import { compareSchedules, type CompareSide } from '@/lib/analysis/compare'
import type { Activity, Relationship } from '@/lib/db'

const cal5 = defaultCalendar()
const act = (id: string, duration: number, extra: Partial<CpmActivity> = {}): CpmActivity => ({ id, code: id, name: id, duration, type: duration === 0 ? 'milestone' : 'task', ...extra })
const fs = (from: string, to: string, lag = 0): CpmLink => ({ from, to, type: 'FS', lag })
const input = (activities: CpmActivity[], links: CpmLink[], extra: Partial<CpmInput> = {}): CpmInput =>
  ({ projectStart: '2026-03-02', activities, links, calendars: [cal5], defaultCalendarId: cal5.id, ...extra })

describe('P6: start constraints on started activities are ignored', () => {
  // Data date Monday 03/16/2026; B started 03/09 with 5 days remaining.
  const base = (constraint: CpmActivity['constraint']) => runCpm(input(
    [act('A', 5, { actualStart: '2026-03-02', actualFinish: '2026-03-06' }), act('B', 10, { actualStart: '2026-03-09', remaining: 5, constraint }), act('C', 5)],
    [fs('A', 'B'), fs('B', 'C')], { dataDate: '2026-03-16' },
  ))
  const plain = base(undefined)
  for (const type of ['SNET', 'SNLT', 'SO', 'MSO'] as const) {
    it(`${type} on an in-progress activity changes neither its dates nor its float`, () => {
      const r = base({ type, date: '2026-03-04' })
      expect(r.times.B).toEqual(plain.times.B)
      expect(r.times.C).toEqual(plain.times.C)
      expect(r.violations).toEqual([])
      expect(r.warnings.join(' ')).toMatch(new RegExp(`B: ${type} start constraint ignored because the activity has an actual start`))
    })
  }
  it('a finish constraint on an in-progress activity still applies', () => {
    const r = base({ type: 'FNLT', date: '2026-03-18' })
    expect(r.times.B.totalFloat).toBeLessThan(0)
  })
  it('the same start constraint on an unstarted activity still applies', () => {
    const r = runCpm(input([act('A', 5), act('B', 5, { constraint: { type: 'SNET', date: '2026-03-23' } })], [fs('A', 'B')]))
    expect(r.times.B.earlyStart).toBe('2026-03-23')
  })
})

describe('Finish milestone late finish is shown at the end of its day', () => {
  // A (5d) Mon 03/02 - Fri 03/06 -> finish milestone M; a parallel 6-day chain sets the finish to Mon 03/09.
  const r = runCpm(input([act('A', 5), act('M', 0, { milestoneKind: 'finish' }), act('L', 6)], [fs('A', 'M')]))
  it('LF - EF in work days equals total float', () => {
    expect(r.times.M.earlyFinish).toBe('2026-03-06')
    expect(r.times.M.totalFloat).toBe(1)
    // 1 work day of float: LF Monday 03/09 (end of day), not Tuesday.
    expect(r.times.M.lateFinish).toBe('2026-03-09')
  })
  it('a zero-float finish milestone ending on a Friday shows LF on that Friday, not the next Monday', () => {
    const z = runCpm(input([act('A', 5), act('M', 0, { milestoneKind: 'finish' }), act('B', 5)], [fs('A', 'M'), fs('A', 'B')], { mustFinishBy: '2026-03-13' }))
    expect(z.times.M.earlyFinish).toBe('2026-03-06')
    expect(z.times.M.lateFinish).toBe('2026-03-13')
    expect(z.times.M.totalFloat).toBe(5)
    const tight = runCpm(input([act('A', 5), act('M', 0, { milestoneKind: 'finish' })], [fs('A', 'M')]))
    expect(tight.times.M).toMatchObject({ earlyFinish: '2026-03-06', lateFinish: '2026-03-06', totalFloat: 0 })
  })
  it('a critical finish milestone followed by work on Monday shows LF Friday (was Monday, with TF 0)', () => {
    const r2 = runCpm(input([act('A', 5), act('M', 0, { milestoneKind: 'finish' }), act('B', 5)], [fs('A', 'M'), fs('M', 'B')]))
    expect(r2.times.B.earlyStart).toBe('2026-03-09')
    expect(r2.times.M).toMatchObject({ earlyFinish: '2026-03-06', lateFinish: '2026-03-06', totalFloat: 0 })
    // With 2 days of float the late finish is Tuesday 03/10, end of day.
    const r3 = runCpm(input([act('A', 5), act('M', 0, { milestoneKind: 'finish' }), act('B', 5), act('L', 12)], [fs('A', 'M'), fs('M', 'B')]))
    expect(r3.times.M).toMatchObject({ lateFinish: '2026-03-10', totalFloat: 2 })
  })
})

describe('LOE and WBS summary activities are never critical', () => {
  const a = (code: string, f: Partial<Activity>) => makeActivity('s', { activityId: code, name: code, duration: 5, remainingDuration: 5, ...f })
  const t1 = a('T1', {}), t2 = a('T2', {})
  const loe = a('LOE', { activityType: 'loe', isCritical: true, totalFloat: -3 })
  const wbs = a('WBS', { activityType: 'summary', isCritical: true })
  const rels: Relationship[] = [{ id: 'r', scheduleId: 's', predecessorId: t1.id, successorId: t2.id, type: 'FS', lag: 0 }]
  it('with logic (recalculated)', () => {
    const out = completeSchedule({ activities: [t1, t2, loe, wbs], relationships: rels, calendars: [cal5], defaultCalendarId: cal5.id, projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-02' })
    expect(out.activities.filter(x => x.isCritical).map(x => x.activityId)).toEqual(['T1', 'T2'])
  })
  it('without logic (file values kept)', () => {
    const out = completeSchedule({ activities: [{ ...t1, isCritical: true, totalFloat: 0, earlyStart: '2026-03-02', earlyFinish: '2026-03-06' }, loe, wbs], relationships: [], calendars: [cal5], defaultCalendarId: cal5.id, projectStart: '2026-03-02', projectFinish: '2026-03-06', dataDate: '2026-03-02' })
    expect(out.activities.filter(x => x.isCritical).map(x => x.activityId)).toEqual(['T1'])
  })
  it('the XER parser never flags TT_LOE / TT_WBS as critical', () => {
    const xer = [
      'ERMHDR\t19.12\t2026-03-01\tProject\tuser\tuser\tdb\tProject Management\tUSD',
      '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date', '%R\t1\tP1\t2026-03-02 08:00',
      '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttotal_float_hr_cnt\tdriving_path_flag\ttarget_drtn_hr_cnt',
      '%R\t10\t1\tL1\tSupervision\tTT_LOE\tTK_NotStart\t0\tY\t80',
      '%R\t11\t1\tW1\tSummary\tTT_WBS\tTK_NotStart\t-8\tY\t80',
      '%R\t12\t1\tA1\tWork\tTT_Task\tTK_NotStart\t0\tN\t40',
      '%E',
    ].join('\r\n')
    const p = parseXER(xer, 's')
    expect(p.activities.filter(x => x.isCritical).map(x => x.activityId)).toEqual(['A1'])
  })
})

describe('Progress mode from the XER (SCHEDOPTIONS)', () => {
  const xerWith = (retained: string, override: string) => [
    'ERMHDR\t19.12\t2026-03-01\tProject\tuser\tuser\tdb\tProject Management\tUSD',
    '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date', '%R\t1\tP1\t2026-03-02 08:00',
    '%T\tSCHEDOPTIONS', '%F\tschedoptions_id\tproj_id\tsched_retained_logic\tsched_progress_override', `%R\t5\t1\t${retained}\t${override}`,
    '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt', '%R\t12\t1\tA1\tWork\tTT_Task\tTK_NotStart\t40',
    '%E',
  ].join('\r\n') + '\r\n'
  it('reads Retained Logic, Progress Override and Actual Dates', () => {
    expect(parseXER(xerWith('Y', 'N'), 's').progressMode).toBe('retained')
    expect(parseXER(xerWith('N', 'Y'), 's').progressMode).toBe('override')
    const actual = parseXER(xerWith('N', 'N'), 's')
    expect(actual.progressMode).toBeNull()
    expect(actual.warnings.join(' ')).toMatch(/Actual Dates/)
    expect(progressModeFromSchedOptions(undefined)).toBeNull()
    expect(parseXER(xerWith('Y', 'N'), 's').warnings.join(' ')).not.toMatch(/SCHEDOPTIONS/)
  })
  it('defaults to the file, warns when the scheduler picks differently', () => {
    expect(resolveProgressMode(null, 'override')).toEqual({ mode: 'override', warning: null })
    expect(resolveProgressMode(null, null)).toEqual({ mode: 'retained', warning: null })
    expect(resolveProgressMode('override', 'override').warning).toBeNull()
    const r = resolveProgressMode('retained', 'override')
    expect(r.mode).toBe('retained')
    expect(r.warning).toMatch(/scheduled in P6 with Progress Override, but Planora is scheduling it with Retained Logic/)
    expect(progressModeWarning('override', null)).toBeNull()
  })
  it('the XER export keeps the setting (pass-through rewrites it only when changed; a fresh export writes it)', () => {
    const orig = xerWith('N', 'Y')
    expect(exportXerFromOriginal(orig, new Map(), { progressMode: 'override' })).toBe(orig)
    const changed = readXerTables(exportXerFromOriginal(orig, new Map(), { progressMode: 'retained' }))
    expect(changed['SCHEDOPTIONS'][0]).toMatchObject({ sched_retained_logic: 'Y', sched_progress_override: 'N', schedoptions_id: '5' })
    expect(exportXerFromOriginal(orig, new Map())).toBe(orig)
  })
})

describe('Planora exports are recognizable on re-import', () => {
  it('a fresh Planora XER is marked in its header; a P6 file is not', () => {
    const g = generateSchedule({ answers: { 'project.type': k('warehouse_industrial'), 'project.state': k('TX'), 'project.target_start': k('2026-03-02') }, today: '2026-01-15' })
    const x = exportXer(g, 'Warehouse', { exportedBy: 'Ana', progressMode: 'override' })
    expect(isPlanoraXer(x)).toBe(true)
    const parsed = parseXER(x, 's')
    expect(parsed.planoraExport).toBe(true)
    expect(parsed.progressMode).toBe('override')
    expect(isPlanoraXer('ERMHDR\t19.12\t2026-03-01\tProject\tuser\tPlanner Name\tdb\tProject Management\tUSD\r\n%E\r\n')).toBe(false)
  })
})

const k = (value: Answer['value']): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00.000Z' })

describe('DCMA #12 critical path test on seasonal calendars', () => {
  // A winter shutdown (12/15 - 03/15) every year on the finish activities' calendar only.
  const shutdown: string[] = []
  for (let y = 2026; y <= 2032; y++) {
    for (let d = Date.UTC(y, 11, 15); d <= Date.UTC(y + 1, 2, 15); d += 86_400_000) shutdown.push(new Date(d).toISOString().slice(0, 10))
  }
  const seasonal: WorkCalendar = { id: 'seasonal', name: 'Seasonal 5-day', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: shutdown }
  const cal7: WorkCalendar = { id: 'cal7', name: '7-Day', workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: 8, holidays: [] }
  const t = (id: string, d: number, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name: id, type: 'task', duration: d, resourceCount: 1, ...extra })
  it('passes when the finish moves less (or more) than 600 work days only because of nonwork periods', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-04-06', dataDate: '2026-04-06', calendars: [cal7, seasonal], defaultCalendarId: 'seasonal',
      activities: [t('A', 20, { calendarId: 'cal7' }), t('B', 40, { calendarId: 'seasonal' }), { id: 'F', code: 'F', name: 'Substantial Completion', type: 'milestone', duration: 0, calendarId: 'seasonal' }],
      links: [fs('A', 'B'), fs('B', 'F')],
    }
    const c = runDcma(s).checks.find(x => x.id === 12)!
    expect(c.result).toBe('pass')
    expect(c.metric).not.toBe('+600d finish for +600d on A')
    // The 12/15-03/15 run is a seasonal shutdown (a holiday run of two weeks or more), which the test
    // lifts, so the finish moves within the allowance and the path reads as continuous.
    expect(c.explanation).toMatch(/so the driving path is continuous/)
  })
  it('still fails, naming where the delay stops, when the path is broken', () => {
    // A drives B only through its START (SS): lengthening A cannot move B or the finish.
    const s: AnalyzableSchedule = {
      projectStart: '2026-04-06', dataDate: '2026-04-06', calendars: [cal5], defaultCalendarId: cal5.id,
      activities: [t('A', 10), t('X', 1), t('B', 30), { id: 'F', code: 'F', name: 'Substantial Completion', type: 'milestone', duration: 0 }],
      links: [{ from: 'A', to: 'B', type: 'SS', lag: 1 }, fs('A', 'X'), fs('B', 'F')],
    }
    const c = runDcma(s).checks.find(x => x.id === 12)!
    expect(c.result).toBe('fail')
    expect(c.explanation).toMatch(/the delay stops at B/)
    expect(c.offenders).toContain('B')
  })
})

describe('Float erosion is sorted by resulting negative float', () => {
  const a = (sched: string, code: string, f: Partial<Activity> = {}) => makeActivity(sched, { activityId: code, name: code, duration: 5, ...f })
  const side = (id: string, acts: Activity[]): CompareSide => ({ schedule: { id, name: 'P', version: id, dataDate: null, forecastFinish: '2026-06-01' }, activities: acts, relationships: [] })
  it('the activity now at -4 comes before a bigger drop that is still positive', () => {
    const before = side('B', [a('b', 'BIG', { totalFloat: 40 }), a('b', 'NEG', { totalFloat: 2 }), a('b', 'NEG2', { totalFloat: 0 })])
    const after = side('C', [a('c', 'BIG', { totalFloat: 5 }), a('c', 'NEG', { totalFloat: -4 }), a('c', 'NEG2', { totalFloat: -1 })])
    const r = compareSchedules(before, after)
    expect(r.floatErosion.map(f => f.code)).toEqual(['NEG', 'NEG2', 'BIG'])
    expect(r.summary.join(' ')).toMatch(/largest drop is BIG \(40 → 5 work days\)/)
  })
})

describe('Generated plans: free float never exceeds total float', () => {
  for (const type of PROJECT_TYPES) {
    for (const required of [undefined, '2026-09-30']) {
      it(`${type}${required ? ' with an unachievable required finish' : ''}`, () => {
        const answers: Record<string, Answer> = {
          'project.type': k(type), 'project.state': k('CA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(80000),
          'project.stories': k(3), 'project.target_start': k('2026-03-02'), 'design.drawings': k(true), 'design.percent': k(60),
          'project.federal': k(type === 'federal_defense'), ...(required ? { 'project.required_finish': k(required) } : {}),
        }
        const g = generateSchedule({ answers, today: '2026-01-15' })
        const times = g.cpm!.times
        for (const x of g.activities) {
          const tm = times[x.id]
          expect(tm.freeFloat, `${x.code} FF ${tm.freeFloat} TF ${tm.totalFloat}`).toBeLessThanOrEqual(Math.max(0, tm.totalFloat))
          expect(tm.freeFloat).toBeGreaterThanOrEqual(0)
        }
        if (required) expect(Object.values(times).some(tm => tm.totalFloat < 0)).toBe(true)
      })
    }
  }
})
