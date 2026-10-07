// Analysis workbooks: update comparison (one sheet per change category), windows analysis, and the
// 3-week look-ahead. Each starts with a Provenance sheet and carries provenance in the workbook
// metadata (src/lib/export/provenance.ts). Text from uploaded files goes through neutralizeFormula,
// the same CSV-injection guard as the CSV exports, so it stays text if the sheet is saved as CSV.

import ExcelJS from 'exceljs'
import type { Activity, Relationship } from '@/lib/db'
import type { ActivityChange, ScheduleComparison } from '@/lib/analysis/compare'
import { describeCalendarChange } from '@/lib/analysis/compare'
import type { WindowsAnalysis } from '@/lib/analysis/windows'
import { windowDriverRows, windowsTableRows, WINDOWS_COLUMNS } from '@/lib/analysis/windows'
import { fmtDate, fmtDates } from '@/lib/format'
import { neutralizeFormula } from './csv'
import { addProvenance, type Provenance } from './provenance'
import { markingRows, type ExportMarking } from './markings'

const DATE_FMT = 'mm/dd/yyyy'
const ISO = /^\d{4}-\d{2}-\d{2}/
const toDate = (iso?: string | null) => (iso && ISO.test(iso) ? new Date(iso.slice(0, 10) + 'T00:00:00Z') : null)

interface Col { header: string; key: string; width?: number; date?: boolean }

/** Strings are neutralized (formula injection) and ISO dates in text shown as MM/DD/YYYY. */
function safe(v: unknown): unknown {
  if (v == null) return ''
  if (typeof v === 'string') return neutralizeFormula(ISO.test(v) && v.length <= 10 ? fmtDate(v) : fmtDates(v))
  return v
}

function addSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name.slice(0, 31))
  ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.width ?? (c.date ? 12 : 18) }))
  for (const r of rows) {
    const out: Record<string, unknown> = {}
    for (const c of cols) out[c.key] = c.date ? toDate(r[c.key] as string | null) ?? '' : safe(r[c.key])
    ws.addRow(out)
  }
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2140' } }; c.alignment = { vertical: 'middle', wrapText: true } })
  h.height = 32
  cols.forEach((c, i) => { if (c.date) ws.getColumn(i + 1).numFmt = DATE_FMT })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  return ws
}

/**
 * CUI marking for a restricted schedule's workbook: the banner and designation as the first rows of
 * the first (Provenance) sheet, and the banner in every sheet's print header/footer. Call last.
 */
function markWorkbook(wb: ExcelJS.Workbook, m: ExportMarking | null | undefined): void {
  if (!m) return
  wb.worksheets.forEach((ws, i) => {
    ws.headerFooter = { oddHeader: `&C&B${m.banner}`, oddFooter: `&C&B${m.banner}&R&P / &N` }
    if (i !== 0) return
    const rows = markingRows(m)
    ws.insertRows(1, rows)
    rows.forEach((_, j) => { ws.getRow(j + 1).font = j === 0 ? { bold: true, size: 12, color: { argb: 'FF7A1F12' } } : { size: 9, color: { argb: 'FF4A4540' } } })
  })
}

/* ─── Update comparison ──────────────────────────────── */

export const COMPARISON_SHEETS = ['Summary', 'Added', 'Deleted', 'Durations', 'Dates', 'Constraints', 'Calendars', 'Logic', 'Actuals rewritten', 'Float erosion', 'Driving path', 'Other changes'] as const

/**
 * GET /api/schedules/compare?format=xlsx: one sheet per change category; every sheet's Before/After
 * headers name the update and its data date.
 */
export async function exportComparisonXlsx(c: ScheduleComparison, prov: Provenance, marking?: ExportMarking | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  addProvenance(wb, prov, `Update comparison ${c.before.version} vs ${c.after.version}`)
  const bLabel = `Before: ${c.before.version} (data date ${fmtDate(c.before.dataDate)})`
  const aLabel = `After: ${c.after.version} (data date ${fmtDate(c.after.dataDate)})`
  const dd = { beforeDataDate: c.before.dataDate, afterDataDate: c.after.dataDate }
  const ddCols: Col[] = [{ header: `Data date ${c.before.version}`, key: 'beforeDataDate', date: true }, { header: `Data date ${c.after.version}`, key: 'afterDataDate', date: true }]

  addSheet(wb, 'Summary', [{ header: 'Item', key: 'k', width: 40 }, { header: 'Value', key: 'v', width: 110 }], [
    { k: 'Earlier update', v: `${c.before.version} — data date ${fmtDate(c.before.dataDate)}, forecast finish ${fmtDate(c.before.forecastFinish)}` },
    { k: 'Later update', v: `${c.after.version} — data date ${fmtDate(c.after.dataDate)}, forecast finish ${fmtDate(c.after.forecastFinish)}` },
    { k: `Finish movement (calendar days)${c.finishActivity ? `, on ${c.finishActivity}` : ''}`, v: c.finishMovement ?? '—' },
    ...(c.finishBasis.after ? [{ k: 'Constrained vs logic-driven finish (later)', v: `${c.finishBasis.after.type} ${fmtDate(c.finishBasis.after.constrainedFinish)} vs logic ${fmtDate(c.finishBasis.after.logicFinish)} (${c.finishBasis.after.days} wd)` }] : []),
    ...(c.windowAttribution ? [{ k: 'Logic-driven finish movement, windows attribution (cd)', v: c.windowAttribution.movement ?? '—' }, { k: 'Finish movement as scheduled, windows attribution (cd)', v: c.windowAttribution.asScheduledMovement ?? '—' }] : []),
    ...c.finishCauses.map((x, i) => ({ k: i === 0 ? 'Finish movement causes' : '', v: `${x.code ? `${x.code}: ` : ''}${x.days != null ? `${x.days > 0 ? '+' : ''}${x.days} cd${x.workDays != null ? ` (${x.workDays > 0 ? '+' : ''}${x.workDays} wd)` : ''} — ` : ''}${x.detail}` })),
    ...c.summary.map((x, i) => ({ k: i === 0 ? 'Summary' : '', v: x })),
  ])
  const actCols: Col[] = [{ header: 'Activity ID', key: 'code', width: 14 }, { header: 'Activity Name', key: 'name', width: 44 }, ...ddCols]
  addSheet(wb, 'Added', actCols, c.added.map(x => ({ ...x, ...dd })))
  addSheet(wb, 'Deleted', actCols, c.deleted.map(x => ({ ...x, ...dd })))
  const chCols: Col[] = [{ header: 'Activity ID', key: 'code', width: 14 }, { header: 'Activity Name', key: 'name', width: 44 }, { header: 'Calendar', key: 'calendar', width: 18 }, { header: 'Field', key: 'field', width: 16 },
    { header: bLabel, key: 'before', width: 26 }, { header: aLabel, key: 'after', width: 26 }, { header: 'Change', key: 'delta', width: 10 }, { header: 'Unit (wd = work days, cd = calendar days)', key: 'unit', width: 12 }, ...ddCols]
  const ch = (xs: ActivityChange[]) => xs.map(x => ({ code: x.code, name: x.name, calendar: x.calendar ?? '', field: x.field.replace(/_/g, ' '), before: x.before, after: x.after, delta: x.delta, unit: x.unit ?? '', ...dd }))
  const by = (...f: ActivityChange['field'][]) => c.changes.filter(x => f.includes(x.field))
  addSheet(wb, 'Durations', chCols, ch(by('duration', 'remaining')))
  addSheet(wb, 'Dates', chCols, ch(by('start', 'finish')))
  addSheet(wb, 'Constraints', chCols, ch(by('constraint')))
  addSheet(wb, 'Calendars', chCols, [
    ...ch(by('calendar')),
    ...c.calendarChanges.map(k => ({ code: '', name: describeCalendarChange(k), calendar: k.calendar, field: `calendar ${k.field.replace(/_/g, ' ')}`, before: k.before, after: k.after, delta: null, ...dd })),
  ])
  addSheet(wb, 'Logic', [{ header: 'Change', key: 'kind', width: 14 }, { header: 'Predecessor', key: 'pred', width: 14 }, { header: 'Successor', key: 'succ', width: 14 }, { header: 'Type', key: 'type', width: 8 },
    { header: `Lag ${bLabel}`, key: 'before', width: 22 }, { header: `Lag ${aLabel}`, key: 'after', width: 22 }, ...ddCols], [
    ...c.logicAdded.map(l => ({ kind: 'added', pred: l.pred, succ: l.succ, type: l.type, before: '', after: l.lag, ...dd })),
    ...c.logicDeleted.map(l => ({ kind: 'deleted', pred: l.pred, succ: l.succ, type: l.type, before: l.lag, after: '', ...dd })),
    ...c.lagChanged.map(l => ({ kind: 'lag changed', pred: l.pred, succ: l.succ, type: l.type, before: l.before, after: l.after, ...dd })),
  ])
  addSheet(wb, 'Actuals rewritten', chCols, ch(c.actualsRewritten))
  addSheet(wb, 'Float erosion', [{ header: 'Activity ID', key: 'code', width: 14 }, { header: 'Activity Name', key: 'name', width: 44 },
    { header: `Float (wd) ${bLabel}`, key: 'before', width: 22 }, { header: `Float (wd) ${aLabel}`, key: 'after', width: 22 }, { header: 'Change (wd)', key: 'delta', width: 12 }, ...ddCols],
  c.floatErosion.map(f => ({ ...f, ...dd })))
  addSheet(wb, 'Driving path', [{ header: 'Activity ID', key: 'code', width: 14 }, { header: 'Change', key: 'kind', width: 22 }, ...ddCols], [
    ...c.criticalPath.entered.map(code => ({ code, kind: 'joined', ...dd })),
    ...c.criticalPath.left.map(code => ({ code, kind: c.criticalPath.leftDeleted.includes(code) ? 'left (deleted)' : 'left', ...dd })),
  ])
  addSheet(wb, 'Other changes', chCols, ch(by('name', 'baseline_finish')))
  markWorkbook(wb, marking)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/* ─── Windows analysis ───────────────────────────────── */

export async function exportWindowsXlsx(w: WindowsAnalysis, prov: Provenance, title: string, marking?: ExportMarking | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  addProvenance(wb, prov, `Windows analysis — ${title}`)
  addSheet(wb, 'Windows', WINDOWS_COLUMNS.map(c => ({ header: c.label, key: c.key, date: c.date, width: c.key === 'notes' || c.key === 'drivers' ? 60 : c.key.startsWith('driving') || c.key.startsWith('logicPath') || c.key === 'hidden' ? 30 : undefined })), windowsTableRows(w))
  addSheet(wb, 'Drivers', [
    { header: 'Window', key: 'window', width: 8 }, { header: 'Later update', key: 'after', width: 18 }, { header: 'Activity ID', key: 'code', width: 14 }, { header: 'Activity Name', key: 'name', width: 40 },
    { header: 'Finish movement (cd)', key: 'days', width: 12 }, { header: 'Finish movement (wd, activity calendar)', key: 'workDays', width: 14 },
    { header: 'Finish, earlier (logic)', key: 'before', date: true }, { header: 'Finish, later (logic)', key: 'afterFinish', date: true },
    { header: 'Changes', key: 'changes', width: 60 }, { header: 'Hidden as scheduled by', key: 'hiddenBy', width: 14 },
  ], windowDriverRows(w))
  addSheet(wb, 'Trend', [
    { header: 'Update', key: 'version', width: 18 }, { header: 'Data date', key: 'dataDate', date: true }, { header: 'Finish milestone', key: 'finishCode', width: 14 },
    { header: 'Finish forecast', key: 'forecastFinish', date: true }, { header: 'Finish float (wd)', key: 'finishFloat', width: 12 }, { header: 'Lowest float (wd)', key: 'minFloat', width: 12 },
    { header: 'Negative-float activities', key: 'negativeFloatCount', width: 12 }, { header: 'BEI', key: 'bei', width: 8 }, { header: 'Missed tasks', key: 'missed', width: 10 }, { header: 'Baselined due', key: 'due', width: 10 },
  ], w.trend as unknown as Record<string, unknown>[])
  addSheet(wb, 'Notes', [{ header: 'Note', key: 'n', width: 140 }], w.notes.map(n => ({ n })))
  markWorkbook(wb, marking)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/* ─── 3-week look-ahead ──────────────────────────────── */

export interface LookaheadRow {
  code: string; name: string; wbs: string; status: string
  start: string | null; finish: string | null; duration: number; remaining: number
  totalFloat: number; critical: boolean; predecessors: string; constraint: string
}

const STATUS = { not_started: 'Not Started', in_progress: 'In Progress', complete: 'Completed' } as const

/**
 * Activities in progress, or starting within `days` calendar days of the data date (inclusive), by
 * start date. Predecessors are "CODE TYPE±lag (status)".
 */
export function lookaheadRows(activities: Activity[], relationships: Relationship[], dataDate: string, days = 21): LookaheadRow[] {
  const end = new Date(Date.parse(dataDate.slice(0, 10)) + days * 86_400_000).toISOString().slice(0, 10)
  const byId = new Map(activities.map(a => [a.id, a]))
  const preds = new Map<string, Relationship[]>()
  for (const r of relationships) preds.set(r.successorId, [...(preds.get(r.successorId) || []), r])
  return activities
    .filter(a => a.activityType !== 'summary' && a.activityType !== 'loe' && !a.actualFinish && a.status !== 'complete')
    .filter(a => !!a.actualStart || a.status === 'in_progress' || (!!a.earlyStart && a.earlyStart.slice(0, 10) <= end))
    .sort((x, y) => (x.actualStart || x.earlyStart || '').localeCompare(y.actualStart || y.earlyStart || '') || x.activityId.localeCompare(y.activityId))
    .map(a => ({
      code: a.activityId, name: a.name, wbs: a.wbs || '', status: a.actualStart ? STATUS.in_progress : STATUS[a.status] ?? STATUS.not_started,
      start: a.actualStart || a.earlyStart, finish: a.earlyFinish, duration: a.duration,
      remaining: a.actualStart || a.status === 'in_progress' ? a.remainingDuration : a.duration,
      totalFloat: a.totalFloat, critical: a.totalFloat <= 0,
      predecessors: (preds.get(a.id) || []).map(r => {
        const p = byId.get(r.predecessorId)
        if (!p) return ''
        const st = p.actualFinish || p.status === 'complete' ? 'done' : p.actualStart ? 'in progress' : 'open'
        return `${p.activityId} ${r.type}${r.lag ? `${r.lag > 0 ? '+' : ''}${r.lag}d` : ''} (${st})`
      }).filter(Boolean).join(', '),
      constraint: a.constraintType ? `${a.constraintType}${a.constraintDate ? ` ${fmtDate(a.constraintDate)}` : ''}` : '',
    }))
}

export async function exportLookaheadXlsx(rows: LookaheadRow[], prov: Provenance, meta: { project: string; dataDate: string; days?: number }, marking?: ExportMarking | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const days = meta.days ?? 21
  const end = new Date(Date.parse(meta.dataDate) + days * 86_400_000).toISOString().slice(0, 10)
  addProvenance(wb, prov, `${days / 7}-week look-ahead — ${meta.project}`)
  const ws = addSheet(wb, `${days / 7}-Week Look-Ahead`, [
    { header: 'Activity ID', key: 'code', width: 14 }, { header: 'Activity Name', key: 'name', width: 48 }, { header: 'WBS', key: 'wbs', width: 22 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Start', key: 'start', date: true }, { header: 'Finish', key: 'finish', date: true },
    { header: 'Original Duration (wd)', key: 'duration', width: 11 }, { header: 'Remaining Duration (wd)', key: 'remaining', width: 11 },
    { header: 'Total Float (wd)', key: 'totalFloat', width: 10 }, { header: 'Critical', key: 'critical', width: 8 },
    { header: 'Predecessors', key: 'predecessors', width: 48 }, { header: 'Constraint', key: 'constraint', width: 18 },
  ], rows.map(r => ({ ...r, critical: r.critical ? 'Yes' : 'No' })))
  ws.insertRow(1, [neutralizeFormula(`${meta.project}: activities in progress or starting ${fmtDate(meta.dataDate)} – ${fmtDate(end)} (data date + ${days} days)`)])
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 2 }]
  ws.autoFilter = rows.length ? { from: { row: 2, column: 1 }, to: { row: 2, column: 12 } } : undefined
  markWorkbook(wb, marking)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
