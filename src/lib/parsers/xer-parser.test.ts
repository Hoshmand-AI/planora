import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseXER, parseClndrData } from './xer-parser'

const xer = readFileSync(path.join(__dirname, '__fixtures__', 'sample.xer'), 'utf8')
const parsed = parseXER(xer, 'sched-1')
const byCode = (code: string) => {
  const a = parsed.activities.find(x => x.activityId === code)
  if (!a) throw new Error(`missing ${code}`)
  return a
}

describe('parseXER', () => {
  it('reads CRLF files and project header', () => {
    expect(xer.includes('\r\n')).toBe(true)
    expect(parsed.sourceType).toBe('p6_xer')
    expect(parsed.projectName).toBe('Riverside Warehouse')
    expect(parsed.projectStart).toBe('2026-03-02')
    expect(parsed.dataDate).toBe('2026-03-16')
    expect(parsed.projectFinish).toBe('2026-06-30')
    expect(parsed.activities).toHaveLength(8)
  })

  it('resolves relationships to activity uuids (not P6 task_ids)', () => {
    const ids = new Set(parsed.activities.map(a => a.id))
    expect(parsed.relationships).toHaveLength(8) // 9 TASKPRED rows, one to an external task
    for (const r of parsed.relationships) {
      expect(ids.has(r.predecessorId)).toBe(true)
      expect(ids.has(r.successorId)).toBe(true)
      expect(r.scheduleId).toBe('sched-1')
    }
    expect(parsed.warnings.some(w => w.includes('9999'))).toBe(true)
    expect(byCode('A1000').sourceId).toBe('1001')
    expect(byCode('A1000').id).not.toBe('1001')
  })

  it('converts lag with the successor calendar hours', () => {
    const rel = (p: string, s: string) => parsed.relationships.find(r => r.predecessorId === byCode(p).id && r.successorId === byCode(s).id)
    expect(rel('A1020', 'A1030')).toMatchObject({ type: 'SS', lag: 2 }) // 16h on 8h calendar
    expect(rel('A1030', 'A1060')).toMatchObject({ type: 'FF', lag: 2 }) // 20h on 10h calendar
    expect(rel('A1050', 'A1070')).toMatchObject({ type: 'FS', lag: 0 })
  })

  it('parses CALENDAR clndr_data: work days, hours, holidays and extra work days', () => {
    expect(parsed.calendars).toHaveLength(2)
    const five = parsed.calendars.find(c => c.id === '100')!
    expect(five.name).toBe('5 Day x 8h (US Holidays)')
    expect(five.workDays).toEqual([1, 2, 3, 4, 5])
    expect(five.hoursPerDay).toBe(8)
    expect(five.holidays).toEqual(['2026-07-03']) // the Saturday exception is not a holiday on a non-work day
    expect(five.extraWorkDays).toEqual(['2026-03-14'])
    const seven = parsed.calendars.find(c => c.id === '200')!
    expect(seven.workDays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(seven.hoursPerDay).toBe(10)
    expect(seven.holidays).toEqual([])
    expect(parsed.defaultCalendarId).toBe('100')
  })

  it('assigns calendarId and uses calendar hours for durations and float', () => {
    const exc = byCode('A1020')
    expect(exc.calendarId).toBe('200')
    expect(exc.duration).toBe(10) // 100h / 10h
    expect(exc.remainingDuration).toBe(6)
    expect(exc.status).toBe('in_progress')
    expect(exc.isCritical).toBe(true)
    const cure = byCode('A1060')
    expect(cure.duration).toBe(7) // 70h / 10h
    expect(cure.totalFloat).toBe(5) // 50h / 10h
    const ftg = byCode('A1030')
    expect(ftg.calendarId).toBe('100')
    expect(ftg.duration).toBe(8)
    expect(ftg.totalFloat).toBe(2)
    expect(ftg.freeFloat).toBe(1)
    expect(ftg.isCritical).toBe(false)
  })

  it('maps constraints, milestones, status and WBS path', () => {
    expect(byCode('A1040')).toMatchObject({ constraintType: 'SNET', constraintDate: '2026-04-01', isCritical: true })
    expect(byCode('A1060')).toMatchObject({ constraintType: 'FNLT', constraintDate: '2026-04-15' })
    expect(byCode('A1070')).toMatchObject({ constraintType: 'FO', constraintDate: '2026-06-30', activityType: 'milestone', milestoneKind: 'finish' })
    expect(byCode('A1000')).toMatchObject({ activityType: 'milestone', milestoneKind: 'start' })
    expect(byCode('A1000')).toMatchObject({ activityType: 'milestone', status: 'complete', percentComplete: 100 })
    expect(byCode('A1010')).toMatchObject({ status: 'complete', actualFinish: '2026-03-06', constraintType: null })
    expect(byCode('A1030').wbs).toBe('SITE.FDN Foundations')
    expect(byCode('A1050').wbs).toBe('STR Structure')
  })

  it('parses LF-only files identically', () => {
    const lf = parseXER(xer.replace(/\r\n/g, '\n'), 'sched-1')
    expect(lf.activities.map(a => [a.activityId, a.duration, a.calendarId])).toEqual(parsed.activities.map(a => [a.activityId, a.duration, a.calendarId]))
    expect(lf.relationships).toHaveLength(8)
  })

  it('parses nested clndr_data trees', () => {
    const tree = parseClndrData('(0||CalendarData()(  (0||DaysOfWeek()(  (0||2()(  (0||0(s|08:00|f|16:00)())))  ))))')!
    expect(tree.name).toBe('CalendarData')
    expect(tree.children[0].name).toBe('DaysOfWeek')
    expect(tree.children[0].children[0].children[0].attrs).toBe('s|08:00|f|16:00')
  })
})
