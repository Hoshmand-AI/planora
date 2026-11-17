// A schedule kept in a Word document or a PowerPoint deck: a table of activities with dates, sometimes spread
// over pages or slides, sometimes only lines of text. The tables are read out of the file (a .docx or .pptx is
// a ZIP of XML) and given to the same reader that takes a spreadsheet, so the columns it knows are the same:
// activity ID, name, duration, start, finish, predecessors and the rest. A file with no usable table is read
// line by line, like a printed schedule.
//
// What comes out is what the file holds. A table without predecessors gives activities with dates and no logic,
// and the upload says so; nothing is invented.

import { DocxReadError, readZipEntry } from '@/lib/rag/docx'
import { parseSpreadsheet } from './excel-parser'
import { parsePdfText } from './pdf-parser'
import type { ParsedSchedule } from './types'

const MAX_SLIDES = 400
const MAX_TABLE_ROWS = 20_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  }
  return ENTITIES[e.toLowerCase()] ?? ''
})

/** The text of one table cell: its paragraphs joined by a space. `ns` is the XML prefix (w for Word, a for PowerPoint). */
function cellText(cell: string, ns: 'w' | 'a'): string {
  const paras = cell.match(new RegExp(`<${ns}:p[\\s>][\\s\\S]*?</${ns}:p>`, 'g')) || []
  return paras.map(p => [...p.matchAll(new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>`, 'g'))].map(m => decode(m[1])).join('')).join(' ').replace(/\s+/g, ' ').trim()
}

/** Every table in a Word body or a PowerPoint slide, as rows of cell text. */
export function ooxmlTables(xml: string, ns: 'w' | 'a'): string[][][] {
  const tables: string[][][] = []
  for (const t of xml.match(new RegExp(`<${ns}:tbl[\\s>][\\s\\S]*?</${ns}:tbl>`, 'g')) || []) {
    const rows: string[][] = []
    for (const r of t.match(new RegExp(`<${ns}:tr[\\s>][\\s\\S]*?</${ns}:tr>`, 'g')) || []) {
      const cells = (r.match(new RegExp(`<${ns}:tc[\\s>][\\s\\S]*?</${ns}:tc>`, 'g')) || []).map(c => cellText(c, ns))
      if (cells.some(Boolean)) rows.push(cells)
      if (rows.length > MAX_TABLE_ROWS) break
    }
    if (rows.length >= 2) tables.push(rows)
  }
  return tables
}

/** The plain lines of a slide or a document body, one per paragraph. */
function ooxmlLines(xml: string, ns: 'w' | 'a'): string[] {
  const paras = xml.match(new RegExp(`<${ns}:p[\\s>][\\s\\S]*?</${ns}:p>`, 'g')) || []
  return paras.map(p => [...p.matchAll(new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:tab/>`, 'g'))].map(m => (m[1] !== undefined ? decode(m[1]) : '\t')).join('')).filter(l => l.trim())
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const toCsv = (rows: string[][]) => rows.map(r => r.map(csvCell).join(',')).join('\n')

/**
 * A table that continues on the next page or slide repeats its header row. Tables with the same header are
 * joined into one, in the order they appear.
 */
export function joinContinuedTables(tables: string[][][]): string[][][] {
  const joined: string[][][] = [], byHeader = new Map<string, string[][]>()
  for (const t of tables) {
    const key = t[0].map(c => c.toLowerCase()).join('\u0001')
    const first = byHeader.get(key)
    if (first) first.push(...t.slice(1))
    else { const copy = t.map(r => [...r]); byHeader.set(key, copy); joined.push(copy) }
  }
  return joined
}

function readParts(data: Buffer, kind: 'docx' | 'pptx'): { tables: string[][][]; lines: string[] } {
  if (kind === 'docx') {
    const xml = readZipEntry(data, 'word/document.xml')
    if (!xml) throw new DocxReadError('This file is not a Word .docx document.')
    const text = xml.toString('utf8')
    return { tables: ooxmlTables(text, 'w'), lines: ooxmlLines(text, 'w') }
  }
  const tables: string[][][] = [], lines: string[] = []
  let found = 0
  for (let n = 1; n <= MAX_SLIDES; n++) {
    const xml = readZipEntry(data, `ppt/slides/slide${n}.xml`)
    // Slides are numbered from 1; a deck can skip a number after a slide is deleted, so a few misses are allowed.
    if (!xml) { if (n - found > 20) break; continue }
    found = n
    const text = xml.toString('utf8')
    tables.push(...ooxmlTables(text, 'a'))
    lines.push(...ooxmlLines(text, 'a'))
  }
  if (!found) throw new DocxReadError('This file is not a PowerPoint .pptx presentation.')
  return { tables, lines }
}

/** Reads a schedule from a Word document or a PowerPoint deck. */
export async function parseOfficeDocument(data: Buffer, fileName: string, scheduleId: string, kind: 'docx' | 'pptx'): Promise<ParsedSchedule> {
  const what = kind === 'docx' ? 'Word document' : 'PowerPoint deck'
  let parts: { tables: string[][][]; lines: string[] }
  try { parts = readParts(data, kind) } catch (err) {
    if (err instanceof DocxReadError) throw new Error(err.message.replace(/\.docx/g, kind === 'docx' ? '.docx' : '.pptx'))
    throw new Error(`This ${what} could not be read. It may be damaged; save it again and upload it.`)
  }
  // Each table is offered to the spreadsheet reader; the one that gives the most activities is the schedule.
  let best: ParsedSchedule | null = null
  for (const table of joinContinuedTables(parts.tables)) {
    try {
      const parsed = await parseSpreadsheet(Buffer.from(toCsv(table), 'utf8'), fileName.replace(/\.[a-z0-9]+$/i, '.csv'), scheduleId)
      if (!best || parsed.activities.length > best.activities.length) best = parsed
    } catch { /* not a schedule table: a title block, a legend, a sign-off table */ }
  }
  const sourceType = kind === 'docx' ? 'word' as const : 'powerpoint' as const
  if (best && best.activities.length) {
    return { ...best, sourceType, warnings: [`Read from the schedule table in this ${what}. Only what the table holds was imported.`, ...best.warnings] }
  }
  // No table the reader understands: read the text line by line, as for a printed schedule.
  const text = parts.lines.join('\n')
  if (!text.trim()) throw new Error(`This ${what} has no text to read (its schedule may be a picture). Export the schedule from the scheduling tool, or upload it as a PDF or a spreadsheet.`)
  const fromText = parsePdfText(text, scheduleId)
  if (!fromText.activities.length || fromText.activities.every(a => /SUMMARY/.test(a.activityId))) {
    throw new Error(`No schedule was found in this ${what}: it needs a table (or lines) with activity names and dates. Export the schedule from the scheduling tool, or upload it as a spreadsheet.`)
  }
  return { ...fromText, sourceType, warnings: [`No schedule table was found in this ${what}, so its lines of text were read for activities and dates. Check the result against the original.`, ...fromText.warnings] }
}
