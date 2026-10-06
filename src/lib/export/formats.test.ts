import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import type { Answer, AnswerValue } from '@/lib/planning/types'
import { generateSchedule } from '@/lib/planning/generator'
import { evaluatePlan } from '@/lib/planning/evaluation'
import { parseXER } from '@/lib/parsers/xer-parser'
import { exportXer, xerText, P6_NAME_MAX } from './xer'
import { exportPdf, pdfSafe } from './pdf'
import { exportImportXlsx, exportP6LayoutXlsx } from './xlsx'
import { exportScheduleCsv } from './csv'
import { buildWbs } from './wbs'
import { fmtDate, fmtDates } from '@/lib/format'

const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
const answers: Record<string, Answer> = {
  'project.type': k('data_center'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(200000),
  'project.stories': k(2), 'project.target_start': k('2026-10-30'), 'design.drawings': k(true), 'design.percent': k(30), 'project.federal': k(false),
}
const g = generateSchedule({ answers, today: '2026-09-30' })
const NAME = 'Build a Data Center Schedule in Ashburn Virginia'

describe('date format', () => {
  it('shows MM/DD/YYYY', () => {
    expect(fmtDate('2026-10-31')).toBe('10/31/2026')
    expect(fmtDate(null)).toBe('—')
    expect(fmtDates('Review ends 2027-06-01; start 2026-10-30T00:00:00Z.')).toBe('Review ends 06/01/2027; start 10/30/2026.')
  })
  it('CSV export uses MM/DD/YYYY', () => {
    const csv = exportScheduleCsv(g)
    expect(csv).toMatch(/\b10\/30\/2026\b/)
    expect(csv).not.toMatch(/\b2026-10-30\b/)
  })
})

describe('WBS', () => {
  it('groups by phase and folds segmented work into packages', () => {
    const { root, nodes, rows } = buildWbs(g, NAME)
    expect(root).toBe('BADCSI')
    expect(nodes.map(n => n.name)).toContain('Interiors')
    expect(rows.filter(r => r.kind === 'activity')).toHaveLength(g.activities.length)
    expect(rows.some(r => r.kind === 'wbs' && r.level === 2)).toBe(true)
  })
})

describe('Primavera P6 .xer export', () => {
  const xer = exportXer(g, NAME, { now: new Date('2026-09-30T00:00:00Z') })

  it('is a well-formed XER', () => {
    expect(xer.startsWith('ERMHDR\t')).toBe(true)
    expect(xer.trimEnd().endsWith('%E')).toBe(true)
    for (const tbl of ['CALENDAR', 'PROJECT', 'PROJWBS', 'TASK', 'TASKPRED']) expect(xer).toContain(`%T\t${tbl}`)
    expect(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/.test(xer)).toBe(false)
  })

  it('decodes as Windows-1252 bytes, the way P6 writes and reads XER', async () => {
    const { parseScheduleFile } = await import('@/lib/parsers')
    const p = await parseScheduleFile('x.xer', Buffer.from(xer, 'latin1'), 'enc')
    expect(p.calendars.some(c => c.name.includes('×'))).toBe(true)
  })

  it('round-trips through the P6 parser with logic, calendars, WBS and durations', () => {
    const p = parseXER(xer, 'rt')
    expect(p.activities).toHaveLength(g.activities.length)
    expect(p.relationships).toHaveLength(g.links.length)
    expect(p.calendars).toHaveLength(2)
    const field = p.calendars.find(c => c.hoursPerDay === 8 && c.workDays.length === 5)!
    expect(field.holidays).toContain('2026-11-26') // Thanksgiving
    const byCode = new Map(p.activities.map(a => [a.activityId, a]))
    for (const a of g.activities) {
      const got = byCode.get(a.code)!
      expect(got.name).toBe(xerText(a.name).slice(0, P6_NAME_MAX)) // P6 caps activity names at 120 characters
      expect(got.duration).toBeCloseTo(a.duration, 5)
      expect(got.earlyStart).toBe(g.cpm!.times[a.id].earlyStart)
    }
    expect(p.activities.every(a => a.wbs && a.wbs.length > 0)).toBe(true)
    const withCstr = g.activities.filter(a => a.constraint)
    for (const a of withCstr) expect(byCode.get(a.code)!.constraintType).toBe(a.constraint!.type)
  })
})

describe('PDF export', () => {
  it('renders a summary page and paginated P6-style Gantt pages', async () => {
    const ev = evaluatePlan(g, answers, null, [])
    const bytes = await exportPdf(g, NAME, ev, { preparedBy: 'Ana' })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3)
    expect(doc.getPage(0).getSize()).toEqual({ width: 1224, height: 792 })
    expect(pdfSafe('≥500 kW → ok ✓')).toBe('>=500 kW -> ok v')
  })
})

describe('Excel exports', () => {
  it('import workbook has MS Project and P6 sheets with consistent logic', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportImportXlsx(g, NAME) as unknown as ArrayBuffer)
    expect(wb.worksheets.map(w => w.name)).toEqual(['MS Project Import', 'TASK', 'TASKPRED', 'PROJWBS', 'How to import'])
    const task = wb.getWorksheet('TASK')!
    expect(task.getRow(1).getCell(1).value).toBe('task_code')
    expect(task.rowCount - 2).toBe(g.activities.length)
    expect(task.getColumn(8).numFmt).toBe('mm/dd/yyyy')
    expect(wb.getWorksheet('TASKPRED')!.rowCount - 2).toBe(g.links.length)
    // MS Project predecessors reference row IDs that exist.
    const msp = wb.getWorksheet('MS Project Import')!
    const ids = new Set<number>()
    msp.eachRow((r, n) => { if (n > 1) ids.add(Number(r.getCell(1).value)) })
    msp.eachRow((r, n) => {
      if (n === 1) return
      for (const ref of String(r.getCell(5).value || '').split(',').filter(Boolean)) expect(ids.has(Number(ref.match(/^\d+/)![0]))).toBe(true)
    })
  })

  it('P6-look workbook has WBS bands, indentation, outline levels and bars', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportP6LayoutXlsx(g, NAME) as unknown as ArrayBuffer)
    const ws = wb.getWorksheet('Schedule')!
    expect(ws.getCell(5, 1).value).toBe('Activity ID')
    let wbsRows = 0, indented = 0, critBars = 0, outlined = 0
    ws.eachRow((r, n) => {
      if (n <= 5) return
      const fill = (r.getCell(1).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb
      if (fill === 'FFFFE699' || fill === 'FFC6E0B4') wbsRows++
      if ((r.getCell(2).alignment?.indent || 0) > 0) indented++
      if (r.outlineLevel) outlined++
      r.eachCell({ includeEmpty: true }, c => { if ((c.fill as ExcelJS.FillPattern)?.fgColor?.argb === 'FFE0301E' && Number(c.col) > 7) critBars++ })
    })
    expect(wbsRows).toBeGreaterThan(5)
    expect(indented).toBeGreaterThan(g.activities.length * 0.9)
    expect(outlined).toBeGreaterThan(g.activities.length * 0.9)
    expect(critBars).toBeGreaterThan(0)
    expect(ws.getColumn(4).numFmt).toBe('mm/dd/yyyy')
  })
})
