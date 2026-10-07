// Round-3 pilot findings: MS Project XML export/import fidelity for uploads (LOE, durations, working
// times, milestone times, deadlines), P6 remaining duration on not-started work, the uncapped
// recalculation-difference list and DCMA #9 judged on the contractor file's own dates.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Activity, Relationship, Schedule } from '@/lib/db'
import type { AnalyzableActivity, AnalyzableSchedule, WorkCalendar } from '@/lib/planning/types'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import { makeActivity } from '@/lib/parsers/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import { runCpm } from '@/lib/planning/cpm'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { recalcWarning } from '@/lib/analysis/recalc-warning'
import { runDcma } from '@/lib/analysis/dcma'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { parseXER } from '@/lib/parsers/xer-parser'
import { defaultCalendar } from '@/lib/planning/calendar'
import { exportMspXml } from './msp-xml'
import { recalcSection } from './reports'

const c8: WorkCalendar = { id: 'c8', name: '5d 07:00-15:30', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [], workTimes: [{ from: '07:00', to: '11:00' }, { from: '11:30', to: '15:30' }] }
const c10: WorkCalendar = { id: 'c10', name: '5d x 10h', workDays: [1, 2, 3, 4, 5], hoursPerDay: 10, holidays: [], workTimes: [{ from: '07:00', to: '12:00' }, { from: '12:30', to: '17:30' }] }

const act = (code: string, f: Partial<Activity>) => makeActivity('s1', { activityId: code, name: code, calendarId: 'c8', ...f })
const rel = (p: Activity, s: Activity, type: Relationship['type'] = 'FS'): Relationship => ({ id: `${p.activityId}-${s.activityId}`, scheduleId: 's1', predecessorId: p.id, successorId: s.id, type, lag: 0 })

function upload() {
  const ntp = act('NTP', { name: 'Notice to Proceed', activityType: 'milestone', milestoneKind: 'start', actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', percentComplete: 100, earlyStart: '2026-03-02', earlyFinish: '2026-03-02' })
  const a100 = act('A100', { duration: 10, remainingDuration: 0, actualStart: '2026-03-02', actualFinish: '2026-03-13', status: 'complete', percentComplete: 100 })
  // In progress on a 10h calendar; the remaining (8d) now exceeds the original (5d).
  const a200 = act('A200', { duration: 5, remainingDuration: 8, actualStart: '2026-03-09', status: 'in_progress', percentComplete: 40, calendarId: 'c10' })
  // Not started; P6 remaining (4d) differs from the original (10d).
  const a300 = act('A300', { duration: 10, remainingDuration: 4, status: 'not_started' })
  const m400 = act('M400', { name: 'Dry-in', activityType: 'milestone', milestoneKind: 'finish', constraintType: 'FNLT', constraintDate: '2026-04-10' })
  const m900 = act('M900', { name: 'Substantial Completion', activityType: 'milestone', milestoneKind: 'finish' })
  const loe = act('L100', { name: 'General Conditions', activityType: 'loe', duration: 30, remainingDuration: 20, actualStart: '2026-03-02', status: 'in_progress', earlyStart: '2026-03-02', earlyFinish: '2026-04-10' })
  const activities = [ntp, a100, a200, a300, m400, m900, loe]
  const rels = [rel(ntp, a100), rel(ntp, a200), rel(a200, a300), rel(a300, m400), rel(m400, m900), rel(ntp, loe, 'SS'), rel(loe, m900, 'FF')]
  const done = completeSchedule({ activities, relationships: rels, calendars: [c8, c10], defaultCalendarId: 'c8', projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-16', mustFinishBy: '2026-05-29' })
  const schedule = { calendars: [c8, c10], defaultCalendarId: 'c8', fileName: 'update.xer', uploadedAt: '2026-03-17T00:00:00Z', projectStart: '2026-03-02', dataDate: '2026-03-16' } as unknown as Schedule
  const g = uploadedToGenerated(schedule, done.activities, rels, done.cpm, { mustFinishBy: '2026-05-29' } as ScheduleAnalysis, [], { includeLoe: true })
  return { done, g, rels, ids: { ntp, a200, a300, m400, m900, loe } }
}

const taskBlock = (xml: string, code: string) => xml.split('<Task>').find(b => b.includes(`<Value>${code}</Value>`))!

describe('P6 remaining duration on not-started work (finding 4)', () => {
  it('schedules a not-started activity on its remaining duration, as P6', () => {
    const { done, ids } = upload()
    // A200 resumes on the data date with 8 days left (03-16..03-25); A300 then takes 4 days, not 10.
    expect(done.cpm!.times[ids.a200.id].earlyFinish).toBe('2026-03-25')
    expect(done.cpm!.times[ids.a300.id]).toMatchObject({ earlyStart: '2026-03-26', earlyFinish: '2026-03-31' })
  })
  it('the CPM uses a positive remaining on open work and ignores 0 (no remaining given)', () => {
    const base = { projectStart: '2026-03-02', calendars: [defaultCalendar()], links: [] }
    const r = runCpm({ ...base, activities: [{ id: 'x', code: 'X', name: 'X', duration: 10, remaining: 3, type: 'task' }, { id: 'y', code: 'Y', name: 'Y', duration: 5, remaining: 0, type: 'task' }] })
    expect(r.times.x.earlyFinish).toBe('2026-03-04')
    expect(r.times.y.earlyFinish).toBe('2026-03-06')
  })
})

describe('MS Project XML export of an upload (finding 1) and import (finding 2)', () => {
  const { g, done, ids } = upload()
  const xml = exportMspXml(g, 'Pilot update')

  it('keeps level-of-effort activities and their links', () => {
    expect(g.activities.map(a => a.code)).toContain('L100')
    expect(g.links).toHaveLength(7)
    const l = taskBlock(xml, 'L100')
    expect(l).toContain('<Value>Level of Effort</Value>')
    expect(l).toContain('<Critical>0</Critical>')
    // Spans the linked work: from NTP (SS) to Substantial Completion (FF).
    expect(l).toContain('<Start>2026-03-02T07:00:00</Start>')
    expect(l).toContain(`<Finish>${done.cpm!.times[ids.m900.id].earlyFinish}T15:30:00</Finish>`)
    expect(xml.match(/<PredecessorLink>/g)).toHaveLength(7)
  })

  it('writes original duration, the true remaining, actual to the data date and a consistent % complete', () => {
    const a200 = taskBlock(xml, 'A200')
    expect(a200).toContain('<Duration>PT50H0M0S</Duration>')
    expect(a200).toContain('<RemainingDuration>PT80H0M0S</RemainingDuration>')
    expect(a200).toContain('<ActualDuration>PT50H0M0S</ActualDuration>') // 03-09..03-13
    expect(a200).toContain('<PercentComplete>38</PercentComplete>') // 5 / (5 + 8)
    const a300 = taskBlock(xml, 'A300')
    expect(a300).toContain('<Duration>PT80H0M0S</Duration>')
    expect(a300).toContain('<RemainingDuration>PT32H0M0S</RemainingDuration>')
  })

  it('uses the source calendars\' working times, including 10h days', () => {
    expect(xml).toContain('<FromTime>07:00:00</FromTime>')
    expect(xml).toContain('<ToTime>15:30:00</ToTime>')
    expect(xml).toContain('<ToTime>17:30:00</ToTime>')
    expect(taskBlock(xml, 'A200')).toContain('<Start>2026-03-09T07:00:00</Start>')
    expect(taskBlock(xml, 'A200')).toContain('<Finish>2026-03-25T17:30:00</Finish>')
    expect(taskBlock(xml, 'A300')).toContain('<Finish>2026-03-31T15:30:00</Finish>')
    expect(xml).not.toContain('T08:00:00')
  })

  it('puts start milestones at the start of the day and finish milestones at the end', () => {
    expect(taskBlock(xml, 'NTP')).toContain('<Start>2026-03-02T07:00:00</Start>')
    expect(taskBlock(xml, 'NTP')).toContain('<Finish>2026-03-02T07:00:00</Finish>')
    expect(taskBlock(xml, 'M400')).toContain('<Finish>2026-03-31T15:30:00</Finish>')
    expect(taskBlock(xml, 'M400')).toContain('<Start>2026-03-31T15:30:00</Start>')
  })

  it('gives each milestone its own Deadline; only the finish milestone carries the required finish', () => {
    expect(taskBlock(xml, 'M400')).toContain('<Deadline>2026-04-10T15:30:00</Deadline>')
    expect(taskBlock(xml, 'M900')).toContain('<Deadline>2026-05-29T15:30:00</Deadline>')
    expect(xml.match(/<Deadline>/g)).toHaveLength(2)
  })

  it('round trip: import keeps the required finish, constraints, LOE, durations, milestone kinds and working times', () => {
    const p = parseMSProjectXML(xml, 'rt')
    const by = new Map(p.activities.map(a => [a.activityId, a]))
    expect(p.mustFinishBy).toBe('2026-05-29')
    expect(by.get('M400')).toMatchObject({ constraintType: 'FNLT', constraintDate: '2026-04-10', milestoneKind: 'finish' })
    expect(by.get('NTP')!.milestoneKind).toBe('start')
    expect(by.get('M900')!.milestoneKind).toBe('finish')
    expect(by.get('L100')!.activityType).toBe('loe')
    expect(p.relationships).toHaveLength(7)
    expect(by.get('A200')).toMatchObject({ duration: 5, remainingDuration: 8, status: 'in_progress' })
    expect(by.get('A300')).toMatchObject({ duration: 10, remainingDuration: 4, status: 'not_started' })
    expect(p.calendars.find(c => c.name === '5d x 10h')!.workTimes).toEqual(c10.workTimes)
    // Rescheduled from the imported file: same dates as the upload.
    const again = completeSchedule({ activities: p.activities.filter(a => a.activityType !== 'summary'), relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, projectFinish: null, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy })
    const t = (code: string) => again.cpm!.times[p.activities.find(a => a.activityId === code)!.id]
    expect(t('A300')).toMatchObject({ earlyStart: '2026-03-26', earlyFinish: '2026-03-31' })
    expect(t('M900').totalFloat).toBe(done.cpm!.times[ids.m900.id].totalFloat)
  })

  it('an MS Project Deadline on an interim activity without a constraint becomes Finish On or Before', () => {
    const x = xml.replace(/<ConstraintType>7<\/ConstraintType>\s*<CalendarUID>1<\/CalendarUID>\s*<ConstraintDate>[^<]*<\/ConstraintDate>/, '<ConstraintType>0</ConstraintType><CalendarUID>1</CalendarUID>')
    expect(x).not.toContain('<ConstraintType>7</ConstraintType>')
    const m = parseMSProjectXML(x, 'rt').activities.find(a => a.activityId === 'M400')!
    expect(m).toMatchObject({ constraintType: 'FNLT', constraintDate: '2026-04-10' })
  })
})

describe('P6 calendar working times', () => {
  it('reads each calendar\'s working periods from clndr_data', () => {
    const p = parseXER(readFileSync(join(__dirname, '../parsers/__fixtures__/sample.xer'), 'utf8'), 's')
    expect(p.calendars.find(c => c.id === '200')!.workTimes).toEqual([{ from: '07:00', to: '12:00' }, { from: '12:30', to: '17:30' }])
    expect(p.calendars.find(c => c.id === '100')!.workTimes).toEqual([{ from: '08:00', to: '12:00' }, { from: '13:00', to: '17:00' }])
  })
})

describe('recalculation differences are not capped (finding 3)', () => {
  const cal = defaultCalendar()
  const acts = Array.from({ length: 15 }, (_, i) => makeActivity('s1', {
    activityId: `A${100 + i}`, name: `Work ${i}`, duration: 5, calendarId: cal.id,
    earlyStart: '2026-06-01', earlyFinish: '2026-06-05', lateStart: '2026-07-01', lateFinish: '2026-07-07', totalFloat: 20,
  }))
  const rels: Relationship[] = acts.slice(1).map((a, i) => ({ id: `r${i}`, scheduleId: 's1', predecessorId: acts[i].id, successorId: a.id, type: 'FS', lag: 0 }))
  const done = completeSchedule({ activities: acts, relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: '2026-07-07', dataDate: '2026-03-02' })
  const analysis = analyzeSchedule({ activities: done.activities, links: rels.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: '2026-07-07', mustFinishBy: null, fileValues: done.fileValues, dataDate: '2026-03-02' })

  it('keeps every differing activity with file vs Planora ES/EF/LS/LF/TF', () => {
    expect(analysis.recalc!.differing).toBe(15)
    expect(analysis.recalc!.samples).toHaveLength(15)
    expect(analysis.recalc!.samples[0]).toMatchObject({ code: 'A100', fileStart: '2026-06-01', planoraStart: '2026-03-02', fileFinish: '2026-06-05', fileLateStart: '2026-07-01', fileLateFinish: '2026-07-07', fileFloat: 20 })
  })

  it('QA/QC section 5 prints every row and its count matches the heading', () => {
    const md = recalcSection(analysis.recalc!)
    expect(md).toMatch(/^15 of 15 open activities differ/)
    const rows = md.split('\n').filter(l => /^\| A1\d\d /.test(l))
    expect(rows).toHaveLength(15)
    expect(md).toContain('File ES')
    expect(md).toContain('Planora LF')
    expect(recalcWarning(analysis.recalc)).toMatch(/^15 of 15 open activities have dates or total float/)
  })

  it('an analysis stored with the old 10-row cap says so instead of under-counting', () => {
    const md = recalcSection({ ...analysis.recalc!, samples: analysis.recalc!.samples.slice(0, 10) })
    expect(md).toMatch(/only 10 are listed/)
  })
})

describe('DCMA #9 Invalid dates on the contractor file\'s dates (finding 5)', () => {
  const cal = defaultCalendar()
  const t = (id: string, f: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name: id, type: 'task', duration: 5, status: 'not_started', calendarId: cal.id, ...f })
  const sched = (activities: AnalyzableActivity[], extra: Partial<AnalyzableSchedule> = {}): AnalyzableSchedule => ({
    dataDate: '2026-03-16', projectStart: '2026-03-02', activities, calendars: [cal], defaultCalendarId: cal.id,
    links: activities.slice(1).map((a, i) => ({ from: activities[i].id, to: a.id, type: 'FS' as const, lag: 0 })), ...extra,
  })
  const nine = (s: AnalyzableSchedule) => runDcma(s).checks.find(c => c.id === 9)!
  // Planora's stored (recalculated) dates are all valid.
  const valid = () => [
    t('A1', { status: 'complete', actualStart: '2026-03-02', actualFinish: '2026-03-06', earlyStart: '2026-03-02', earlyFinish: '2026-03-06' }),
    t('A2', { status: 'in_progress', actualStart: '2026-03-09', earlyStart: '2026-03-09', earlyFinish: '2026-03-18', remaining: 3 }),
    t('A3', { earlyStart: '2026-03-19', earlyFinish: '2026-03-25' }),
  ]

  it('passes when the stored dates are valid and no file dates were captured', () => {
    expect(nine(sched(valid())).result).toBe('pass')
  })

  it('flags forecasts before the data date in the file even though the recalculation moved them', () => {
    const r = nine(sched(valid(), { fileDates: { [valid()[2].id]: { earlyStart: '2026-03-10', earlyFinish: '2026-03-13' }, A2: { earlyStart: '2026-03-09', earlyFinish: '2026-03-12' } } }))
    expect(r.result).toBe('fail')
    expect(r.offenders).toEqual(['A2', 'A3'])
    expect(r.explanation).toMatch(/2 incomplete activities have forecast \(early\) dates before it in the contractor's file/)
    expect(r.explanation).toMatch(/Not scheduled to the data date: 1 unstarted activity \(A3\)/)
  })

  it('flags actual dates after the data date', () => {
    const acts = valid()
    acts[0].actualFinish = '2026-03-20'
    const r = nine(sched(acts, { fileDates: {} }))
    expect(r.offenders).toEqual(['A1'])
    expect(r.explanation).toMatch(/1 activity has an actual date after the 03\/16\/2026 data date/)
    expect(r.explanation).not.toMatch(/Not scheduled/)
  })

  it('analyzeSchedule captures the file\'s forecasts before the data date at upload', () => {
    const a = makeActivity('s1', { activityId: 'B1', name: 'B1', duration: 5, calendarId: cal.id, earlyStart: '2026-03-09', earlyFinish: '2026-03-13', totalFloat: 2 })
    const b = makeActivity('s1', { activityId: 'B2', name: 'B2', duration: 5, calendarId: cal.id, earlyStart: '2026-03-16', earlyFinish: '2026-03-20', totalFloat: 2 })
    const rels: Relationship[] = [{ id: 'r', scheduleId: 's1', predecessorId: a.id, successorId: b.id, type: 'FS', lag: 0 }]
    const done = completeSchedule({ activities: [a, b], relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: '2026-03-20', dataDate: '2026-03-16' })
    const an = analyzeSchedule({ activities: done.activities, links: [{ from: a.id, to: b.id }], cpm: done.cpm, reportedFinish: null, mustFinishBy: null, fileValues: done.fileValues, dataDate: '2026-03-16' })
    expect(an.recalc!.fileForecastsBeforeDataDate).toEqual([{ id: a.id, code: 'B1', earlyStart: '2026-03-09', earlyFinish: '2026-03-13', notStarted: true }])
    // Planora's own dates are from the data date, yet #9 still fails on the file's.
    const s = sched(done.activities.map(x => ({ id: x.id, code: x.activityId, name: x.name, type: 'task' as const, duration: x.duration, status: x.status, calendarId: cal.id, earlyStart: x.earlyStart, earlyFinish: x.earlyFinish })), {
      links: [{ from: a.id, to: b.id, type: 'FS', lag: 0 }],
      fileDates: Object.fromEntries(an.recalc!.fileForecastsBeforeDataDate!.map(f => [f.id, f])),
    })
    expect(nine({ ...s, fileDates: {} }).result).toBe('pass')
    expect(nine(s)).toMatchObject({ result: 'fail', offenders: ['B1'] })
  })
})
