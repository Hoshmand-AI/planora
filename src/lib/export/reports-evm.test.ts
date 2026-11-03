import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import type { Relationship, Schedule } from '@/lib/db'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { mspCostData } from '@/lib/parsers/costs'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { runDcma } from '@/lib/analysis/dcma'
import { analyzableFromDb } from '@/lib/planning/service'
import { applyBaseline, resolveBaseline } from '@/lib/analysis/baseline'
import { computeEvm } from '@/lib/analysis/evm'
import { costByCode } from '@/lib/planning/evm-service'
import { buildReport, reportSupplement } from './reports'
import { exportEvmXlsx } from './analysis-xlsx'
import type { Provenance } from './provenance'

const xml = readFileSync(path.join(__dirname, '..', 'parsers', '__fixtures__', 'evm-costs-msp.xml'), 'utf8')
const parsed = parseMSProjectXML(xml, 's')
const rels: Relationship[] = parsed.relationships
const schedule = { id: 's', name: 'EVM Fixture', version: 'Update 1', dataDate: parsed.dataDate, projectStart: parsed.projectStart, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId, warnings: [] } as unknown as Schedule
const done = completeSchedule({ activities: parsed.activities, relationships: rels, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId, projectStart: parsed.projectStart, projectFinish: null, dataDate: parsed.dataDate })
const baseline = resolveBaseline({ activities: done.activities })
const activities = applyBaseline(done.activities, baseline)
const analysis = analyzeSchedule({ activities, links: rels.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: null, mustFinishBy: null, baseline })
const dcma = runDcma(analyzableFromDb(schedule, activities, rels))
const cost = costByCode(mspCostData(xml)!, activities)
const bb = { byCode: Object.fromEntries(Object.entries(cost.byCode).map(([k, r]) => [k, r.baselineBudget ?? 0])), basis: "the file's MS Project Baseline Cost" }
const evm = computeEvm({ scheduleId: 's', version: 'Update 1', dataDate: parsed.dataDate, activities, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId, baseline: { source: baseline.source, header: baseline.header }, cost, baselineBudget: bb })
const input = { schedule, activities, relationships: rels, analysis, dcma }

describe('earned value in reports and the XLSX export', () => {
  it('adds one earned value section to the variance and executive reports when available', () => {
    expect(evm.status).toBe('available')
    const v = buildReport('variance', { ...input, evm })
    expect(v.match(/^## Earned value/gm)).toHaveLength(1)
    expect(v).toMatch(/\| CPI = EV ÷ AC \| 0\.94 \|/)
    expect(v).toMatch(/ANSI\/EIA-748/)
    expect(buildReport('executive_summary', { ...input, evm })).toMatch(/## Earned value/)
    expect(reportSupplement('variance', { ...input, evm })).toMatch(/## Earned value/)
    expect(buildReport('critical_path', { ...input, evm })).not.toMatch(/## Earned value/)
  })

  it('omits the section when earned value is not available', () => {
    const na = computeEvm({ scheduleId: 's', version: 'Update 1', dataDate: parsed.dataDate, activities, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId, baseline: { source: 'none', header: 'Baseline: none.' }, cost, baselineBudget: null })
    expect(na.status).toBe('not_available')
    expect(buildReport('variance', { ...input, evm: na })).not.toMatch(/Earned value/)
    expect(buildReport('variance', input)).not.toMatch(/Earned value/)
  })

  it('writes the earned value workbook with its sheets', async () => {
    const prov = { generatedAt: '2026-03-16T00:00:00Z', release: 'test', sources: [], settings: [] } as unknown as Provenance
    const buf = await exportEvmXlsx(evm, prov, 'EVM Fixture', null, null)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
    const names = wb.worksheets.map(w => w.name)
    expect(names).toEqual(expect.arrayContaining(['Earned value', 'Methods', 'By WBS', 'Activities', 'Integrity checks', 'Notes']))
    const ev = wb.getWorksheet('Earned value')!
    const rows = ev.getSheetValues().filter(Boolean) as unknown[][]
    expect(rows.some(r => r[1] === 'SPI = EV ÷ PV' && r[2] === 0.8)).toBe(true)
  })
})
