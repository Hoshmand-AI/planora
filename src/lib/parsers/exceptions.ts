// Import / export exception reports: "never silently drop schedule data".
//
// Every parser and exporter records what it saw but could not carry over (a table, field or element
// it did not map), and every value it had to change on the way (an unsupported constraint converted,
// a calendar defaulted, a duration rounded, a lag converted). The free-text upload warnings remain;
// this is the structured, countable account behind them, stored with the upload and shown in the UI.

import { fmtDates } from '@/lib/format'

export type ExceptionDirection = 'import' | 'export'
export type ExceptionSeverity = 'info' | 'warning' | 'loss'
export type ExceptionEntity =
  | 'activity' | 'relationship' | 'calendar' | 'resource' | 'assignment' | 'code' | 'udf'
  | 'baseline' | 'constraint' | 'project' | 'other'
export type ExceptionDisposition = 'dropped' | 'converted' | 'defaulted' | 'preserved_in_raw'

export const EXCEPTION_ENTITIES: ExceptionEntity[] = ['activity', 'relationship', 'calendar', 'constraint', 'resource', 'assignment', 'code', 'udf', 'baseline', 'project', 'other']
export const EXCEPTION_DISPOSITIONS: ExceptionDisposition[] = ['dropped', 'converted', 'defaulted', 'preserved_in_raw']

export interface ExceptionRecord {
  direction: ExceptionDirection
  /** Source or target format: p6_xer, p6_xml, ms_xml, excel, csv, pdf, xlsx-import, ... */
  format: string
  severity: ExceptionSeverity
  entity: ExceptionEntity
  /** Table / element / column and field, e.g. "UDFVALUE", "TASK.cstr_type2", "Task.Baseline[1]" */
  field: string
  /** Occurrences (rows, elements or activities affected) */
  count: number
  /** Up to MAX_EXAMPLES source ids (activity ids, table row keys, column names) */
  examples: string[]
  disposition: ExceptionDisposition
  message: string
}

export interface ExceptionReport {
  direction: ExceptionDirection
  format: string
  records: ExceptionRecord[]
}

export interface ExceptionSummary {
  total: number
  /** Records whose data did not survive (severity loss) */
  losses: number
  byEntity: Partial<Record<ExceptionEntity, number>>
  byDisposition: Partial<Record<ExceptionDisposition, number>>
}

export const MAX_EXAMPLES = 10

type AddInput = {
  severity: ExceptionSeverity
  entity: ExceptionEntity
  field: string
  disposition: ExceptionDisposition
  message: string
  /** Defaults to 1 per call */
  count?: number
  example?: string | null
  examples?: (string | null | undefined)[]
}

/**
 * Collects exception records, merging repeats of the same entity + field + disposition into one
 * record with a count and a few example ids.
 */
export class ExceptionCollector {
  private readonly records = new Map<string, ExceptionRecord>()
  constructor(readonly direction: ExceptionDirection, readonly format: string) {}

  add(r: AddInput): void {
    const key = `${r.entity}|${r.field}|${r.disposition}`
    let rec = this.records.get(key)
    if (!rec) {
      rec = { direction: this.direction, format: this.format, severity: r.severity, entity: r.entity, field: r.field, count: 0, examples: [], disposition: r.disposition, message: r.message }
      this.records.set(key, rec)
    } else if (rank(r.severity) > rank(rec.severity)) rec.severity = r.severity
    rec.count += r.count ?? 1
    for (const ex of [r.example, ...(r.examples || [])]) {
      if (ex == null || ex === '') continue
      const s = String(ex).slice(0, 80)
      if (rec.examples.length < MAX_EXAMPLES && !rec.examples.includes(s)) rec.examples.push(s)
    }
  }

  get size(): number { return this.records.size }

  report(): ExceptionReport {
    const records = Array.from(this.records.values()).filter(r => r.count > 0)
    records.sort((a, b) => rank(b.severity) - rank(a.severity) || EXCEPTION_ENTITIES.indexOf(a.entity) - EXCEPTION_ENTITIES.indexOf(b.entity) || a.field.localeCompare(b.field))
    return { direction: this.direction, format: this.format, records }
  }
}

function rank(s: ExceptionSeverity): number {
  return s === 'loss' ? 2 : s === 'warning' ? 1 : 0
}

export function emptyReport(direction: ExceptionDirection, format: string): ExceptionReport {
  return { direction, format, records: [] }
}

/** Counts by entity and by disposition (occurrences, not records). */
export function summarizeExceptions(report: ExceptionReport | null | undefined): ExceptionSummary {
  const out: ExceptionSummary = { total: 0, losses: 0, byEntity: {}, byDisposition: {} }
  for (const r of report?.records || []) {
    out.total += r.count
    if (r.severity === 'loss') out.losses += r.count
    out.byEntity[r.entity] = (out.byEntity[r.entity] ?? 0) + r.count
    out.byDisposition[r.disposition] = (out.byDisposition[r.disposition] ?? 0) + r.count
  }
  return out
}

export const DISPOSITION_LABEL: Record<ExceptionDisposition, string> = {
  dropped: 'Not carried over', converted: 'Converted', defaulted: 'Defaulted', preserved_in_raw: 'Kept in the original file only',
}

/** One plain-language line per record (for provenance sheets and reports); dates MM/DD/YYYY. */
export function exceptionLines(report: ExceptionReport | null | undefined): string[] {
  return (report?.records || []).map(r =>
    fmtDates(`${DISPOSITION_LABEL[r.disposition]} · ${r.entity} · ${r.field} · ${r.count}${r.examples.length ? ` (e.g. ${r.examples.slice(0, 3).join(', ')})` : ''}: ${r.message}`))
}

/** Label/value rows for an XLSX provenance sheet. */
export function exceptionRows(report: ExceptionReport | null | undefined, title: string): [string, string][] {
  const lines = exceptionLines(report)
  if (!lines.length) return [[title, 'None: everything in this schedule was written in this format']]
  return lines.map((l, i) => [i === 0 ? title : '', l])
}

/**
 * A compact, ASCII-only JSON form for an HTTP response header: the summary plus each record's
 * entity / field / disposition / count (examples and messages only while the header stays small).
 */
export function exceptionHeader(report: ExceptionReport | null | undefined, maxBytes = 3500): string {
  const records = report?.records || []
  const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const base = { format: report?.format ?? '', direction: report?.direction ?? 'export', summary: summarizeExceptions(report) }
  const full = ascii(JSON.stringify({ ...base, records: records.map(r => ({ entity: r.entity, field: r.field, disposition: r.disposition, severity: r.severity, count: r.count, examples: r.examples.slice(0, 3) })) }))
  if (full.length <= maxBytes) return full
  const slim = ascii(JSON.stringify({ ...base, records: records.map(r => [r.entity, r.field, r.disposition, r.count]) }))
  if (slim.length <= maxBytes) return slim
  return ascii(JSON.stringify({ ...base, truncated: true }))
}

/** Reads a stored report defensively (jsonb from older rows or other writers). */
export function asExceptionReport(v: unknown): ExceptionReport | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<ExceptionReport>
  if (!Array.isArray(o.records)) return null
  return { direction: o.direction === 'export' ? 'export' : 'import', format: String(o.format ?? ''), records: o.records.filter(r => r && typeof r === 'object' && typeof (r as ExceptionRecord).count === 'number') as ExceptionRecord[] }
}

/** Merge reports of the same direction (e.g. the import report carried into an export report). */
export function mergeReports(direction: ExceptionDirection, format: string, ...reports: (ExceptionReport | null | undefined)[]): ExceptionReport {
  const c = new ExceptionCollector(direction, format)
  for (const rep of reports) for (const r of rep?.records || []) c.add({ ...r, examples: r.examples })
  return c.report()
}

/** True when a rounded value differs from the exact one by more than floating-point noise. */
export function wasRounded(exact: number, rounded: number): boolean {
  return Math.abs(exact - rounded) > 1e-6
}
