import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { parseSpreadsheet, parseCsv, parseDurationDays, parseDateCell, predCandidates } from './excel-parser'
import { parseScheduleFile } from './index'
import type { ParsedSchedule } from './types'

const fixtures = path.join(__dirname, '__fixtures__')

function helpers(p: ParsedSchedule) {
  const byCode = (c: string) => {
    const a = p.activities.find(x => x.activityId === c)
    if (!a) throw new Error(`missing ${c}`)
    return a
  }
  const rel = (from: string, to: string) => p.relationships.filter(r => r.predecessorId === byCode(from).id && r.successorId === byCode(to).id)
  return { byCode, rel }
}

describe('CSV primitives', () => {
  it('parses RFC 4180 quoting, escaped quotes, embedded newlines and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,"x\ny",3\r\n')).toEqual([['a', 'b,c', 'd "e"'], ['1', 'x\ny', '3']])
    expect(parseCsv('﻿a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('parses durations', () => {
    expect(parseDurationDays('10d')).toBe(10)
    expect(parseDurationDays('10')).toBe(10)
    expect(parseDurationDays('80h')).toBe(10)
    expect(parseDurationDays('2w')).toBe(10)
    expect(parseDurationDays('1.5 days')).toBe(1.5)
    expect(parseDurationDays('-3d')).toBe(-3)
    expect(parseDurationDays('5 days?')).toBe(5)
    expect(parseDurationDays('')).toBeNull()
  })
  it('parses dates in export styles', () => {
    expect(parseDateCell(new Date(Date.UTC(2026, 2, 2)))).toBe('2026-03-02')
    expect(parseDateCell(46083)).toBe('2026-03-02')
    expect(parseDateCell('2026-03-02T08:00:00')).toBe('2026-03-02')
    expect(parseDateCell('3/2/2026')).toBe('2026-03-02')
    expect(parseDateCell('01-Mar-26')).toBe('2026-03-01')
    expect(parseDateCell('01-Mar-26 08:00 A')).toBe('2026-03-01')
    expect(parseDateCell('Mon 3/2/26')).toBe('2026-03-02')
    expect(parseDateCell('Mon 3/2/26 8:00 AM')).toBe('2026-03-02')
    expect(parseDateCell('March 2, 2026')).toBe('2026-03-02')
    expect(parseDateCell('2/30/2026')).toBeNull()
  })
  it('interprets predecessor tokens', () => {
    expect(predCandidates('12FS+3d')[0]).toEqual({ ref: '12', type: 'FS', lag: 3 })
    expect(predCandidates('14SS')[0]).toEqual({ ref: '14', type: 'SS', lag: 0 })
    expect(predCandidates('A1010 SS')[0]).toEqual({ ref: 'A1010', type: 'SS', lag: 0 })
    expect(predCandidates('A1010: FF 5')[0]).toEqual({ ref: 'A1010', type: 'FF', lag: 5 })
    expect(predCandidates('A1010FS-2 days')[0]).toEqual({ ref: 'A1010', type: 'FS', lag: -2 })
    expect(predCandidates('A1000').pop()).toEqual({ ref: 'A1000', type: 'FS', lag: 0 })
  })
})

describe('parseSpreadsheet (CSV with messy headers)', async () => {
  const buf = readFileSync(path.join(fixtures, 'messy-export.csv'))
  const p = await parseSpreadsheet(buf, 'messy-export.csv', 'sched-3')
  const { byCode, rel } = helpers(p)

  it('finds the header row below title rows and maps synonyms', () => {
    expect(p.sourceType).toBe('csv')
    expect(p.projectName).toBe('messy-export')
    expect(p.activities.map(a => a.activityId)).toEqual(['A100', 'A110', 'A200', 'A210', 'A220', 'A230', 'A300'])
    expect(p.warnings.some(w => w.includes('Unrecognized columns') && w.includes('Phase'))).toBe(true)
  })

  it('parses durations, dates, float, status, milestones and WBS bands', () => {
    expect(byCode('A100')).toMatchObject({ activityType: 'milestone', duration: 0, actualStart: '2026-03-02' })
    expect(byCode('A110')).toMatchObject({ name: 'Submittals, Shop Drawings', duration: 15, totalFloat: 5, status: 'in_progress', earlyFinish: '2026-03-23', wbs: 'Preconstruction' })
    expect(byCode('A200')).toMatchObject({ earlyStart: '2026-03-02', earlyFinish: '2026-03-06', wbs: 'Sitework', isCritical: true })
    expect(byCode('A210')).toMatchObject({ name: 'Excavate "Area B"', duration: 10, totalFloat: -2, isCritical: true, earlyStart: '2026-03-09' })
    expect(byCode('A220')).toMatchObject({ duration: 10, earlyStart: '2026-03-19', earlyFinish: '2026-04-01' })
    expect(byCode('A230')).toMatchObject({ earlyStart: '2026-04-02', isCritical: false })
    expect(byCode('A300')).toMatchObject({ activityType: 'milestone', earlyFinish: '2026-04-07' })
    expect(p.projectStart).toBe('2026-03-02')
    expect(p.projectFinish).toBe('2026-04-07')
  })

  it('parses MSP- and P6-style predecessors into uuid relationships', () => {
    const ids = new Set(p.activities.map(a => a.id))
    expect(p.relationships).toHaveLength(8)
    for (const r of p.relationships) expect(ids.has(r.predecessorId) && ids.has(r.successorId)).toBe(true)
    expect(rel('A100', 'A200')[0]).toMatchObject({ type: 'FS', lag: 1 })
    expect(rel('A110', 'A210')[0]).toMatchObject({ type: 'SS', lag: 2 })
    expect(rel('A200', 'A210')[0]).toMatchObject({ type: 'FS', lag: 0 })
    expect(rel('A210', 'A220')[0]).toMatchObject({ type: 'FF', lag: -1 })
    expect(rel('A200', 'A220')[0]).toMatchObject({ type: 'SS', lag: 0 })
    expect(rel('A220', 'A230')[0]).toMatchObject({ type: 'FS', lag: 2 })
    expect(p.warnings.some(w => w.includes('Z999'))).toBe(true)
  })
})

async function buildXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const notes = wb.addWorksheet('Notes')
  notes.addRow(['This workbook was exported from the scheduling tool'])
  notes.addRow(['See the Schedule tab'])
  const ws = wb.addWorksheet('Schedule')
  ws.addRow(['Clinic Fit-out — Baseline'])
  ws.addRow([])
  ws.addRow(['ID', 'Task Name', 'Duration', 'Start Date', 'Finish Date', '% Complete', 'Predecessors', 'Type', 'Calendar', 'Primary Constraint', 'Primary Constraint Date', 'Resource Names'])
  const d = (m: number, day: number) => new Date(Date.UTC(2026, m - 1, day))
  ws.addRow([1, 'Start', '0 days', d(3, 2), d(3, 2), 1, '', 'Start Milestone', '5 Day', '', null, ''])
  ws.addRow([2, 'Design', '10d', d(3, 2), d(3, 13), 0.5, '1', 'Task', '5 Day', '', null, 'Architect'])
  ws.addRow([3, 'Permit review', '80h', d(3, 19), d(3, 28), 0, '2FS+3d', 'Task', '7 Day x 10h', 'Start On or After', d(3, 20), ''])
  ws.addRow([4, 'Procure steel', '2w', d(3, 4), d(3, 17), 0, '2SS+2 days, 3', 'Task', '5 Day', 'As Soon As Possible', null, ''])
  ws.addRow([5, 'Finish', 0, d(4, 1), d(4, 1), 0, '3FF;4FS-1d', 'Finish Milestone', '5 Day', '', null, ''])
  ws.getColumn(6).numFmt = '0%'
  ws.getColumn(4).numFmt = 'yyyy-mm-dd'
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('parseSpreadsheet (xlsx)', async () => {
  const buf = await buildXlsx()
  const p = await parseSpreadsheet(buf, 'clinic.xlsx', 'sched-4')
  const { byCode, rel } = helpers(p)

  it('picks the first worksheet with a recognizable header', () => {
    expect(p.sourceType).toBe('excel')
    expect(p.warnings.some(w => w.includes('"Schedule"'))).toBe(true)
    expect(p.activities).toHaveLength(5)
    expect(p.warnings.some(w => w.includes('Resource Names'))).toBe(true)
  })

  it('maps durations, Excel dates, percent fractions and types', () => {
    expect(p.activities.map(a => a.duration)).toEqual([0, 10, 10, 10, 0])
    expect(byCode('1')).toMatchObject({ activityType: 'milestone', percentComplete: 100, status: 'complete' })
    expect(byCode('2')).toMatchObject({ percentComplete: 50, status: 'in_progress', earlyStart: '2026-03-02', earlyFinish: '2026-03-13' })
    expect(byCode('5').activityType).toBe('milestone')
  })

  it('maps constraints and infers calendars from names', () => {
    expect(byCode('3')).toMatchObject({ constraintType: 'SNET', constraintDate: '2026-03-20', calendarId: '7 Day x 10h' })
    expect(byCode('4').constraintType).toBeNull()
    const seven = p.calendars.find(c => c.id === '7 Day x 10h')!
    expect(seven.workDays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(seven.hoursPerDay).toBe(10)
    expect(p.calendars.find(c => c.id === '5 Day')!.workDays).toEqual([1, 2, 3, 4, 5])
    expect(p.defaultCalendarId).toBe('5 Day')
  })

  it('resolves MSP-style predecessors by ID', () => {
    expect(p.relationships).toHaveLength(6)
    expect(rel('1', '2')[0]).toMatchObject({ type: 'FS', lag: 0 })
    expect(rel('2', '3')[0]).toMatchObject({ type: 'FS', lag: 3 })
    expect(rel('2', '4')[0]).toMatchObject({ type: 'SS', lag: 2 })
    expect(rel('3', '4')[0]).toMatchObject({ type: 'FS', lag: 0 })
    expect(rel('3', '5')[0]).toMatchObject({ type: 'FF', lag: 0 })
    expect(rel('4', '5')[0]).toMatchObject({ type: 'FS', lag: -1 })
  })
})

describe('parseScheduleFile', () => {
  it('dispatches on extension', async () => {
    const xer = await parseScheduleFile('Project.XER', readFileSync(path.join(fixtures, 'sample.xer')), 's')
    expect(xer.sourceType).toBe('p6_xer')
    const xml = await parseScheduleFile('p.xml', readFileSync(path.join(fixtures, 'sample-msp.xml')), 's')
    expect(xml.sourceType).toBe('ms_xml')
    const csv = await parseScheduleFile('x.csv', readFileSync(path.join(fixtures, 'messy-export.csv')), 's')
    expect(csv.sourceType).toBe('csv')
    const xlsx = await parseScheduleFile('x.xlsx', await buildXlsx(), 's')
    expect(xlsx.sourceType).toBe('excel')
  })
  it('rejects unsupported formats with helpful messages', async () => {
    await expect(parseScheduleFile('plan.mpp', Buffer.from('x'), 's')).rejects.toThrow(/export from MS Project as XML/)
    await expect(parseScheduleFile('plan.xls', Buffer.from('x'), 's')).rejects.toThrow(/\.xlsx/)
    await expect(parseScheduleFile('plan.docx', Buffer.from('x'), 's')).rejects.toThrow(/Unsupported/)
    await expect(parseScheduleFile('p6.xml', Buffer.from('<APIBusinessObjects></APIBusinessObjects>'), 's')).rejects.toThrow(/no <Project>/)
  })
})
