// Regression for the production symptom "Critical activities 0 of 330 total", status "On track",
// "The goal is Substantial Completion by —" on a lean P6 import workbook (Metra CREATE P2 – P6 Import
// LEAN): the P6 Excel format keeps the logic on a TASKPRED sheet, which the spreadsheet importer did
// not read, so the network had no relationships, no dates and no critical path, yet looked healthy.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import ExcelJS from 'exceljs'
import { parseScheduleFile } from '@/lib/parsers'
import type { ParsedSchedule } from '@/lib/parsers/types'
import { completeSchedule } from './complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { applyBaseline, assessFileTargets, resolveBaseline } from '@/lib/analysis/baseline'
import { projectBrief } from '@/lib/analysis/brief'
import { criticalPathStatus } from '@/lib/analysis/critical-status'
import { LEAN_START, leanP6Workbook, leanP6Xml, leanSchedule, leanXer } from '@/lib/parsers/__fixtures__/lean-schedule'
import type { Schedule } from '@/lib/db'

const FILE = 'Metra CREATE P2 – P6 Import LEAN (Rev SOQ Jul-26, R1).xlsx'

// The workbook has no dates, so it is scheduled from "today". Which weekday that is changes the float:
// an SS+5 lag on the 7-day site calendar that lands on a weekend gives the 5-day path before it real
// calendar float (as P6 computes it), so the start milestone is critical only for some start days.
// Schedule from the fixture's own start date so every check below is about logic, not the calendar.
beforeAll(() => { vi.useFakeTimers({ now: new Date(`${LEAN_START}T12:00:00Z`), toFake: ['Date'] }) })
afterAll(() => { vi.useRealTimers() })

/** The upload pipeline (route.ts POST), minus the database. */
function pipeline(parsed: ParsedSchedule, opts: { mustFinishBy?: string | null } = {}) {
  const mustFinishBy = opts.mustFinishBy !== undefined ? opts.mustFinishBy : parsed.mustFinishBy ?? null
  const done = completeSchedule({
    activities: parsed.activities, relationships: parsed.relationships, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
    projectStart: parsed.projectStart, projectFinish: parsed.projectFinish, dataDate: parsed.dataDate, mustFinishBy,
  })
  const baseline = resolveBaseline({ activities: done.activities, seriesBaseline: null, meta: { embedded: parsed.embeddedBaseline ?? null, fileTargets: assessFileTargets(parsed.activities) } })
  const activities = applyBaseline(done.activities, baseline)
  const links = parsed.relationships.map(r => ({ from: r.predecessorId, to: r.successorId }))
  const analysis = analyzeSchedule({
    activities, links, cpm: done.cpm, reportedFinish: parsed.projectFinish, mustFinishBy, fileValues: done.fileValues,
    today: '2026-10-23', dataDate: parsed.dataDate, baseline, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
  })
  const schedule = { name: parsed.projectName, projectStart: done.projectStart, projectFinish: analysis.forecastFinish, dataDate: parsed.dataDate, analysis } as unknown as Schedule
  const brief = projectBrief(schedule, activities)
  const critical = criticalPathStatus({ activities, links, calculated: !!done.cpm, mustFinishBy, minFloat: analysis.minFloat })
  return { done, activities, analysis, brief, critical }
}

const linkSet = (p: ParsedSchedule) => {
  const code = new Map(p.activities.map(a => [a.id, a.activityId]))
  return p.relationships.map(r => `${code.get(r.predecessorId)} ${r.type}${r.lag ? `+${r.lag}` : ''} ${code.get(r.successorId)}`).sort()
}

describe('lean P6 import workbook (TASK + TASKPRED sheets)', async () => {
  const net = leanSchedule()
  const parsed = await parseScheduleFile(FILE, await leanP6Workbook(), 'sched-lean')

  it('reads the TASKPRED sheet: every relationship, with its type and lag', () => {
    expect(parsed.activities).toHaveLength(330)
    expect(parsed.relationships).toHaveLength(net.links.length)
    const expected = net.links.map(l => `${l.pred} ${l.type}${l.lag ? `+${l.lag}` : ''} ${l.succ}`).sort()
    expect(linkSet(parsed)).toEqual(expected)
    expect(parsed.warnings.join(' ')).toMatch(/Read worksheets "TASK" and "TASKPRED"/)
    expect(parsed.warnings.join(' ')).not.toMatch(/no logic/i)
    // P6 field-name row (row 1) and title row (row 2): the title row is the header, never an activity
    expect(parsed.activities.some(a => a.activityId === 'Activity ID' || a.activityId === 'task_code')).toBe(false)
  })

  it('reads P6 activity types: start/finish milestones, LOE and WBS summary', () => {
    const by = (c: string) => parsed.activities.find(a => a.activityId === c)!
    expect(by('MS1000')).toMatchObject({ activityType: 'milestone', milestoneKind: 'start' })
    expect(by('MS9999')).toMatchObject({ activityType: 'milestone', milestoneKind: 'finish' })
    expect(by('LOE-100').activityType).toBe('loe')
    expect(by('WBS-SUM').activityType).toBe('summary')
    for (const x of net.activities) expect(by(x.code).duration).toBe(x.type === 'TT_Mile' || x.type === 'TT_FinMile' ? 0 : x.duration)
  })

  it('has the same logic as the XER and P6 XML exports of the same network', async () => {
    const xer = await parseScheduleFile('lean.xer', Buffer.from(leanXer()), 'x')
    const xml = await parseScheduleFile('lean.xml', Buffer.from(leanP6Xml()), 'y')
    expect(linkSet(xer)).toEqual(linkSet(parsed))
    expect(linkSet(xml)).toEqual(linkSet(parsed))
  })

  it('calculates a critical path, dates and a finish instead of "0 critical" and "by —"', () => {
    const r = pipeline(parsed)
    expect(r.done.cpm).not.toBeNull()
    const crit = r.activities.filter(a => a.isCritical)
    expect(crit.length).toBeGreaterThan(20)
    expect(crit.map(a => a.activityId)).toEqual(expect.arrayContaining(['MS1000', 'MS9999']))
    for (const a of crit) expect(a.totalFloat).toBeLessThanOrEqual(0)
    // LOE and WBS summary activities are never critical
    expect(crit.some(a => a.activityType === 'loe' || a.activityType === 'summary')).toBe(false)
    expect(r.critical).toMatchObject({ determined: true, count: crit.length })
    expect(r.analysis.forecastFinish).toMatch(/^20\d\d-\d\d-\d\d$/)
    expect(r.brief.summary).toMatch(/The goal is Substantial Completion by \d\d\/\d\d\/\d{4}/)
    // The file has no dates: the note says the calendar dates are RunF9's, not the file's
    expect(r.done.note).toMatch(/no project start, data date or activity dates/)
  })

  it('is not "On track" without a baseline or a required finish', () => {
    const r = pipeline(parsed)
    expect(r.analysis.varianceDays).toBeNull()
    expect(r.analysis.status).toBe('no_baseline')
  })

  it('with a required finish it meets, it is on track; one it misses puts it at risk', () => {
    const met = pipeline(parsed, { mustFinishBy: '2035-12-31' })
    expect(met.analysis.status).toBe('on_track')
    // ...and a far-off required finish leaves positive float everywhere: 0 critical is explained
    expect(met.critical.count).toBe(0)
    expect(met.critical.label).toBe('none at zero float')
    expect(met.critical.detail).toMatch(/required finish 12\/31\/2035 leaves every open activity at least \d+ work days of float/)
    const missed = pipeline(parsed, { mustFinishBy: '2027-06-30' })
    expect(missed.analysis.status).toBe('at_risk')
  })
})

describe('the same workbook without its TASKPRED sheet (no logic at all)', async () => {
  const parsed = await parseScheduleFile(FILE, await leanP6Workbook({ taskSheetOnly: true }), 'sched-lean-2')
  const r = pipeline(parsed)

  it('says the critical path cannot be determined instead of showing a confident 0', () => {
    expect(parsed.relationships).toHaveLength(0)
    expect(r.critical).toMatchObject({ determined: false, label: 'No logic links found' })
    expect(r.critical.detail).toMatch(/no relationships between its 328 activities/)
  })

  it('needs attention (no logic), and never reads "On track"', () => {
    expect(r.analysis.status).toBe('attention')
    expect(r.analysis.statusReasons.join(' ')).toMatch(/No logic links/)
  })

  it('does not print "Substantial Completion by —"', () => {
    expect(r.brief.summary).not.toMatch(/by —/)
    expect(r.brief.summary).toMatch(/Substantial Completion; its date cannot be forecast/)
  })
})

describe('P6 Excel sheets with field-name headers only (no title row)', () => {
  it('reads _hr_cnt durations and lags as hours on the activity / predecessor calendar', async () => {
    const wb = new ExcelJS.Workbook()
    const t = wb.addWorksheet('TASK')
    t.addRow(['task_code', 'task_name', 'task_type', 'target_drtn_hr_cnt', 'delete_record_flag'])
    t.addRow(['A100', 'Start', 'TT_Mile', 0, ''])
    t.addRow(['A110', 'Excavate', 'TT_Task', 80, ''])
    t.addRow(['A120', 'Old activity', 'TT_Task', 40, 'Y'])
    t.addRow(['A130', 'Finish', 'TT_FinMile', 0, ''])
    const p = wb.addWorksheet('TASKPRED')
    p.addRow(['pred_task_id', 'task_id', 'pred_type', 'lag_hr_cnt'])
    p.addRow(['A100', 'A110', 'PR_FS', 0])
    p.addRow(['A110', 'A130', 'Finish to Finish', 16])
    p.addRow(['A100', 'A999', 'PR_FS', 0])
    const parsed = await parseScheduleFile('import.xlsx', Buffer.from(await wb.xlsx.writeBuffer()), 's')
    expect(parsed.activities.map(a => a.activityId)).toEqual(['A100', 'A110', 'A130'])
    expect(parsed.activities[1].duration).toBe(10)
    expect(parsed.activities[0].milestoneKind).toBe('start')
    expect(linkSet(parsed)).toEqual(['A100 FS A110', 'A110 FF+2 A130'])
    expect(parsed.warnings.join(' ')).toMatch(/1 row marked "Delete This Row"/)
    expect(parsed.warnings.join(' ')).toMatch(/Unresolved logic references \(1\): TASKPRED row 4: successor "A999"/)
    expect(parsed.exceptions?.records.some(x => x.entity === 'relationship' && x.disposition === 'dropped')).toBe(true)
  })
})

describe('criticalPathStatus', () => {
  const a = (id: string, f: Partial<{ activityType: 'task' | 'milestone' | 'loe' | 'summary'; status: 'not_started' | 'in_progress' | 'complete'; isCritical: boolean }> = {}) =>
    ({ id, activityType: f.activityType ?? 'task', status: f.status ?? 'not_started', actualFinish: null, isCritical: f.isCritical ?? false, earlyStart: null, earlyFinish: null })

  it('is undetermined when the network could not be calculated', () => {
    const s = criticalPathStatus({ activities: [a('1'), a('2')], links: [{ from: '1', to: '2' }], calculated: false })
    expect(s).toMatchObject({ determined: false, label: "Critical path can't be determined" })
  })
  it('counts open ends beyond the project start and finish and warns when they are many', () => {
    const acts = [a('s', { activityType: 'milestone', isCritical: true }), ...['1', '2', '3', '4'].map(i => a(i)), a('f', { activityType: 'milestone', isCritical: true })]
    const links = [{ from: 's', to: '1' }, { from: '1', to: 'f' }, { from: 's', to: '2' }, { from: 's', to: '3' }, { from: '4', to: 'f' }]
    const s = criticalPathStatus({ activities: acts, links, calculated: true })
    expect(s.openEnds).toBe(3)
    expect(s.count).toBe(2)
    expect(s.detail).toMatch(/3 activities are missing a predecessor or successor \(open ends\)/)
  })
  it('a completed schedule has no critical path to show and says so', () => {
    const s = criticalPathStatus({ activities: [a('1', { status: 'complete' })], links: [], calculated: false })
    expect(s).toMatchObject({ determined: true, count: 0, label: 'all work is complete' })
  })
})
