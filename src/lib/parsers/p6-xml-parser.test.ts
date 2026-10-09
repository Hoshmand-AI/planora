import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseXER } from './xer-parser'
import { parseP6Xml } from './p6-xml-parser'
import { parseScheduleFile } from './index'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import type { ParsedSchedule } from './types'

const fixtures = path.join(__dirname, '__fixtures__')
const xerText = readFileSync(path.join(fixtures, 'p6-equivalence.xer'), 'utf8')
const xmlText = readFileSync(path.join(fixtures, 'p6-equivalence.xml'), 'utf8')
const xer = parseXER(xerText, 's')
const xml = parseP6Xml(xmlText, 's')

/** Activities without the per-parse uuid, keyed by activity id. */
const acts = (p: ParsedSchedule) => Object.fromEntries(p.activities.map(({ id: _id, ...a }) => [a.activityId, a]))
/** Relationships by activity ids instead of uuids. */
const rels = (p: ParsedSchedule) => {
  const code = new Map(p.activities.map(a => [a.id, a.activityId]))
  return p.relationships.map(r => `${code.get(r.predecessorId)}>${code.get(r.successorId)} ${r.type} ${r.lag}`).sort()
}
const cpmOf = (p: ParsedSchedule) => completeSchedule({
  activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId,
  projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy ?? null, progressMode: p.progressMode ?? 'retained',
})

describe('parseP6Xml: same project as XER', () => {
  it('reads the project header like the XER parser', () => {
    expect(xml.sourceType).toBe('p6_xml')
    for (const k of ['projectName', 'projectKey', 'dataDate', 'projectStart', 'projectFinish', 'mustFinishBy', 'defaultCalendarId', 'progressMode'] as const) {
      expect(xml[k], k).toEqual(xer[k])
    }
    expect(xml.projectName).toBe('EQ-1')
    expect(xml.dataDate).toBe('2026-03-16')
    expect(xml.mustFinishBy).toBe('2026-07-31')
  })

  it('parses identical activities (types, durations, dates, progress, calendars, constraints, WBS, float)', () => {
    expect(xml.activities).toHaveLength(9)
    expect(acts(xml)).toEqual(acts(xer))
    const a = acts(xml)
    expect(a['A1000']).toMatchObject({ activityType: 'milestone', milestoneKind: 'start', status: 'complete' })
    expect(a['A1070']).toMatchObject({ activityType: 'milestone', milestoneKind: 'finish', constraintType: 'FO', constraintDate: '2026-06-30' })
    expect(a['A1080'].activityType).toBe('loe')
    expect(a['A1020']).toMatchObject({ percentComplete: 40, duration: 10, remainingDuration: 6, calendarId: '200', status: 'in_progress', isCritical: true })
    expect(a['A1030']).toMatchObject({ wbs: 'SITE.FDN Foundations', totalFloat: 2, freeFloat: 1 })
    expect(a['A1040']).toMatchObject({ constraintType: 'SNET', constraintDate: '2026-04-01' })
    expect(a['A1060']).toMatchObject({ constraintType: 'FNLT', duration: 7 })
    expect(a['A1010'].name).toBe('Mobilize & Site Setup')
  })

  it('parses identical relationships (type and lag on the predecessor calendar)', () => {
    expect(rels(xml)).toEqual(rels(xer))
    expect(rels(xml)).toContain('A1020>A1030 SS 1.6')
    expect(rels(xml)).toContain('A1030>A1060 FF 2.5')
  })

  it('parses identical calendars (work week, hours, holidays, extra work days, work times)', () => {
    expect(xml.calendars).toEqual(xer.calendars)
    const five = xml.calendars.find(c => c.id === '100')!
    expect(five).toMatchObject({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: ['2026-05-15', '2026-07-03'], extraWorkDays: ['2026-03-14'] })
    expect(five.workTimes).toEqual([{ from: '08:00', to: '12:00' }, { from: '13:00', to: '17:00' }])
    expect(xml.calendars.find(c => c.id === '200')!.workDays).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('gives the same CPM result (finish, dates and float of every activity)', () => {
    const a = cpmOf(xer), b = cpmOf(xml)
    expect(a.cpm).not.toBeNull()
    expect(b.projectFinish).toBe(a.projectFinish)
    expect(b.cpm!.projectFinish).toBe(a.cpm!.projectFinish)
    const byCode = (r: ReturnType<typeof cpmOf>) => Object.fromEntries(r.activities.map(x => [x.activityId, [x.earlyStart, x.earlyFinish, x.lateStart, x.lateFinish, x.totalFloat]]))
    expect(byCode(b)).toEqual(byCode(a))
  })

  it('counts resource assignments per activity like XER TASKRSRC', () => {
    expect(xml.resourceCounts).toEqual(xer.resourceCounts)
    expect(xml.resourceCounts!['1003']).toBe(1)
  })

  it('lists activity codes, UDFs, resources and unmapped fields in the exception report', () => {
    const r = xml.exceptions!
    expect(r.direction).toBe('import')
    expect(r.format).toBe('p6_xml')
    const find = (field: string) => r.records.find(x => x.field === field)
    expect(find('Activity.Code')).toMatchObject({ entity: 'code', count: 3, disposition: 'dropped' })
    expect(find('Activity.UDF')).toMatchObject({ entity: 'udf', count: 2 })
    // Resources, rates and assignments are read (resource analysis, earned value), so not listed as unused.
    expect(find('Resource')).toBeUndefined()
    expect(find('ResourceRate')).toBeUndefined()
    expect(find('ResourceAssignment')).toBeUndefined()
    expect(xml.resources?.assignments).toHaveLength(3)
    expect(find('ActivityCodeType')).toMatchObject({ entity: 'code', count: 1 })
    expect(find('UDFType')).toMatchObject({ entity: 'udf', count: 1 })
    expect(find('Activity.SecondaryConstraintType')).toMatchObject({ entity: 'constraint', severity: 'loss', examples: ['A1040 (Finish On or Before)'] })
    expect(find('Activity.DurationType')).toMatchObject({ entity: 'activity', count: 9 })
    expect(find('Activity.PhysicalPercentComplete')).toMatchObject({ disposition: 'converted' })
  })
})

describe('parseP6Xml: projects and errors', () => {
  const wrap = (body: string) => `<?xml version="1.0"?><APIBusinessObjects>${body}</APIBusinessObjects>`
  const act = (oid: number, id: string) => `<Activity><ObjectId>${oid}</ObjectId><Id>${id}</Id><Name>${id}</Name><PlannedDuration>8</PlannedDuration><RemainingDuration>8</RemainingDuration><Type>Task Dependent</Type><Status>Not Started</Status></Activity>`

  it('imports the requested project, else the first with activities, and reports the others', () => {
    const doc = wrap(`<Project><Id>EMPTY</Id><ObjectId>1</ObjectId></Project><Project><Id>P2</Id><ObjectId>2</ObjectId>${act(10, 'B1')}</Project><Project><Id>P3</Id><ObjectId>3</ObjectId>${act(20, 'C1')}${act(21, 'C2')}</Project>`)
    const first = parseP6Xml(doc, 's')
    expect(first.projectName).toBe('P2')
    expect(first.activities.map(a => a.activityId)).toEqual(['B1'])
    expect(first.warnings.some(w => w.includes('3 projects') && w.includes('"P3"'))).toBe(true)
    expect(first.exceptions!.records.find(r => r.field === 'Project')).toMatchObject({ entity: 'project', count: 2, examples: ['EMPTY', 'P3'] })
    expect(first.exceptions!.records.find(r => r.field === 'Activity (other projects)')).toMatchObject({ count: 2 })
    const chosen = parseP6Xml(doc, 's', { projectId: 'P3' })
    expect(chosen.activities.map(a => a.activityId)).toEqual(['C1', 'C2'])
  })

  it('uses the current baseline project as the embedded baseline', () => {
    const doc = wrap(`<Project><Id>P</Id><ObjectId>1</ObjectId><CurrentBaselineProjectObjectId>9</CurrentBaselineProjectObjectId>${act(10, 'A1')}</Project>
      <BaselineProject><Id>P-BL1</Id><ObjectId>9</ObjectId><Activity><Id>A1</Id><PlannedStartDate>2026-01-05T08:00:00</PlannedStartDate><PlannedFinishDate>2026-01-09T17:00:00</PlannedFinishDate><Type>Task Dependent</Type></Activity></BaselineProject>`)
    const p = parseP6Xml(doc, 's')
    expect(p.embeddedBaseline).toMatchObject({ name: 'P-BL1', starts: { A1: '2026-01-05' }, finishes: { A1: '2026-01-09' } })
  })

  it('rejects empty, malformed and activity-less files with a clear message', async () => {
    await expect(parseScheduleFile('p6.xml', Buffer.from(''), 's')).rejects.toThrow(/empty/)
    await expect(parseScheduleFile('p6.xml', Buffer.from('<APIBusinessObjects><Project><Id>X</Id></APIBusinessObjects>'), 's')).rejects.toThrow(/not well-formed/)
    await expect(parseScheduleFile('p6.xml', Buffer.from(wrap('<Project><Id>X</Id></Project>')), 's')).rejects.toThrow(/no activities/)
    await expect(parseScheduleFile('p6.xml', Buffer.from(wrap('<Calendar><ObjectId>1</ObjectId></Calendar>')), 's')).rejects.toThrow(/no <Project>/)
  })

  it('is routed by the upload entry point for .xml files', async () => {
    const p = await parseScheduleFile('Equivalence.xml', Buffer.from(xmlText), 's')
    expect(p.sourceType).toBe('p6_xml')
    expect(p.activities).toHaveLength(9)
  })
})
