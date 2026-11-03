// RFC 4180 CSV export (CRLF line endings, fields quoted when needed).

import type { GeneratedSchedule } from '@/lib/planning/types'
import { fmtDate, fmtDates } from '@/lib/format'
import type { ScheduleComparison } from '@/lib/analysis/compare'

function cellString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString()
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return isFinite(v) ? String(v) : ''
  if (Array.isArray(v)) return v.map(cellString).join('; ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Spreadsheet formula injection (CWE-1236): text from uploaded files or users that starts with
 * = + - @ or a tab/CR would run as a formula when the CSV is opened in Excel/Sheets. Such text is
 * prefixed with an apostrophe so it displays as text. Real numbers are left alone.
 */
export function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
}

export function csvField(v: unknown): string {
  const raw = cellString(v)
  const s = typeof v === 'number' ? raw : neutralizeFormula(raw)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvCell = csvField

export function exportCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const lines = [columns.map(c => csvField(c.label)).join(',')]
  for (const r of rows) lines.push(columns.map(c => csvField(r[c.key])).join(','))
  return lines.join('\r\n') + '\r\n'
}

const fmtLag = (lag: number) => (lag === 0 ? '' : `${lag > 0 ? '+' : ''}${lag}d`)

export const SCHEDULE_CSV_COLUMNS = [
  { key: 'code', label: 'Activity ID' },
  { key: 'name', label: 'Name' },
  { key: 'phase', label: 'Phase' },
  { key: 'category', label: 'Category' },
  { key: 'duration', label: 'Duration' },
  { key: 'es', label: 'Early Start' },
  { key: 'ef', label: 'Early Finish' },
  { key: 'ls', label: 'Late Start' },
  { key: 'lf', label: 'Late Finish' },
  { key: 'tf', label: 'Total Float' },
  { key: 'critical', label: 'Critical' },
  { key: 'preds', label: 'Predecessors' },
  { key: 'rationale', label: 'Rationale' },
  { key: 'sources', label: 'Sources' },
]

/** Extra columns for progressed (uploaded) schedules: source WBS, status, progress, actuals and baseline. */
export const PROGRESS_CSV_COLUMNS = [
  { key: 'wbs', label: 'WBS' },
  { key: 'status', label: 'Status' },
  { key: 'pct', label: 'Percent Complete' },
  { key: 'remaining', label: 'Remaining Duration' },
  { key: 'as', label: 'Actual Start' },
  { key: 'af', label: 'Actual Finish' },
  { key: 'bs', label: 'Baseline Start' },
  { key: 'bf', label: 'Baseline Finish' },
]
const STATUS_LABEL = { not_started: 'Not Started', in_progress: 'In Progress', complete: 'Completed' } as const

/**
 * One row per activity; Predecessors are "CODE TYPE±lagd" joined by ", " (e.g. "A1000 FS, A1010 SS+2d").
 * Schedules that carry a source WBS or progress (uploads) also get the WBS and progress columns.
 */
export function exportScheduleCsv(s: GeneratedSchedule): string {
  const progressed = !!s.dataDate || s.activities.some(a => a.wbs || a.status || a.actualStart || a.actualFinish || a.baselineStart !== undefined)
  const codeById = new Map(s.activities.map(a => [a.id, a.code]))
  const times = s.cpm?.times ?? {}
  const rows = s.activities.map(a => {
    const t = times[a.id]
    const preds = s.links
      .filter(l => l.to === a.id && codeById.has(l.from))
      .map(l => `${codeById.get(l.from)} ${l.type}${fmtLag(l.lag)}`)
      .join(', ')
    return {
      code: a.code,
      name: a.name,
      phase: a.phase,
      category: a.category,
      duration: a.duration,
      // MM/DD/YYYY, as US schedulers read them (the spreadsheet importer understands this form).
      es: t?.earlyStart ? fmtDate(t.earlyStart) : '',
      ef: t?.earlyFinish ? fmtDate(t.earlyFinish) : '',
      ls: t?.lateStart ? fmtDate(t.lateStart) : '',
      lf: t?.lateFinish ? fmtDate(t.lateFinish) : '',
      tf: t ? t.totalFloat : '',
      critical: t ? t.critical : '',
      preds,
      rationale: fmtDates(a.rationale?.summary ?? ''),
      sources: (a.rationale?.sources ?? []).map(r => (r.detail ? `${r.label} (${r.detail})` : r.label)).join('; '),
      wbs: a.wbs ?? '',
      status: a.status ? STATUS_LABEL[a.status] : a.actualFinish ? STATUS_LABEL.complete : a.actualStart ? STATUS_LABEL.in_progress : STATUS_LABEL.not_started,
      pct: a.percentComplete ?? (a.actualFinish ? 100 : 0),
      remaining: a.actualFinish || a.status === 'complete' ? 0 : (a.remaining ?? a.duration),
      as: a.actualStart ? fmtDate(a.actualStart) : '',
      af: a.actualFinish ? fmtDate(a.actualFinish) : '',
      bs: a.baselineStart ? fmtDate(a.baselineStart) : '',
      bf: a.baselineFinish ? fmtDate(a.baselineFinish) : '',
    }
  })
  if (!progressed) return exportCsv(rows, SCHEDULE_CSV_COLUMNS)
  // WBS right after the name; progress columns before the logic and provenance columns.
  const cols = [...SCHEDULE_CSV_COLUMNS]
  cols.splice(2, 0, PROGRESS_CSV_COLUMNS[0])
  cols.splice(cols.findIndex(c => c.key === 'preds'), 0, ...PROGRESS_CSV_COLUMNS.slice(1))
  return exportCsv(rows, cols)
}

const isoish = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : v)

/**
 * Activity-level differences between two updates (GET /api/schedules/compare?format=csv): one row per
 * change, plus added/deleted activities, logic and calendar changes. Every field goes through csvField,
 * so text from the uploaded files cannot run as a spreadsheet formula.
 */
export function exportComparisonCsv(c: ScheduleComparison): string {
  const rows: Record<string, unknown>[] = []
  const row = (category: string, code: string, name: string, field: string, before: unknown, after: unknown, delta: unknown) =>
    rows.push({ category, code, name, field, before: isoish(before), after: isoish(after), delta })
  for (const w of c.warnings) row('Warning', '', w, '', '', '', '')
  for (const a of c.added) row('Added', a.code, a.name, '', '', '', '')
  for (const a of c.deleted) row('Deleted', a.code, a.name, '', '', '', '')
  for (const x of c.changes) row('Changed', x.code, x.name, x.field.replace(/_/g, ' '), x.before, x.after, x.delta)
  for (const x of c.actualsRewritten) row('Actual rewritten', x.code, x.name, x.field.replace(/_/g, ' '), x.before, x.after, x.delta)
  for (const f of c.floatErosion) row('Float erosion', f.code, f.name, 'total float', f.before, f.after, f.delta)
  for (const l of c.logicAdded) row('Logic added', l.succ, '', `${l.pred} -> ${l.succ} ${l.type}`, '', l.lag, '')
  for (const l of c.logicDeleted) row('Logic deleted', l.succ, '', `${l.pred} -> ${l.succ} ${l.type}`, l.lag, '', '')
  for (const l of c.lagChanged) row('Lag changed', l.succ, '', `${l.pred} -> ${l.succ} ${l.type}`, l.before, l.after, l.after - l.before)
  for (const k of c.calendarChanges) row('Calendar', '', k.calendar, k.field.replace(/_/g, ' '), k.before, k.after, '')
  for (const code of c.criticalPath.entered) row('Driving path', code, '', 'joined', '', '', '')
  for (const code of c.criticalPath.left) row('Driving path', code, '', c.criticalPath.leftDeleted.includes(code) ? 'left (deleted)' : 'left', '', '', '')
  return exportCsv(rows, [
    { key: 'category', label: 'Category' }, { key: 'code', label: 'Activity ID' }, { key: 'name', label: 'Activity Name' },
    { key: 'field', label: 'Field' }, { key: 'before', label: `Before (${c.before.version})` }, { key: 'after', label: `After (${c.after.version})` },
    { key: 'delta', label: 'Change (days)' },
  ])
}
