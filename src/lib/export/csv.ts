// RFC 4180 CSV export (CRLF line endings, fields quoted when needed).

import type { GeneratedSchedule } from '@/lib/planning/types'
import { fmtDate, fmtDates } from '@/lib/format'

function cellString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString()
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return isFinite(v) ? String(v) : ''
  if (Array.isArray(v)) return v.map(cellString).join('; ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function csvField(v: unknown): string {
  const s = cellString(v)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

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

/** One row per activity; Predecessors are "CODE TYPE±lagd" joined by ", " (e.g. "A1000 FS, A1010 SS+2d"). */
export function exportScheduleCsv(s: GeneratedSchedule): string {
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
    }
  })
  return exportCsv(rows, SCHEDULE_CSV_COLUMNS)
}
