// PDF Schedule Parser
// Extracts text from PDF and attempts to identify schedule data

import { Activity } from '@/lib/db'
import { randomUUID as uuid } from 'crypto'
import type { ParsedSchedule } from './types'
import { ExceptionCollector } from './exceptions'
import { parseDateCell } from './excel-parser'

/** Text of one PDF page (1-based page number). */
export interface PdfPageText { page: number; text: string }

/** A PDF that can't be read: encrypted, damaged, or not a PDF at all. */
export class PdfReadError extends Error {}

/**
 * Extracts the text layer of a PDF, page by page. Works with pdf-parse v2 (PDFParse class) and the
 * v1 function export. Scanned PDFs (images only) come back with empty pages; callers decide what
 * to do with them.
 */
export async function extractPdfText(buffer: Buffer): Promise<{ pages: PdfPageText[]; text: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('pdf-parse')
    if (typeof mod?.PDFParse === 'function') {
      const parser = new mod.PDFParse({ data: new Uint8Array(buffer) })
      try {
        const res = await parser.getText({ pageJoiner: '' }) as { pages: { num: number; text: string }[]; text: string }
        const pages = res.pages.map(p => ({ page: p.num, text: p.text || '' }))
        return { pages, text: pages.map(p => p.text).join('\n') }
      } finally {
        await parser.destroy?.().catch?.(() => {})
      }
    }
    const fn = typeof mod === 'function' ? mod : mod?.default
    const pages: PdfPageText[] = []
    const data = await fn(buffer, {
      pagerender: async (pageData: { pageIndex: number; getTextContent: () => Promise<{ items: { str: string; hasEOL?: boolean }[] }> }) => {
        const c = await pageData.getTextContent()
        const text = c.items.map(i => i.str + (i.hasEOL ? '\n' : '')).join('')
        pages.push({ page: pageData.pageIndex + 1, text })
        return text
      },
    })
    return { pages: pages.length ? pages.sort((a, b) => a.page - b.page) : [{ page: 1, text: String(data.text || '') }], text: String(data.text || '') }
  } catch (err) {
    if (err instanceof PdfReadError) throw err
    const name = (err as Error)?.name || ''
    // Damaged / not-a-PDF errors from pdf.js; anything else (e.g. the library failing to load) propagates.
    if (!/InvalidPDF|FormatError|Password|UnknownError/i.test(name) && !/password|invalid pdf|pdf header/i.test((err as Error)?.message || '')) throw err
    if (/Password/i.test(name) || /password/i.test((err as Error)?.message || '')) throw new PdfReadError('This PDF is password-protected. Remove the password (or print it to a new PDF) and upload it again.')
    throw new PdfReadError('This file could not be read as a PDF. It may be damaged; try exporting it to PDF again.')
  }
}

export async function parsePDF(buffer: Buffer, scheduleId: string): Promise<ParsedSchedule> {
  const { text } = await extractPdfText(buffer)
  return parsePdfText(text, scheduleId)
}

/** Dates as printed by P6 (02-Nov-26), MS Project (11/2/26) and others (2026-11-02). */
const DATE_TOKEN = /(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{2,4})/g

/** The heuristic reader behind parsePDF, on the PDF's text layer. */
export function parsePdfText(text: string, scheduleId: string): ParsedSchedule {

  // Try to extract project name from first few lines
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
  const projectName = lines[0] || 'Imported PDF Schedule'
  
  // Try to find dates in the text
  const dateRegex = DATE_TOKEN
  const dates = text.match(dateRegex) || []
  const allDates = dates.map(parseFlexDate).filter((d): d is string => !!d).sort()
  
  // Try to extract activities from tabular data
  // Common patterns: ID | Name | Duration | Start | Finish
  const activities: Activity[] = []
  let actCount = 0
  
  for (const line of lines) {
    // Look for lines that might be activity rows
    // Typical: "A1234  Concrete Pour  5d  01/15/2026  01/20/2026"
    const parts = line.split(/\t|  +/)
    if (parts.length >= 3) {
      const possibleName = parts.find((p: string) => p.length > 5 && !/^\d+[\/\-]/.test(p) && !/^\d+d?$/.test(p))
      if (possibleName && actCount < 500) {
        const datesInLine = line.match(dateRegex) || []
        const durationMatch = line.match(/(\d+)\s*d/)
        
        actCount++
        activities.push({
          id: uuid(),
          scheduleId,
          activityId: `PDF-${actCount}`,
          name: possibleName.trim(),
          wbs: '',
          duration: durationMatch ? parseInt(durationMatch[1]) : 0,
          remainingDuration: durationMatch ? parseInt(durationMatch[1]) : 0,
          percentComplete: 0,
          earlyStart: datesInLine[0] ? parseFlexDate(datesInLine[0]) : null,
          earlyFinish: datesInLine[1] ? parseFlexDate(datesInLine[1]) : null,
          lateStart: null,
          lateFinish: null,
          actualStart: null,
          actualFinish: null,
          baselineStart: null,
          baselineFinish: null,
          totalFloat: 0,
          freeFloat: 0,
          isCritical: false,
          status: 'not_started',
          activityType: 'task',
        })
      }
    }
  }
  
  // If we couldn't parse activities, create a summary entry
  if (activities.length === 0) {
    activities.push({
      id: uuid(),
      scheduleId,
      activityId: 'PDF-SUMMARY',
      name: `PDF Schedule - ${lines.length} lines extracted`,
      wbs: '',
      duration: 0,
      remainingDuration: 0,
      percentComplete: 0,
      earlyStart: allDates[0] ?? null,
      earlyFinish: allDates[allDates.length - 1] ?? null,
      lateStart: null,
      lateFinish: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      totalFloat: 0,
      freeFloat: 0,
      isCritical: false,
      status: 'not_started',
      activityType: 'summary',
    })
  }
  
  const ex = new ExceptionCollector('import', 'pdf')
  ex.add({ severity: 'loss', entity: 'relationship', field: 'Logic', disposition: 'dropped', count: Math.max(1, activities.length), message: 'A PDF carries no machine-readable logic; no relationships were imported' })
  ex.add({ severity: 'warning', entity: 'calendar', field: 'Calendar', disposition: 'defaulted', message: 'A PDF carries no calendars; the standard Monday–Friday, 8-hour calendar is used' })
  ex.add({ severity: 'warning', entity: 'activity', field: 'Activity ID', disposition: 'defaulted', count: activities.length, examples: activities.map(a => a.name), message: 'Activities were read heuristically from the text and numbered PDF-1, PDF-2, ...; verify IDs, durations and dates' })
  ex.add({ severity: 'loss', entity: 'other', field: 'Progress, float, constraints, WBS', disposition: 'dropped', count: Math.max(1, activities.length), message: 'Progress, float, constraints and WBS are not read from a PDF' })
  return {
    projectName,
    dataDate: null,
    // Earliest and latest date printed (not the first and last in reading order: a run or print date
    // in the page header came first and was taken as the project start)
    projectStart: allDates[0] ?? null,
    projectFinish: allDates[allDates.length - 1] ?? null,
    activities,
    relationships: [],
    calendars: [],
    defaultCalendarId: null,
    warnings: [
      'PDF has no logic/calendars; relationships are not available',
      'Activities were extracted heuristically from PDF text; verify IDs, durations and dates',
    ],
    exceptions: ex.report(),
    sourceType: 'pdf',
  }
}

/**
 * A printed date as YYYY-MM-DD, read as written (US month/day order). `new Date(str)` read it as local
 * midnight and toISOString() shifted it to the previous day on any server east of UTC.
 */
export function parseFlexDate(str: string): string | null {
  const s = str.trim()
  const md = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/.exec(s)
  return parseDateCell(md ? `${md[1]}/${md[2]}/${md[3]}` : s)
}
