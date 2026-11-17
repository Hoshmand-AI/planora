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
// All the slides of a deck together may unpack to this much; one Word body is already capped by the ZIP reader.
const MAX_DECK_XML_BYTES = 60 * 1024 * 1024

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  }
  return ENTITIES[e.toLowerCase()] ?? ''
})

/**
 * The outermost `<tag …>…</tag>` elements of `xml`, in order; an element of the same tag nested inside one stays
 * inside it. One pass over the text, whatever it holds: an element that is never closed gives nothing.
 */
function elements(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'g')
  let depth = 0, start = 0
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1]) {
      if (depth > 0 && --depth === 0) out.push(xml.slice(start, m.index + m[0].length))
    } else if (!m[0].endsWith('/>')) {
      if (depth++ === 0) start = m.index
    }
  }
  return out
}
/** What an element holds, without its own opening and closing tags. */
const inner = (el: string) => el.slice(el.indexOf('>') + 1, el.lastIndexOf('<'))

/** The text runs of one paragraph, in order; a tab mark becomes a tab when `tabs` is set. One pass. */
function runText(p: string, ns: 'w' | 'a', tabs: boolean): string {
  const re = new RegExp(`<${ns}:t(?=[\\s>/])[^>]*>|</${ns}:t>|<${ns}:tab/>`, 'g')
  let out = '', from = -1
  for (let m = re.exec(p); m; m = re.exec(p)) {
    if (m[0][1] === '/') { if (from >= 0) { out += decode(p.slice(from, m.index)); from = -1 } }
    else if (m[0].endsWith(':tab/>')) { if (tabs && from < 0) out += '\t' }
    else if (!m[0].endsWith('/>') && from < 0) from = m.index + m[0].length
  }
  return out
}

/** The text of one table cell: its paragraphs joined by a space. `ns` is the XML prefix (w for Word, a for PowerPoint). */
function cellText(cell: string, ns: 'w' | 'a'): string {
  return elements(cell, `${ns}:p`).map(p => runText(p, ns, false)).join(' ').replace(/\s+/g, ' ').trim()
}

/** Every table in a Word body or a PowerPoint slide, as rows of cell text. A table inside a cell is a table of its own. */
export function ooxmlTables(xml: string, ns: 'w' | 'a', depth = 0): string[][][] {
  const tables: string[][][] = []
  for (const t of elements(xml, `${ns}:tbl`)) {
    const rows: string[][] = [], nested: string[][][] = []
    for (const r of elements(inner(t), `${ns}:tr`)) {
      const cells: string[] = []
      for (const c of elements(inner(r), `${ns}:tc`)) {
        let body = inner(c)
        // A table inside this cell is read on its own, and its text is not this cell's text.
        const inside = elements(body, `${ns}:tbl`)
        if (inside.length) {
          for (const n of inside) { body = body.replace(n, ''); if (depth < 4) for (const nt of ooxmlTables(n, ns, depth + 1)) nested.push(nt) }
        }
        cells.push(cellText(body, ns))
        // Word writes a cell merged across columns once, with its span; PowerPoint writes the covered cells itself.
        if (ns === 'w') {
          const at = body.indexOf('<w:gridSpan')
          const span = at < 0 ? 1 : Number(/w:val="(\d+)"/.exec(body.slice(at, at + 80))?.[1] ?? 1)
          for (let i = 1; i < Math.min(span, 64); i++) cells.push('')
        }
      }
      if (cells.some(Boolean)) rows.push(cells)
      if (rows.length > MAX_TABLE_ROWS) break
    }
    if (rows.length >= 2) tables.push(rows)
    for (const n of nested) tables.push(n)
  }
  return tables
}

/** The plain lines of a slide or a document body, one per paragraph. */
function ooxmlLines(xml: string, ns: 'w' | 'a'): string[] {
  return elements(xml, `${ns}:p`).map(p => runText(p, ns, true)).filter(l => l.trim())
}

// Quoted whenever the text holds anything the spreadsheet reader could take for a column separator.
const csvCell = (v: string) => (/[",;\t\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
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
    if (first) { for (const r of t.slice(1)) first.push(r) }
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
  let found = 0, total = 0
  for (let n = 1; n <= MAX_SLIDES; n++) {
    const xml = readZipEntry(data, `ppt/slides/slide${n}.xml`)
    // Slides are numbered from 1; a deck can skip a number after a slide is deleted, so a few misses are allowed.
    if (!xml) { if (n - found > 20) break; continue }
    found = n
    total += xml.length
    if (total > MAX_DECK_XML_BYTES) throw new DocxReadError('This .docx document is too large to read.')
    const text = xml.toString('utf8')
    for (const t of ooxmlTables(text, 'a')) tables.push(t)
    for (const l of ooxmlLines(text, 'a')) lines.push(l)
  }
  if (!found) throw new DocxReadError('This file is not a PowerPoint .pptx presentation.')
  return { tables, lines }
}

/** The tables of a Word document or a PowerPoint deck, continued tables joined (for the cost and resource readers). */
export const officeTables = (data: Buffer, kind: 'docx' | 'pptx'): string[][][] => joinContinuedTables(readParts(data, kind).tables)

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
