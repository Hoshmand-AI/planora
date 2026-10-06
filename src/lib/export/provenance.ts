// Provenance for every generated report and spreadsheet export: which file the numbers came from
// (name and SHA-256 of the stored original), which Planora release calculated them, with which
// progress mode and calculation settings, and as of which data date. Forensic reviewers need this
// to reproduce a result; the SHA-256 ties the output to the exact bytes in schedule_files.
//
// CSV exports deliberately carry no provenance row (a comment row breaks re-import); provenance goes
// in report headers and in XLSX workbook metadata plus a "Provenance" sheet.

import type ExcelJS from 'exceljs'
import type { Schedule } from '@/lib/db'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import type { ProgressMode } from '@/lib/planning/types'
import { DEFAULT_DCMA_RULES, type DcmaRules } from '@/lib/analysis/dcma'
import { fmtDate } from '@/lib/format'
import { neutralizeFormula } from './csv'

export interface ProvenanceSource {
  /** e.g. "Earlier update" / "Later update"; omitted for a single-schedule output */
  role?: string
  scheduleName: string
  version: string
  fileName: string
  /** SHA-256 of the stored original upload; null when the original was not kept (older uploads, generated plans) */
  sha256: string | null
  dataDate: string | null
  progressMode: ProgressMode
}

export interface Provenance {
  sources: ProvenanceSource[]
  /** Planora release id (the same value /api/health reports as "release") */
  release: string
  /** Calculation settings in plain language */
  settings: string[]
  generatedAt: string
}

/** The running release: the same rule as GET /api/health. */
export function planoraRelease(env: Record<string, string | undefined> = process.env): string {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || env.PLANORA_RELEASE || 'local'
}

const MODE_TEXT: Record<ProgressMode, string> = { retained: 'Retained logic', override: 'Progress override' }

/** The calculation settings Planora applied to one schedule, in plain language. */
export function calculationSettings(s: Pick<Schedule, 'calendars' | 'defaultCalendarId'>, analysis: Pick<ScheduleAnalysis, 'progressMode' | 'mustFinishBy' | 'finishMilestone'> | null, rules?: Partial<DcmaRules> | null): string[] {
  const cal = s.calendars?.find(c => c.id === s.defaultCalendarId) ?? s.calendars?.[0]
  const r = { ...DEFAULT_DCMA_RULES, ...(rules || {}) }
  const fm = analysis?.finishMilestone
  return [
    `CPM recalculation by Planora (dates and float from logic, durations, calendars and constraints, not from the file); out-of-sequence progress: ${MODE_TEXT[analysis?.progressMode ?? 'retained']}`,
    'Total float: most critical of start and finish float, in work days of each activity\'s own calendar; relationship lag on the predecessor\'s calendar',
    `Float anchor: ${analysis?.mustFinishBy ? `required finish ${fmtDate(analysis.mustFinishBy)} (Must Finish By)` : 'project early finish'}`,
    `Finish milestone: ${fm ? `${fm.code} ${fm.name} (${fm.designated ? 'designated by the scheduler' : 'picked automatically'})` : 'none (project forecast finish)'}`,
    `Default calendar: ${cal ? cal.name : 'standard 5-day'}`,
    `Mandatory constraints (MSO/MFO): forecasts use the logic-driven date where a constraint overrules logic`,
    `DCMA thresholds: ${r.maxPct}% max offenders, ${r.minFsPct}% min FS, high float > ${r.highFloatDays} wd, high duration > ${r.highDurationDays} wd, CPLI/BEI >= ${r.indexTarget.toFixed(2)}; BEI/missed tasks count baseline finishes before the data date`,
  ]
}

/** Label/value rows (dates MM/DD/YYYY). */
export function provenanceRows(p: Provenance): [string, string][] {
  const rows: [string, string][] = []
  for (const s of p.sources) {
    const pre = s.role ? `${s.role}: ` : ''
    rows.push([`${pre}Schedule`, `${s.scheduleName} (${s.version})`])
    rows.push([`${pre}Source file`, s.fileName || '—'])
    rows.push([`${pre}SHA-256`, s.sha256 || 'not recorded (original file not retained)'])
    rows.push([`${pre}Data date`, s.dataDate ? fmtDate(s.dataDate) : '—'])
    rows.push([`${pre}Progress mode`, MODE_TEXT[s.progressMode]])
  }
  rows.push(['Planora version (release)', p.release])
  p.settings.forEach((x, i) => rows.push([i === 0 ? 'Calculation settings' : '', x]))
  rows.push(['Generated', `${fmtDate(p.generatedAt)} ${p.generatedAt.slice(11, 16)} UTC`])
  return rows
}

export const PROVENANCE_HEADING = '## Provenance'

/** Markdown header block for reports. Pipes and line breaks in file names cannot break the table. */
export function provenanceMarkdown(p: Provenance): string[] {
  const cell = (v: string) => v.replace(/\|/g, '/').replace(/\s+/g, ' ')
  return [PROVENANCE_HEADING, '', '| Item | Value |', '|---|---|', ...provenanceRows(p).map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`), '']
}

/** Adds the provenance block to a report unless it already has one (AI-written reports). */
export function withProvenance(markdown: string, p: Provenance | null | undefined): string {
  if (!p || markdown.includes(PROVENANCE_HEADING)) return markdown
  return `${markdown.trimEnd()}\n\n${provenanceMarkdown(p).join('\n')}`
}

/**
 * Workbook metadata (title, subject, keywords = SHA-256s, description) and a "Provenance" sheet.
 * Call it before adding other sheets to make Provenance the first sheet.
 */
export function addProvenance(wb: ExcelJS.Workbook, p: Provenance, title: string): ExcelJS.Worksheet {
  wb.creator = 'Planora'
  wb.title = title
  wb.subject = p.sources.map(s => `${s.scheduleName} (${s.version})`).join(' vs ')
  wb.keywords = p.sources.map(s => s.sha256 ? `sha256:${s.sha256}` : '').filter(Boolean).join(' ')
  wb.description = provenanceRows(p).map(([k, v]) => (k ? `${k}: ${v}` : v)).join('\n')
  wb.company = `Planora ${p.release}`
  const ws = wb.addWorksheet('Provenance')
  ws.columns = [{ header: 'Item', key: 'k', width: 34 }, { header: 'Value', key: 'v', width: 110 }]
  for (const [k, v] of provenanceRows(p)) ws.addRow({ k: neutralizeFormula(k), v: neutralizeFormula(v) })
  ws.getRow(1).font = { bold: true }
  ws.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
  return ws
}

/** Builds the provenance of one or more loaded schedules (reads only the file name and hash, org-scoped). */
export async function loadProvenance(
  orgId: string,
  items: { role?: string; schedule: Pick<Schedule, 'id' | 'name' | 'version' | 'fileName' | 'dataDate' | 'calendars' | 'defaultCalendarId'>; analysis: ScheduleAnalysis | null }[],
  rules?: Partial<DcmaRules> | null,
): Promise<Provenance> {
  const { getScheduleFileMeta } = await import('@/lib/db')
  const sources: ProvenanceSource[] = []
  for (const it of items) {
    const meta = await getScheduleFileMeta(it.schedule.id, orgId).catch(() => undefined)
    sources.push({
      role: it.role, scheduleName: it.schedule.name, version: it.schedule.version, fileName: meta?.fileName || it.schedule.fileName,
      sha256: meta?.sha256 ?? null, dataDate: it.schedule.dataDate, progressMode: it.analysis?.progressMode ?? 'retained',
    })
  }
  const first = items[0]
  return { sources, release: planoraRelease(), settings: first ? calculationSettings(first.schedule, first.analysis, rules) : [], generatedAt: new Date().toISOString() }
}
