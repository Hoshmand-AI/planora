import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { parseXER } from './xer-parser'
import { parseMSProjectXML } from './xml-parser'
import { parseSpreadsheet } from './excel-parser'
import { ExceptionCollector, exceptionHeader, summarizeExceptions, asExceptionReport, type ExceptionReport } from './exceptions'

const fixtures = path.join(__dirname, '__fixtures__')
const rec = (r: ExceptionReport | undefined, field: string) => r?.records.find(x => x.field === field)

describe('ExceptionCollector', () => {
  it('merges repeats into one record with a count and up to 10 distinct examples', () => {
    const c = new ExceptionCollector('import', 'test')
    for (let i = 0; i < 15; i++) c.add({ severity: 'info', entity: 'activity', field: 'F', disposition: 'converted', message: 'm', example: `A${i % 12}` })
    c.add({ severity: 'loss', entity: 'activity', field: 'F', disposition: 'converted', message: 'm', count: 5 })
    const r = c.report()
    expect(r.records).toHaveLength(1)
    expect(r.records[0]).toMatchObject({ direction: 'import', format: 'test', count: 20, severity: 'loss' })
    expect(r.records[0].examples).toHaveLength(10)
  })

  it('summarizes by entity and disposition and fits a compact ASCII header', () => {
    const c = new ExceptionCollector('export', 'xml')
    c.add({ severity: 'loss', entity: 'calendar', field: 'Calendars', disposition: 'dropped', message: 'm', count: 2 })
    c.add({ severity: 'info', entity: 'constraint', field: 'Start On', disposition: 'converted', message: 'm', example: 'A1 – Ü' })
    const r = c.report()
    expect(summarizeExceptions(r)).toEqual({ total: 3, losses: 2, byEntity: { calendar: 2, constraint: 1 }, byDisposition: { dropped: 2, converted: 1 } })
    const h = exceptionHeader(r)
    expect(/^[\x20-\x7e]*$/.test(h)).toBe(true)
    expect(JSON.parse(h).records[1].examples[0]).toBe('A1 – Ü')
    expect(asExceptionReport(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(asExceptionReport(null)).toBeNull()
  })
})

describe('XER import exceptions', () => {
  const p = parseXER(readFileSync(path.join(fixtures, 'p6-equivalence.xer'), 'utf8'), 's')
  const r = p.exceptions!

  it('lists every table Planora does not model, with row counts and examples, kept in the raw file', () => {
    expect(r.direction).toBe('import')
    expect(r.format).toBe('p6_xer')
    expect(rec(r, 'UDFVALUE')).toMatchObject({ entity: 'udf', count: 2, disposition: 'preserved_in_raw', examples: ['1004', '1006'] })
    expect(rec(r, 'UDFTYPE')).toMatchObject({ entity: 'udf', count: 1, examples: ['Responsible Sub'] })
    expect(rec(r, 'ACTVCODE')).toMatchObject({ entity: 'code', count: 2, examples: ['N', 'S'] })
    expect(rec(r, 'ACTVTYPE')).toMatchObject({ entity: 'code', count: 1, examples: ['Area'] })
    expect(rec(r, 'TASKACTV')).toMatchObject({ entity: 'code', count: 3 })
    expect(rec(r, 'RSRC')).toMatchObject({ entity: 'resource', count: 2, examples: ['EXC', 'IW'] })
    expect(rec(r, 'TASKRSRC')).toMatchObject({ entity: 'assignment', count: 2, examples: ['1003', '1006'] })
    // the free-text warning is still there
    expect(p.warnings.some(w => w.startsWith('Not used in Planora') && w.includes('UDFVALUE (2 rows'))).toBe(true)
  })

  it('lists unmapped fields of the tables it reads, and conversions it made', () => {
    expect(rec(r, 'TASK.duration_type')).toMatchObject({ entity: 'activity', count: 9, severity: 'info' })
    expect(rec(r, 'PROJWBS.seq_num')).toMatchObject({ count: 4, examples: ['EQ-1', 'SITE', 'FDN', 'STR'] })
    expect(rec(r, 'TASK.cstr_type2')).toMatchObject({ entity: 'constraint', severity: 'loss', disposition: 'dropped', examples: ['A1040 (CS_MEOB)'] })
    expect(rec(r, 'TASK.cstr_date2')).toMatchObject({ entity: 'constraint', severity: 'loss' })
    // fields the parser reads are never reported
    expect(r.records.some(x => x.field === 'TASK.task_code' || x.field === 'TASK.target_drtn_hr_cnt')).toBe(false)
  })

  it('records dropped external relationships and multi-project files', () => {
    const sample = parseXER(readFileSync(path.join(fixtures, 'sample.xer'), 'utf8'), 's').exceptions!
    expect(rec(sample, 'TASKPRED')).toMatchObject({ entity: 'relationship', disposition: 'dropped', severity: 'loss', count: 1, examples: ['9999 -> 1006'] })
    const two = parseXER([
      '%T\tPROJECT', '%F\tproj_id\tproj_short_name', '%R\t1\tP1', '%R\t2\tP2',
      '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name', '%R\t10\t1\tA\tA', '%R\t11\t1\tB\tB', '%R\t20\t2\tC\tC', '%E',
    ].join('\n'), 's').exceptions!
    expect(rec(two, 'PROJECT')).toMatchObject({ entity: 'project', count: 1, examples: ['P2'], disposition: 'preserved_in_raw' })
    expect(rec(two, 'TASK (other projects)')).toMatchObject({ count: 1, examples: ['C'] })
  })
})

describe('MS Project XML import exceptions', () => {
  const base = readFileSync(path.join(fixtures, 'sample-msp.xml'), 'utf8')
  const extra = `
  <ExtendedAttributes>
    <ExtendedAttribute><FieldID>188743731</FieldID><FieldName>Text1</FieldName><Alias>Activity ID</Alias></ExtendedAttribute>
    <ExtendedAttribute><FieldID>188743734</FieldID><FieldName>Text2</FieldName><Alias>Area</Alias></ExtendedAttribute>
  </ExtendedAttributes>
  <OutlineCodes><OutlineCode><FieldID>188744096</FieldID><Alias>Phase code</Alias></OutlineCode></OutlineCodes>
  <Resources>
    <Resource><UID>0</UID><Name>Unassigned</Name></Resource>
    <Resource><UID>1</UID><Name>Concrete crew</Name></Resource>
    <Resource><UID>2</UID><Name>Crane</Name></Resource>
  </Resources>
  <Assignments>
    <Assignment><UID>1</UID><TaskUID>2</TaskUID><ResourceUID>1</ResourceUID></Assignment>
    <Assignment><UID>2</UID><TaskUID>3</TaskUID><ResourceUID>-1</ResourceUID></Assignment>
  </Assignments>
</Project>`
  // One task gains a second baseline, a custom field value and a note.
  const xml = base.replace(/<\/Project>\s*$/, extra)
    .replace('<Name>Rough Grading</Name>', '<Name>Rough Grading</Name><Notes>Bring the trailer</Notes><Baseline><Number>1</Number><Start>2026-03-02T08:00:00</Start></Baseline><ExtendedAttribute><FieldID>188743734</FieldID><Value>North</Value></ExtendedAttribute>')
  const p = parseMSProjectXML(xml, 's')
  const r = p.exceptions!

  it('lists the project collections Planora does not model', () => {
    expect(xml).toContain('<Notes>Bring the trailer</Notes>')
    expect(r.format).toBe('ms_xml')
    expect(rec(r, 'Resources')).toMatchObject({ entity: 'resource', count: 2, disposition: 'dropped', examples: ['Concrete crew', 'Crane'] })
    expect(rec(r, 'Assignments')).toMatchObject({ entity: 'assignment', count: 1 })
    expect(rec(r, 'OutlineCodes')).toMatchObject({ entity: 'code', count: 1, examples: ['Phase code'] })
    expect(rec(r, 'ExtendedAttributes')).toMatchObject({ entity: 'udf', count: 1, examples: ['Area'] })
  })

  it('lists task-level elements it did not map: other baselines, custom field values, notes', () => {
    expect(rec(r, 'Task.Baseline[1]')).toMatchObject({ entity: 'baseline', disposition: 'dropped', examples: ['Rough Grading'] })
    expect(rec(r, 'Task.ExtendedAttribute[Area]')).toMatchObject({ entity: 'udf', examples: ['Rough Grading'] })
    expect(rec(r, 'Task.Notes')).toMatchObject({ entity: 'other', examples: ['Rough Grading'] })
    expect(rec(r, 'Task.IsNull')).toMatchObject({ disposition: 'dropped', count: 1 })
    expect(rec(r, 'PredecessorLink')).toMatchObject({ entity: 'relationship', severity: 'loss' })
    // mapped fields are not reported
    expect(r.records.some(x => x.field === 'Task.Duration' && x.disposition === 'dropped')).toBe(false)
  })
})

describe('Excel / CSV import exceptions', () => {
  it('lists unrecognized columns with the rows whose data was not imported', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Schedule')
    ws.addRow(['Activity ID', 'Activity Name', 'Duration', 'Start', 'Finish', 'Predecessors', 'Superintendent', 'Cost Code', 'Duration'])
    ws.addRow(['A1', 'Mobilize', 5, '2026-03-02', '2026-03-06', '', 'Lee', '01-100', 4])
    ws.addRow(['A2', 'Excavate', '80h', '2026-03-09', '2026-03-18', 'A1, Z9', '', '02-200', 6])
    wb.addWorksheet('Notes').addRow(['free text'])
    const p = await parseSpreadsheet(Buffer.from(await wb.xlsx.writeBuffer()), 'plan.xlsx', 's')
    const r = p.exceptions!
    expect(r.format).toBe('excel')
    expect(rec(r, 'Column "Superintendent"')).toMatchObject({ entity: 'other', disposition: 'dropped', count: 1, examples: ['A1'] })
    expect(rec(r, 'Column "Cost Code"')).toMatchObject({ count: 2, examples: ['A1', 'A2'], severity: 'warning' })
    expect(rec(r, 'Column "Duration"')).toMatchObject({ message: expect.stringMatching(/Duplicate column/) })
    expect(rec(r, 'Worksheets')).toMatchObject({ count: 1, examples: ['Notes'] })
    expect(rec(r, 'Predecessors')).toMatchObject({ entity: 'relationship', severity: 'loss', examples: ['A2: Z9'] })
    expect(rec(r, 'Duration')).toMatchObject({ disposition: 'converted', examples: ['A2 (80h)'] })
    // the existing warning text still lists them
    expect(p.warnings).toContain('Unrecognized columns ignored: Superintendent, Cost Code')
  })

  it('reports the CSV fixture: an unrecognized column, a dangling reference, converted durations', async () => {
    const p = await parseSpreadsheet(readFileSync(path.join(fixtures, 'messy-export.csv')), 'messy-export.csv', 's')
    const r = p.exceptions!
    expect(r.format).toBe('csv')
    expect(rec(r, 'Column "Phase"')).toMatchObject({ count: 7 })
    expect(rec(r, 'Predecessors')).toMatchObject({ examples: ['A230: Z999'] })
  })
})
