import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Schedule } from '@/lib/db'
import { parseXER } from '@/lib/parsers/xer-parser'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import { exportXer } from '@/lib/export/xer'
import { exportMspXml } from '@/lib/export/msp-xml'
import { runSra } from '@/lib/planning/sra'
import ExcelJS from 'exceljs'
import { exportP6LayoutXlsx } from '@/lib/export/xlsx'
import { exportScheduleCsv } from '@/lib/export/csv'

const xer = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'latin1')

function load(text: string, id: string) {
  const p = parseXER(text, id)
  const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy })
  const analysis = analyzeSchedule({ activities: done.activities, links: p.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: p.projectFinish, mustFinishBy: p.mustFinishBy ?? null })
  const schedule = { id, name: p.projectName, version: 'Update 1', fileName: 'sample.xer', uploadedAt: '2026-10-01', projectStart: done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
  return { p, done, analysis, schedule }
}

describe('uploaded schedules are first-class', () => {
  const a = load(xer, 's1')
  const g = uploadedToGenerated(a.schedule, a.done.activities, a.p.relationships, a.done.cpm, a.analysis)

  it('round-trips through XER with the same activity IDs, project name, progress and finish', () => {
    const out = exportXer(g, a.p.projectName, { now: new Date('2026-10-06T00:00:00Z') })
    const b = load(out, 's2')
    expect(b.p.projectName).toBe(a.p.projectName)
    const codes = (x: typeof a) => x.done.activities.filter(t => t.activityType !== 'summary' && t.activityType !== 'loe').map(t => t.activityId).sort()
    expect(codes(b)).toEqual(codes(a))
    expect(b.analysis.forecastFinish).toBe(a.analysis.forecastFinish)
    const status = (x: typeof a) => Object.fromEntries(x.done.activities.map(t => [t.activityId, t.status]))
    expect(status(b)).toMatchObject(Object.fromEntries(Object.entries(status(a)).filter(([k]) => codes(a).includes(k))))
  })

  it('P6-layout workbook shows the data date, not the project start', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportP6LayoutXlsx(g, a.p.projectName) as unknown as ArrayBuffer)
    expect(String(wb.getWorksheet('Schedule')!.getCell(2, 1).value)).toMatch(/^Data date 03\/16\/2026 /)
  })

  it('CSV export keeps the WBS and progress', () => {
    const lines = exportScheduleCsv(g).trim().split('\r\n')
    const head = lines[0].split(',')
    for (const c of ['WBS', 'Status', 'Percent Complete', 'Remaining Duration', 'Actual Start', 'Actual Finish', 'Baseline Start', 'Baseline Finish']) expect(head).toContain(c)
    const row = (code: string) => { const r = lines.find(l => l.startsWith(code + ','))!.split(','); return (col: string) => r[head.indexOf(col)] }
    expect(row('A1020')('Status')).toBe('In Progress')
    expect(row('A1020')('Percent Complete')).toBe('40')
    expect(row('A1020')('Actual Start')).toBe('03/09/2026')
    expect(row('A1020')('WBS')).toBe('SITE Sitework')
    expect(row('A1010')('Actual Finish')).toBe('03/06/2026')
    expect(row('A1010')('Baseline Finish')).toBe('03/06/2026')
  })

  it('runs a Monte Carlo risk analysis on the uploaded network', () => {
    const r = runSra(g, {}, null, { iterations: 200, seed: 7 })
    expect(r.iterations).toBe(200)
    expect(r.percentiles.p80 >= r.percentiles.p50).toBe(true)
  })

  it('exports an uploaded schedule to MS Project XML when the upload time is a Date (round-2 finding: HTTP 500)', () => {
    const fromDb = { ...a.schedule, uploadedAt: new Date('2026-10-01T12:00:00Z') } as unknown as Schedule
    const xml = exportMspXml(uploadedToGenerated(fromDb, a.done.activities, a.p.relationships, a.done.cpm, a.analysis), a.p.projectName)
    expect(xml).toMatch(/<CreationDate>2026-10-01T00:00:00<\/CreationDate>/)
  })
})
