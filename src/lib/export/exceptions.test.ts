import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { parseXER } from '@/lib/parsers/xer-parser'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import type { Schedule } from '@/lib/db'
import { exportExceptions } from './exceptions'
import { exportImportXlsx } from './xlsx'
import { planoraRelease, type Provenance } from './provenance'
import { exceptionHeader } from '@/lib/parsers/exceptions'

// The equivalence fixture: two calendars (one with an added Saturday work day), constraints including a
// secondary one, a level-of-effort activity, activity codes, UDFs and resources.
const parsed = parseXER(readFileSync(path.join(__dirname, '..', 'parsers', '__fixtures__', 'p6-equivalence.xer'), 'utf8'), 's')
const done = completeSchedule({
  activities: parsed.activities, relationships: parsed.relationships, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
  projectStart: parsed.projectStart, projectFinish: parsed.projectFinish, dataDate: parsed.dataDate, mustFinishBy: parsed.mustFinishBy ?? null,
})
const schedule = {
  id: 's', name: 'EQ-1', version: 'Update 1', fileName: 'eq.xer', uploadedAt: '2026-03-16T00:00:00Z', projectStart: parsed.projectStart, dataDate: parsed.dataDate,
  calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
} as unknown as Schedule
const analysis = { mustFinishBy: parsed.mustFinishBy } as never
const g = uploadedToGenerated(schedule, done.activities, parsed.relationships, done.cpm, analysis)
const gLoe = uploadedToGenerated(schedule, done.activities, parsed.relationships, done.cpm, analysis, [], { includeLoe: true })
const excluded = done.activities.filter(a => a.activityType === 'loe' || a.activityType === 'summary').map(a => ({ code: a.activityId, type: a.activityType === 'loe' ? 'loe' as const : 'summary' as const }))
const ctx = { importReport: parsed.exceptions, excluded, progressMode: 'retained' as const }
const rec = (r: ReturnType<typeof exportExceptions>, field: string) => r.records.find(x => x.field === field)

describe('export exception reports', () => {
  it('carries what was never imported into every rebuilt format', () => {
    for (const f of ['xer', 'xml', 'csv', 'xlsx-import', 'xlsx-p6'] as const) {
      const r = exportExceptions(f === 'xml' ? gLoe : g, f, ctx)
      expect(r.direction).toBe('export')
      expect(r.format).toBe(f)
      expect(rec(r, 'UDFVALUE'), f).toMatchObject({ entity: 'udf', disposition: 'dropped', count: 2 })
      expect(rec(r, 'TASK.cstr_type2'), f).toMatchObject({ entity: 'constraint', severity: 'loss' })
    }
  })

  it('the pass-through P6 export of an uploaded XER drops nothing', () => {
    expect(exportExceptions(g, 'xer-original', ctx).records).toEqual([])
  })

  it('XER: added work days and level of effort are reported, holidays are not', () => {
    const r = exportExceptions(g, 'xer', ctx)
    expect(rec(r, 'CALENDAR.clndr_data (extra work days)')).toMatchObject({ entity: 'calendar', severity: 'loss', count: 1, examples: ['5 Day x 8h (US Holidays): 2026-03-14'] })
    expect(rec(r, 'Level of effort activities')).toMatchObject({ count: 1, examples: ['A1080'] })
    expect(rec(r, 'CALENDAR.clndr_data (work times)')).toMatchObject({ disposition: 'converted', examples: ['7 Day x 10h Earthwork'] })
  })

  it('MS Project XML: Finish On is converted, LOE kept as a task, the required finish becomes a Deadline', () => {
    const r = exportExceptions(gLoe, 'xml', ctx)
    expect(rec(r, 'ConstraintType (Start On / Finish On)')).toMatchObject({ disposition: 'converted', examples: ['A1070 (FO)'] })
    expect(rec(r, 'Level of effort')).toMatchObject({ disposition: 'converted', examples: ['A1080'] })
    expect(rec(r, 'Level of effort activities')).toBeUndefined()
    expect(rec(r, 'Must Finish By')).toMatchObject({ disposition: 'converted' })
    expect(rec(r, 'PredecessorLink.LinkLag')).toMatchObject({ entity: 'relationship', count: 3, examples: ['A1020 -> A1030', 'A1030 -> A1060', 'A1060 -> A1070'] })
  })

  it('CSV: calendars, constraints and the required finish are reported as lost', () => {
    const r = exportExceptions(g, 'csv', ctx)
    expect(rec(r, 'Calendars')).toMatchObject({ severity: 'loss', count: 2 })
    expect(rec(r, 'Constraints')).toMatchObject({ severity: 'loss', count: 3 })
    expect(rec(r, 'Must Finish By')).toMatchObject({ severity: 'loss', examples: ['2026-07-31'] })
    expect(rec(r, 'Activity calendar')).toMatchObject({ examples: ['A1020', 'A1060'] })
  })

  it('XLSX: the report is written into the Provenance sheet (dates MM/DD/YYYY)', async () => {
    const exceptions = exportExceptions(g, 'xlsx-import', ctx)
    const prov: Provenance = {
      sources: [{ scheduleName: 'EQ-1', version: 'Update 1', fileName: 'eq.xer', sha256: 'abc', dataDate: '2026-03-16', progressMode: 'retained' }],
      release: planoraRelease({}), settings: ['CPM'], generatedAt: '2026-03-16T00:00:00.000Z', exceptions,
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportImportXlsx(g, 'EQ-1', { prov }) as unknown as ArrayBuffer)
    const values: string[] = []
    wb.getWorksheet('Provenance')!.eachRow(row => values.push(`${row.getCell(1).value ?? ''}|${row.getCell(2).value ?? ''}`))
    const start = values.findIndex(v => v.startsWith('Export exceptions'))
    expect(start).toBeGreaterThan(0)
    const lines = values.slice(start).map(v => v.split('|')[1]).join('\n')
    expect(lines).toMatch(/Not carried over · calendar · Calendars · 2/)
    expect(lines).toMatch(/Progress \(actual dates, % complete, remaining\)/)
    expect(lines).toMatch(/Must Finish By · 1 \(e\.g\. 07\/31\/2026\)/)
    expect(lines).not.toMatch(/2026-07-31/)
  })

  it('fits an HTTP header', () => {
    const h = exceptionHeader(exportExceptions(g, 'csv', ctx))
    expect(h.length).toBeLessThanOrEqual(3500)
    expect(JSON.parse(h).summary.losses).toBeGreaterThan(0)
  })
})
