import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseMSProjectXML, mspDurationHours } from './xml-parser'

const xml = readFileSync(path.join(__dirname, '__fixtures__', 'sample-msp.xml'), 'utf8')
const parsed = parseMSProjectXML(xml, 'sched-2')
const byName = (n: string) => {
  const a = parsed.activities.find(x => x.name === n)
  if (!a) throw new Error(`missing ${n}`)
  return a
}
const rel = (p: string, s: string) => parsed.relationships.find(r => r.predecessorId === byName(p).id && r.successorId === byName(s).id)

describe('parseMSProjectXML', () => {
  it('takes the project-level title and dates', () => {
    expect(parsed.sourceType).toBe('ms_xml')
    expect(parsed.projectName).toBe('Riverside Clinic & MOB')
    expect(parsed.projectStart).toBe('2026-03-02')
    expect(parsed.projectFinish).toBe('2026-04-10')
    expect(parsed.dataDate).toBe('2026-03-09')
  })

  it('excludes the project summary task and null tasks; marks other summaries', () => {
    expect(parsed.activities.map(a => a.sourceId)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(byName('Site Work').activityType).toBe('summary')
    expect(byName('Notice to Proceed').activityType).toBe('milestone')
    expect(byName('Clear & Grub Site').activityId).toBe('A3')
  })

  it('parses calendars: week days, working hours, exceptions (both styles)', () => {
    expect(parsed.calendars.map(c => c.id)).toEqual(['1', '2']) // resource calendar excluded
    const std = parsed.calendars[0]
    expect(std.name).toBe('Standard')
    expect(std.workDays).toEqual([1, 2, 3, 4, 5])
    expect(std.hoursPerDay).toBe(8)
    expect(std.holidays).toEqual(['2026-05-25', '2026-07-03', '2026-12-24', '2026-12-25'])
    const fourTen = parsed.calendars[1]
    expect(fourTen.workDays).toEqual([1, 2, 3, 4])
    expect(fourTen.hoursPerDay).toBe(10)
    expect(parsed.defaultCalendarId).toBe('1')
  })

  it('assigns calendarId and converts durations with the task calendar hours (minutes included)', () => {
    const grading = byName('Rough Grading')
    expect(grading.calendarId).toBe('2')
    expect(grading.duration).toBe(2.05) // 20.5h on a 10h calendar
    const clear = byName('Clear & Grub Site')
    expect(clear.calendarId).toBe('1')
    expect(clear.duration).toBe(5)
    expect(clear.remainingDuration).toBe(2)
    expect(clear.status).toBe('in_progress')
    expect(clear.baselineStart).toBe('2026-03-02')
    expect(clear.lateFinish).toBe('2026-03-10')
  })

  it('reads slack in tenths of minutes and the Critical flag', () => {
    const clear = byName('Clear & Grub Site')
    expect(clear.totalFloat).toBe(2)
    expect(clear.freeFloat).toBe(1)
    expect(clear.isCritical).toBe(false)
    expect(byName('Underground Utilities').totalFloat).toBe(-0.5)
    expect(byName('Underground Utilities').isCritical).toBe(true)
  })

  it('maps constraints', () => {
    expect(byName('Rough Grading')).toMatchObject({ constraintType: 'SNET', constraintDate: '2026-03-10' })
    expect(byName('Site Work Complete')).toMatchObject({ constraintType: 'FNLT', constraintDate: '2026-03-20' })
    expect(byName('Clear & Grub Site').constraintType).toBeNull()
  })

  it('resolves predecessor links to uuids with types and lags', () => {
    const ids = new Set(parsed.activities.map(a => a.id))
    expect(parsed.relationships).toHaveLength(5)
    for (const r of parsed.relationships) {
      expect(ids.has(r.predecessorId) && ids.has(r.successorId)).toBe(true)
    }
    expect(rel('Notice to Proceed', 'Clear & Grub Site')).toMatchObject({ type: 'FS', lag: 0 })
    expect(rel('Clear & Grub Site', 'Rough Grading')).toMatchObject({ type: 'SS', lag: 0.8 }) // 480 min on a 10h calendar
    expect(rel('Rough Grading', 'Underground Utilities')).toMatchObject({ type: 'FF', lag: -1 })
    expect(rel('Rough Grading', 'Site Work Complete')).toMatchObject({ type: 'SF', lag: 2 })
    expect(parsed.warnings.some(w => w.includes('99') && w.includes('cross-project'))).toBe(true)
  })

  it('parses MSPDI durations', () => {
    expect(mspDurationHours('PT8H30M0S', 8)).toBe(8.5)
    expect(mspDurationHours('P1DT2H0M0S', 8)).toBe(10)
    expect(mspDurationHours('-PT4H0M0S', 8)).toBe(-4)
  })
})
