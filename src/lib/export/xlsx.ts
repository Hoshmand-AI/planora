// Excel exports.
//  1. exportImportXlsx  — flat, machine-readable sheets for bringing the schedule back into
//     MS Project (Import Wizard) or Primavera P6 (spreadsheet import), plus instructions.
//  2. exportP6LayoutXlsx — a presentation workbook that looks like a P6 Gantt layout: WBS bands in
//     level colors, indented names, collapsible outline, critical/non-critical bars, month/week scale.

import ExcelJS from 'exceljs'
import type { ConstraintType, GeneratedSchedule } from '@/lib/planning/types'
import { buildWbs, type WbsRow } from './wbs'
import { fmtDate } from '@/lib/format'
import { addProvenance, type Provenance } from './provenance'

const DATE_FMT = 'mm/dd/yyyy'
const toDate = (iso?: string | null) => (iso ? new Date(iso.slice(0, 10) + 'T00:00:00Z') : null)

function predString(s: GeneratedSchedule, activityId: string, rowOf: Map<string, number>, style: 'msp' | 'code'): string {
  const codeOf = new Map(s.activities.map(a => [a.id, a.code]))
  return s.links.filter(l => l.to === activityId).map(l => {
    const ref = style === 'msp' ? rowOf.get(l.from) : codeOf.get(l.from)
    if (ref === undefined) return ''
    const lag = l.lag ? `${l.lag > 0 ? '+' : ''}${l.lag} days` : ''
    return style === 'msp' ? `${ref}${l.type === 'FS' && !lag ? '' : l.type}${lag}` : `${ref} ${l.type}${l.lag ? (l.lag > 0 ? '+' : '') + l.lag : ''}`
  }).filter(Boolean).join(style === 'msp' ? ',' : ', ')
}

function header(ws: ExcelJS.Worksheet, row: number, fill = 'FF0F2140') {
  const r = ws.getRow(row)
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; c.alignment = { vertical: 'middle', wrapText: true } })
  r.height = 30
}

/* ─── 1. Import-ready workbook ───────────────────────── */

export async function exportImportXlsx(s: GeneratedSchedule, projectName: string, prov?: Provenance | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Planora'
  const { root, rows } = buildWbs(s, projectName)
  const t = s.cpm?.times || {}

  // MS Project: one row per task, outline levels create the WBS summary tasks; predecessors by row ID.
  const msp = wb.addWorksheet('MS Project Import')
  msp.columns = [
    { header: 'ID', key: 'id', width: 6 }, { header: 'Name', key: 'name', width: 60 }, { header: 'Outline Level', key: 'lvl', width: 8 },
    { header: 'Duration', key: 'dur', width: 12 }, { header: 'Predecessors', key: 'pred', width: 28 }, { header: 'WBS', key: 'wbs', width: 16 },
    { header: 'Text1', key: 'code', width: 10 }, { header: 'Notes', key: 'notes', width: 60 },
  ]
  const rowOf = new Map<string, number>()
  rows.forEach((r, i) => { if (r.activity) rowOf.set(r.activity.id, i + 1) })
  rows.forEach((r, i) => {
    const a = r.activity
    msp.addRow({
      id: i + 1, name: r.name, lvl: r.level, wbs: r.kind === 'wbs' ? r.code : r.wbsCode,
      dur: a ? (a.type === 'milestone' ? '0 days' : `${a.duration} ${a.calendarId === 'cal-7d' ? 'edays' : 'days'}`) : '',
      pred: a ? predString(s, a.id, rowOf, 'msp') : '', code: a ? a.code : '', notes: a ? a.rationale.summary : '',
    })
  })
  header(msp, 1)
  msp.views = [{ state: 'frozen', ySplit: 1 }]

  // P6 spreadsheet import layout: row 1 = field names, row 2 = column titles, data from row 3.
  const p6 = wb.addWorksheet('TASK')
  const taskFields = ['task_code', 'status_code', 'wbs_id', 'task_name', 'task_type', 'clndr_id', 'target_drtn_hr_cnt', 'start_date', 'end_date', 'total_float_hr_cnt', 'cstr_type', 'cstr_date']
  const taskTitles = ['Activity ID', 'Activity Status', 'WBS Code', 'Activity Name', 'Activity Type', 'Calendar', 'Original Duration (d)', 'Start', 'Finish', 'Total Float (d)', 'Primary Constraint', 'Primary Constraint Date']
  p6.addRow(taskFields); p6.addRow(taskTitles)
  const cstr: Record<ConstraintType, string> = { SNET: 'Start On or After', SNLT: 'Start On or Before', FNET: 'Finish On or After', FNLT: 'Finish On or Before', SO: 'Start On', FO: 'Finish On', MSO: 'Mandatory Start', MFO: 'Mandatory Finish' }
  for (const r of rows) {
    const a = r.activity
    if (!a) continue
    const tm = t[a.id]
    const status = a.actualFinish || a.status === 'complete' ? 'Completed' : a.actualStart ? 'In Progress' : 'Not Started'
    p6.addRow([a.code, status, `${r.wbsCode}`, a.name, a.type === 'milestone' ? 'Finish Milestone' : 'Task Dependent',
      s.calendars.find(c => c.id === (a.calendarId || s.defaultCalendarId))?.name || '', a.duration,
      toDate(tm?.earlyStart), toDate(tm?.earlyFinish), tm?.totalFloat ?? '', a.constraint ? cstr[a.constraint.type] : '', toDate(a.constraint?.date)])
  }
  p6.getRow(1).font = { color: { argb: 'FF8A8178' }, size: 9 }
  header(p6, 2)
  p6.columns.forEach((c, i) => { c.width = [12, 12, 16, 60, 16, 30, 10, 12, 12, 10, 18, 14][i] })
  ;[8, 9, 12].forEach(i => { p6.getColumn(i).numFmt = DATE_FMT })
  p6.views = [{ state: 'frozen', ySplit: 2 }]

  const pred = wb.addWorksheet('TASKPRED')
  pred.addRow(['task_id', 'pred_task_id', 'pred_type', 'lag_hr_cnt'])
  pred.addRow(['Activity ID', 'Predecessor', 'Relationship Type', 'Lag (d)'])
  const codeOf = new Map(s.activities.map(a => [a.id, a.code]))
  for (const l of s.links) pred.addRow([codeOf.get(l.to), codeOf.get(l.from), l.type, l.lag])
  pred.getRow(1).font = { color: { argb: 'FF8A8178' }, size: 9 }
  header(pred, 2)
  pred.columns.forEach(c => { c.width = 18 })

  const wbs = wb.addWorksheet('PROJWBS')
  wbs.addRow(['wbs_short_name', 'wbs_name', 'parent_wbs'])
  wbs.addRow(['WBS Code', 'WBS Name', 'Parent WBS'])
  wbs.addRow([root, projectName, ''])
  for (const r of rows) if (r.kind === 'wbs') wbs.addRow([r.code, r.name, r.code.split('.').slice(0, -1).join('.')])
  wbs.getRow(1).font = { color: { argb: 'FF8A8178' }, size: 9 }
  header(wbs, 2)
  wbs.columns.forEach((c, i) => { c.width = [18, 40, 18][i] })

  const readme = wb.addWorksheet('How to import')
  const lines = [
    [`${projectName} — import workbook generated by Planora ${fmtDate(new Date().toISOString())}`],
    [''],
    ['Microsoft Project'],
    ['1. File › Open › choose this workbook › "New map" › Import as a new project.'],
    ['2. Pick the "MS Project Import" sheet and map: Name→Name, Duration→Duration, Predecessors→Predecessors, Outline Level→Outline Level, WBS→WBS, Text1→Text1, Notes→Notes.'],
    ['3. Start/finish dates are left out on purpose so MS Project schedules from the logic instead of adding constraints. Set the project start to ' + fmtDate(s.projectStart) + '.'],
    [''],
    ['Primavera P6'],
    ['Best fidelity: use the .xer export (File › Import › Primavera PM XER) — it carries calendars, WBS, constraints and logic.'],
    ['Spreadsheet route: File › Import › Spreadsheet (XLSX). Sheets TASK, TASKPRED and PROJWBS follow P6\'s layout (field names in row 1, titles in row 2). Map the fields on first import and save the template.'],
    [''],
    ['Durations are in work days on each activity\'s calendar; "edays" / 7-day calendar items are calendar days (agency reviews, fabrication).'],
  ]
  lines.forEach(l => readme.addRow(l))
  readme.getColumn(1).width = 140
  readme.getRow(1).font = { bold: true, size: 13 }
  ;[3, 8].forEach(r => { readme.getRow(r).font = { bold: true } })
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 4, visibility: 'visible' }]
  // Provenance last, so the import sheets keep their positions.
  if (prov) addProvenance(wb, prov, `${projectName} — import workbook`)

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/* ─── 2. P6-look layout ──────────────────────────────── */

// P6-like WBS band colors by level, and bar colors.
const WBS_FILL = ['FFFFE699', 'FFC6E0B4', 'FFBDD7EE', 'FFF8CBAD']
const BAR_CRIT = 'FFE0301E'
const BAR_NONCRIT = 'FF3CB44B'
const BAR_WBS = 'FF1F1F1F'

function mondayOf(iso: string): number {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  const wd = (d.getUTCDay() + 6) % 7
  return d.getTime() - wd * 86_400_000
}

export async function exportP6LayoutXlsx(s: GeneratedSchedule, projectName: string, prov?: Provenance | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Planora'
  const ws = wb.addWorksheet('Schedule', {
    properties: { outlineLevelRow: 3 },
    pageSetup: { orientation: 'landscape', paperSize: 5 as unknown as ExcelJS.PaperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:5' },
  })
  const { rows } = buildWbs(s, projectName)
  const t = s.cpm?.times || {}
  const finish = s.cpm?.projectFinish || s.projectStart

  // Time scale: one column per week from the NTP week to the finish week.
  const WEEK = 7 * 86_400_000
  const w0 = mondayOf(s.projectStart)
  const weeks = Math.min(520, Math.floor((mondayOf(finish) - w0) / WEEK) + 1)
  const FIXED = ['Activity ID', 'Activity Name', 'Original Duration', 'Start', 'Finish', 'Total Float', 'Critical']
  const G0 = FIXED.length + 1 // first Gantt column (1-based)

  ws.getCell(1, 1).value = projectName
  ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF0F2140' } }
  ws.getCell(2, 1).value = `Data date ${fmtDate(s.dataDate || s.projectStart)} · Finish ${fmtDate(finish)} · ${s.activities.length} activities · Printed ${fmtDate(new Date().toISOString())} · Planora`
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF6B6359' } }

  // Row 4: months, Row 5: column titles + week starts.
  const HR1 = 4, HR2 = 5
  FIXED.forEach((h, i) => { ws.getCell(HR2, i + 1).value = h })
  let monthStartCol = G0, curMonth = ''
  for (let w = 0; w <= weeks; w++) {
    const d = new Date(w0 + w * WEEK)
    const label = w < weeks ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
    if (label !== curMonth) {
      if (curMonth && G0 + w - 1 >= monthStartCol) {
        if (G0 + w - 1 > monthStartCol) ws.mergeCells(HR1, monthStartCol, HR1, G0 + w - 1)
        ws.getCell(HR1, monthStartCol).value = curMonth
      }
      curMonth = label; monthStartCol = G0 + w
    }
    if (w < weeks) ws.getCell(HR2, G0 + w).value = d.getUTCDate()
  }
  for (const r of [HR1, HR2]) {
    ws.getRow(r).eachCell({ includeEmpty: true }, c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2140' } }
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: r === HR1 ? 10 : 9 }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      c.border = { right: { style: 'hair', color: { argb: 'FF4A5A78' } } }
    })
  }
  for (let c = 1; c < G0 + weeks; c++) {
    ;[HR1, HR2].forEach(r => {
      const cell = ws.getCell(r, c)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2140' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: r === HR1 ? 10 : 9 }
    })
  }
  ws.getRow(HR2).height = 32

  const weekIdx = (iso: string) => Math.floor((mondayOf(iso) - w0) / WEEK)
  const paintBar = (row: number, start?: string | null, end?: string | null, color?: string, milestone = false) => {
    if (!start || !end) return
    const a = Math.max(0, weekIdx(start)), b = Math.min(weeks - 1, weekIdx(end))
    if (milestone) {
      const cell = ws.getCell(row, G0 + a)
      cell.value = '◆'
      cell.font = { color: { argb: color }, bold: true }
      cell.alignment = { horizontal: 'center' }
      return
    }
    for (let w = a; w <= b; w++) ws.getCell(row, G0 + w).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color! } }
  }

  let r = HR2 + 1
  const put = (row: WbsRow) => {
    const xr = ws.getRow(r)
    if (row.kind === 'wbs') {
      const n = row.node!
      const fill = WBS_FILL[(n.level - 1) % WBS_FILL.length]
      xr.values = [n.code, n.name, '', toDate(n.start), toDate(n.finish), '', n.critical ? 'Yes' : '']
      for (let c = 1; c < G0 + weeks; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      xr.font = { bold: true }
      ws.getCell(r, 2).alignment = { indent: (n.level - 1) * 2 }
      xr.outlineLevel = n.level - 1
      paintBar(r, n.start, n.finish, BAR_WBS)
    } else {
      const a = row.activity!
      const tm = row.times
      xr.values = [a.code, a.name, a.type === 'milestone' ? 0 : a.duration, toDate(tm?.earlyStart), toDate(tm?.earlyFinish), tm?.totalFloat ?? '', tm?.critical ? 'Yes' : 'No']
      ws.getCell(r, 2).alignment = { indent: (row.level - 1) * 2 }
      xr.outlineLevel = row.level - 1
      if (tm?.critical) { ws.getCell(r, 6).font = { color: { argb: BAR_CRIT }, bold: true }; ws.getCell(r, 7).font = { color: { argb: BAR_CRIT } } }
      if (a.placeholder) xr.font = { italic: true, color: { argb: 'FF6B6359' } }
      paintBar(r, tm?.earlyStart, tm?.earlyFinish, tm?.critical ? BAR_CRIT : BAR_NONCRIT, a.type === 'milestone')
      ws.getCell(r, 2).note = a.rationale.summary.slice(0, 800)
    }
    for (let c = 1; c < G0 + weeks; c++) {
      const cell = ws.getCell(r, c)
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } }, right: c < G0 ? { style: 'hair', color: { argb: 'FFD9D9D9' } } : undefined }
    }
    r++
  }
  rows.forEach(put)

  ws.getColumn(1).width = 14
  ws.getColumn(2).width = 58
  ws.getColumn(3).width = 10
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 12
  ws.getColumn(6).width = 8
  ws.getColumn(7).width = 8
  ;[4, 5].forEach(c => { ws.getColumn(c).numFmt = DATE_FMT })
  ;[3, 6].forEach(c => { ws.getColumn(c).alignment = { horizontal: 'right' } })
  for (let w = 0; w < weeks; w++) ws.getColumn(G0 + w).width = 3
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: HR2 }]
  ws.autoFilter = { from: { row: HR2, column: 1 }, to: { row: HR2, column: FIXED.length } }

  // Legend.
  r += 1
  ws.getCell(r, 2).value = 'Legend'
  ws.getCell(r, 2).font = { bold: true }
  const legend: [string, string][] = [['Critical activity (total float ≤ 0)', BAR_CRIT], ['Non-critical activity', BAR_NONCRIT], ['WBS summary', BAR_WBS]]
  legend.forEach(([label, color], i) => {
    ws.getCell(r + 1 + i, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
    ws.getCell(r + 1 + i, 2).value = label
  })
  ws.getCell(r + 4, 2).value = 'Durations in work days on each activity\'s calendar. Hover an activity name for why it is scheduled that way.'
  ws.getCell(r + 4, 2).font = { italic: true, size: 9, color: { argb: 'FF6B6359' } }
  if (prov) {
    const src = prov.sources[0]
    ws.getCell(3, 1).value = `Source ${src?.fileName ?? '—'} · SHA-256 ${src?.sha256 ?? 'not recorded'} · Planora ${prov.release} · ${src?.progressMode === 'override' ? 'Progress override' : 'Retained logic'} — see the Provenance sheet`
    ws.getCell(3, 1).font = { size: 9, color: { argb: 'FF6B6359' } }
    addProvenance(wb, prov, `${projectName} — P6 layout`)
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
