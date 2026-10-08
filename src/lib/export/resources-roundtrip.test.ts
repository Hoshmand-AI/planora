import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Schedule } from '@/lib/db'
import type { ResourceData } from '@/lib/planning/resource-types'
import { parseXER } from '@/lib/parsers/xer-parser'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { parseSpreadsheet } from '@/lib/parsers/excel-parser'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import type { ParsedSchedule } from '@/lib/parsers/types'
import { exportXer } from './xer'
import { exportMspXml } from './msp-xml'

// Resources and assignments survive P6 → Planora → P6 / MS Project → Planora: the exporters write
// RSRC / RSRCRATE / TASKRSRC and <Resources> / <Assignments>, the parsers read them back.

const sample = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'latin1')
const TABLES = [
  '%T\tUMEASURE', '%F\tunit_id\tunit_abbrev\tunit_name', '%R\t1\tt\tTonne',
  '%T\tRSRC', '%F\trsrc_id\tclndr_id\trsrc_short_name\trsrc_name\trsrc_type\tunit_id',
  '%R\t801\t100\tCONC\tConcrete Crew\tRT_Labor\t', '%R\t802\t200\tEXC\tExcavator\tRT_Equip\t', '%R\t803\t\tREBAR\tRebar\tRT_Mat\t1', '%R\t804\t\tIDLE\tUnused resource\tRT_Labor\t',
  '%T\tRSRCRATE', '%F\trsrc_rate_id\trsrc_id\tmax_qty_per_hr\tcost_per_qty\tstart_date',
  '%R\t1\t801\t2\t95\t2026-01-01 00:00', '%R\t2\t802\t1\t180\t2026-01-01 00:00',
  '%T\tTASKRSRC', '%F\ttaskrsrc_id\ttask_id\tproj_id\trsrc_id\tremain_qty\ttarget_qty\tact_reg_qty\tact_ot_qty\ttarget_qty_per_hr\tremain_qty_per_hr',
  '%R\t901\t1002\t1\t801\t0\t40\t36\t4\t1\t',
  '%R\t902\t1003\t1\t802\t60\t100\t40\t\t1\t1',
  '%R\t903\t1004\t1\t801\t128\t128\t\t\t2\t2',
  '%R\t904\t1004\t1\t803\t12\t12\t\t\t\t',
  '%R\t905\t1005\t1\t801\t80\t80\t\t\t\t',
]
const xerWithResources = () => sample.replace('%E', TABLES.join('\n') + '\n%E')

/** Comparable view: resources by code, assignments by activity code + resource code. */
function view(p: ParsedSchedule) {
  const r = p.resources!
  const code = new Map(r.resources.map(x => [x.id, x.code]))
  const act = new Map(p.activities.map(a => [a.id, a.activityId]))
  return {
    resources: r.resources.map(x => ({ code: x.code, name: x.name, kind: x.kind, max: x.maxUnitsPerHour ?? null })).sort((a, b) => a.code.localeCompare(b.code)),
    assignments: r.assignments.map(a => ({ act: act.get(a.activityId), res: code.get(a.resourceId), budget: a.budgetUnits, actual: a.actualUnits, remaining: a.remainingUnits, uph: a.unitsPerHour ?? null }))
      .sort((a, b) => `${a.act}${a.res}`.localeCompare(`${b.act}${b.res}`)),
  }
}

function generated(p: ParsedSchedule, resources: ResourceData | null | undefined) {
  const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy })
  const schedule = { id: 's', name: p.projectName, version: 'Update 1', fileName: 'r.xer', uploadedAt: '2026-10-01', projectStart: done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
  return uploadedToGenerated(schedule, done.activities, p.relationships, done.cpm, null, [], { resources })
}

describe('resource parsing', () => {
  it('reads P6 RSRC, RSRCRATE, UMEASURE and TASKRSRC', () => {
    const p = parseXER(xerWithResources(), 'x')
    const v = view(p)
    // Only resources with assignments; the unused one is left out.
    expect(v.resources).toEqual([
      { code: 'CONC', name: 'Concrete Crew', kind: 'labor', max: 2 },
      { code: 'EXC', name: 'Excavator', kind: 'nonlabor', max: 1 },
      { code: 'REBAR', name: 'Rebar', kind: 'material', max: null },
    ])
    expect(p.resources!.resources.find(r => r.code === 'REBAR')!.unit).toBe('t')
    expect(p.resources!.resources.find(r => r.code === 'EXC')!.calendarId).toBe('200')
    expect(v.assignments).toEqual([
      { act: 'A1010', res: 'CONC', budget: 40, actual: 40, remaining: 0, uph: 1 },
      { act: 'A1020', res: 'EXC', budget: 100, actual: 40, remaining: 60, uph: 1 },
      { act: 'A1030', res: 'CONC', budget: 128, actual: 0, remaining: 128, uph: 2 },
      { act: 'A1030', res: 'REBAR', budget: 12, actual: 0, remaining: 12, uph: null },
      { act: 'A1040', res: 'CONC', budget: 80, actual: 0, remaining: 80, uph: null },
    ])
    expect(p.warnings.join(' ')).not.toMatch(/TASKRSRC \(/)
  })

  it('a file without resources has none (nothing is invented)', () => {
    expect(parseXER(sample, 's').resources).toBeNull()
    const xml = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample-msp.xml'), 'utf8')
    expect(parseMSProjectXML(xml, 'm').resources).toBeNull()
  })

  it('reads spreadsheet resource columns (names, MS Project brackets, budgeted units)', async () => {
    const csv = [
      'Activity ID,Activity Name,Original Duration,Start,Finish,Predecessors,Resource Names,Budgeted Units',
      'A100,Formwork,5,2026-03-02,2026-03-06,,Carpenters[200%],80',
      'A110,Rebar,3,2026-03-09,2026-03-11,A100,Ironworkers; Laborers,48',
      'A120,Pour,1,2026-03-12,2026-03-12,A110,Laborers,',
    ].join('\n')
    const p = await parseSpreadsheet(Buffer.from(csv), 'r.csv', 'c')
    const v = view(p)
    expect(v.resources.map(r => r.code)).toEqual(['Carpenters', 'Ironworkers', 'Laborers'])
    expect(v.assignments).toEqual([
      { act: 'A100', res: 'Carpenters', budget: 80, actual: 0, remaining: 80, uph: 2 },
      { act: 'A110', res: 'Ironworkers', budget: 24, actual: 0, remaining: 24, uph: null },
      { act: 'A110', res: 'Laborers', budget: 24, actual: 0, remaining: 24, uph: null },
      // No units: one unit for the whole duration, 8 hours a day (stated in the notes).
      { act: 'A120', res: 'Laborers', budget: 8, actual: 0, remaining: 8, uph: null },
    ])
    expect(p.resources!.notes.join(' ')).toMatch(/split evenly/)
    expect(p.resources!.notes.join(' ')).toMatch(/8 hours a day/)
  })
})

describe('resource round trip', () => {
  it('P6 → Planora → P6 (.xer rebuilt from Planora\'s model) keeps resources and assignments', () => {
    const p = parseXER(xerWithResources(), 'x')
    const g = generated(p, p.resources)
    expect(g.resources!.assignments).toHaveLength(5)
    const xer = exportXer(g, 'Riverside Warehouse', { now: new Date('2026-10-01T00:00:00Z') })
    expect(xer).toMatch(/%T\tRSRC\r\n/)
    expect(xer).toMatch(/%T\tTASKRSRC\r\n/)
    const back = parseXER(xer, 'y')
    expect(view(back)).toEqual(view(p))
  })

  it('P6 → Planora → MS Project XML → Planora keeps resources and assignments', () => {
    const p = parseXER(xerWithResources(), 'x')
    const xml = exportMspXml(generated(p, p.resources), 'Riverside Warehouse')
    expect(xml).toContain('<Resources>')
    expect(xml).toContain('<Assignments>')
    const back = parseMSProjectXML(xml, 'z')
    expect(view(back)).toEqual(view(p))
    // MS Project → Planora → P6 as well.
    const again = parseXER(exportXer(generated(back, back.resources), 'Riverside Warehouse'), 'w')
    expect(view(again)).toEqual(view(p))
  })

  it('a schedule without resources exports no resource tables', () => {
    const p = parseXER(sample, 's')
    const g = generated(p, null)
    expect(exportXer(g, 'R')).not.toMatch(/%T\t(RSRC|TASKRSRC)\r\n/)
    expect(exportMspXml(g, 'R')).not.toContain('<Assignments>')
  })
})
