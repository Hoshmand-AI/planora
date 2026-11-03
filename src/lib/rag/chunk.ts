// Structure-aware chunking for contracts and specifications. Text is split at headings and numbered
// clauses first, then packed into passages of roughly 800–1200 characters with a small overlap when
// a long clause has to be cut. Every passage keeps its page number(s) and the clause / section it
// belongs to, so answers can cite "[Title §1.3.4 p.3]".
//
// Anchors recognized at the start of a line:
//   CSI MasterFormat sections   "SECTION 01 32 16 – CONSTRUCTION PROGRESS SCHEDULE"
//   Contract articles           "ARTICLE 8  TIME", "Article 8."
//   Spec parts                  "PART 1 - GENERAL"
//   Numbered clauses            "1.3.4 Schedule Updates", "8.2.1", "§ 4.2"
//   Markdown / Word headings    "# Owner Requirements"
//   Short ALL-CAPS headings     "LIQUIDATED DAMAGES"

import type { DraftChunk } from './types'

export const CHUNK_MIN = 800
export const CHUNK_MAX = 1200
export const CHUNK_OVERLAP = 150
/**
 * A clause / heading boundary closes the current passage once it holds more than a heading's worth
 * of text, so a citation's section anchor always matches the clause the text came from. Running text
 * without clause numbers is packed to CHUNK_MIN–CHUNK_MAX.
 */
const BOUNDARY_MIN = 80
/** A unit that is only a heading line ("ARTICLE 8 TIME", "1.3 SCHEDULE UPDATES"). */
const isHeadingOnly = (u: Unit) => u.boundary && !u.text.includes('\n') && u.text.length <= 120 && !/[.;:]\s*\S/.test(u.text.slice(0, -1))

export interface PageText { page: number | null; text: string }

interface Anchor { csi: string | null; article: string | null; clause: string | null; heading: string | null }

interface Unit { text: string; page: number | null; anchor: Anchor; boundary: boolean }

const CSI = /^(?:#{1,6}\s*)?SECTION\s+(\d{2})\s?(\d{2})\s?(\d{2})(?:\.(\d{2}))?\b[\s.:\-–—]*(.*)$/i
const ARTICLE = /^(?:#{1,6}\s*)?ARTICLE\s+(\d{1,3}|[IVXLC]{1,7})\b[\s.:\-–—]*(.*)$/i
const PART = /^(?:#{1,6}\s*)?PART\s+(\d)\b[\s.:\-–—]*(.*)$/i
const CLAUSE = /^(?:#{1,6}\s*)?(?:§\s*)?(\d{1,2}(?:\.\d{1,3}){1,4})\.?(?:\s+([A-Za-z(“"'].*))?$/
const SECTION_SIGN = /^§\s*(\d{1,3}(?:\.\d{1,3}){0,4})\b\.?\s*(.*)$/
const MD = /^(#{1,6})\s+(.+)$/

/** True for a short line in capitals that reads as a heading ("LIQUIDATED DAMAGES"). */
function capsHeading(line: string): boolean {
  if (line.length > 80 || line.length < 4) return false
  const letters = line.replace(/[^A-Za-z]/g, '')
  if (letters.length < 4 || letters !== letters.toUpperCase()) return false
  return !/[.;,]$/.test(line)
}

const romanToInt = (r: string) => {
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 }
  let n = 0
  for (let i = 0; i < r.length; i++) {
    const a = v[r[i]], b = v[r[i + 1]] ?? 0
    n += a < b ? -a : a
  }
  return n
}

/** The anchor a line sets, or null when the line is ordinary text. */
export function detectAnchor(rawLine: string, cur: Anchor): Anchor | null {
  const line = rawLine.trim()
  if (!line) return null
  let m = CSI.exec(line)
  if (m) return { csi: `${m[1]} ${m[2]} ${m[3]}${m[4] ? '.' + m[4] : ''}`, article: null, clause: null, heading: m[5]?.trim() || null }
  m = ARTICLE.exec(line)
  if (m) {
    const num = /^\d+$/.test(m[1]) ? m[1] : String(romanToInt(m[1].toUpperCase()))
    return { ...cur, article: num, clause: null, heading: m[2]?.trim() || null }
  }
  m = PART.exec(line)
  if (m) return { ...cur, clause: null, heading: `Part ${m[1]}${m[2] ? ' ' + m[2].trim() : ''}` }
  m = SECTION_SIGN.exec(line)
  if (m) return { ...cur, clause: m[1], heading: m[2]?.trim().slice(0, 120) || cur.heading }
  m = CLAUSE.exec(line)
  if (m && !/^\d+\.\d+\s*(?:%|days?|inches|in\.|ft|feet|mm|cm|m\b)/i.test(line)) {
    const title = m[2]?.trim() || ''
    // Use the clause title as heading only when it is short (a heading, not a sentence).
    return { ...cur, clause: m[1], heading: title && title.length <= 80 && !/[.;]$/.test(title) ? title : cur.heading }
  }
  m = MD.exec(line)
  if (m) return { ...cur, clause: null, heading: m[2].trim().slice(0, 120) }
  if (capsHeading(line)) return { ...cur, heading: line.slice(0, 120) }
  return null
}

/** The human citation anchor for a passage: "Section 01 32 16 1.3.4", "8.2.1", "Article 8", or a heading. */
export function sectionLabel(a: Anchor): string | null {
  const parts: string[] = []
  if (a.csi) parts.push(`Section ${a.csi}`)
  else if (a.article && !(a.clause && a.clause.split('.')[0] === a.article)) parts.push(`Article ${a.article}`)
  if (a.clause) parts.push(a.clause)
  return parts.join(' ') || null
}

/** Normalizes extracted text: unifies line endings, removes control characters and hyphenation at line ends. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/ /g, ' ')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
}

function splitLong(text: string, max: number): string[] {
  const sentences = text.split(/(?<=[.;:!?])\s+/)
  const out: string[] = []
  let cur = ''
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (const s of sentences) {
    if (s.length > max) {
      push()
      const words = s.split(/\s+/)
      for (const w of words) {
        if (cur.length + w.length + 1 > max - 200) push()
        cur += (cur ? ' ' : '') + w
      }
      push()
      continue
    }
    if (cur.length + s.length + 1 > max - 200) push()
    cur += (cur ? ' ' : '') + s
  }
  push()
  return out
}

function toUnits(pages: PageText[]): Unit[] {
  const units: Unit[] = []
  let anchor: Anchor = { csi: null, article: null, clause: null, heading: null }
  let lines: string[] = []
  let unitAnchor = anchor
  let unitPage: number | null = null
  let boundary = false
  const flush = () => {
    const text = lines.join('\n').replace(/\n{2,}/g, '\n').trim()
    if (text) units.push({ text, page: unitPage, anchor: unitAnchor, boundary })
    lines = []
    boundary = false
  }
  for (const pg of pages) {
    for (const raw of normalizeText(pg.text).split('\n')) {
      const line = raw.trim()
      if (!line) { flush(); continue }
      // Page furniture: bare page numbers ("12", "Page 3 of 40", "-- 3 of 40 --").
      if (/^(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?$/i.test(line) || /^-+\s*\d+\s+of\s+\d+\s*-+$/i.test(line)) continue
      const next = detectAnchor(line, anchor)
      if (next) {
        flush()
        anchor = next
        boundary = true
      }
      if (!lines.length) { unitAnchor = anchor; unitPage = pg.page }
      lines.push(line.replace(/^#{1,6}\s+/, ''))
    }
    flush()
  }
  flush()
  // Split oversized units, keeping the anchor; only the first piece is a boundary.
  return units.flatMap(u => u.text.length <= CHUNK_MAX ? [u] : splitLong(u.text, CHUNK_MAX).map((t, i) => ({ ...u, text: t, boundary: u.boundary && i === 0 })))
}

/** Tail of a passage (≤ CHUNK_OVERLAP chars) starting at a word or sentence boundary. */
function overlapTail(text: string): string {
  if (text.length <= CHUNK_OVERLAP) return ''
  const tail = text.slice(-CHUNK_OVERLAP)
  const sentence = tail.search(/(?<=[.;:!?])\s+\S/)
  if (sentence >= 0) return tail.slice(sentence).trim()
  const space = tail.indexOf(' ')
  return space >= 0 ? tail.slice(space + 1).trim() : ''
}

/** Splits extracted pages into cited passages. */
export function chunkDocument(pages: PageText[]): DraftChunk[] {
  const units = toUnits(pages)
  const chunks: DraftChunk[] = []
  let cur: { parts: string[]; len: number; first: Unit | null; last: Unit | null } = { parts: [], len: 0, first: null, last: null }
  const flush = (withOverlap: boolean) => {
    if (!cur.first || !cur.len) return
    const text = cur.parts.join('\n').trim()
    chunks.push({
      ordinal: chunks.length,
      page: cur.first.page,
      pageEnd: cur.last?.page ?? cur.first.page,
      section: sectionLabel(cur.first.anchor),
      heading: cur.first.anchor.heading,
      text,
    })
    const tail = withOverlap ? overlapTail(text) : ''
    cur = { parts: tail ? [tail] : [], len: tail.length, first: null, last: null }
  }
  let headingsOnly = true
  for (const u of units) {
    const hasContent = cur.first !== null
    if (hasContent && u.boundary && cur.len >= BOUNDARY_MIN && !headingsOnly) flush(false)
    else if (hasContent && cur.len + u.text.length + 1 > CHUNK_MAX) flush(!u.boundary)
    else if (!hasContent && u.boundary && cur.len) cur = { parts: [], len: 0, first: null, last: null }
    if (!cur.first) { cur.first = u; headingsOnly = true }
    // A passage that so far holds only headings takes the more specific anchor of what follows.
    else if (headingsOnly && u.boundary) cur.first = { ...u, page: cur.first.page, anchor: { ...u.anchor, heading: u.anchor.heading ?? cur.first.anchor.heading } }
    if (!isHeadingOnly(u)) headingsOnly = false
    cur.parts.push(u.text)
    cur.len += u.text.length + 1
    cur.last = u
    if (cur.len >= CHUNK_MIN && cur.len >= CHUNK_MAX - 100) flush(true)
  }
  flush(false)
  return chunks
}

/** Average non-whitespace characters per page: near zero for scanned (image-only) PDFs. */
export function textDensity(pages: PageText[]): number {
  if (!pages.length) return 0
  const chars = pages.reduce((n, p) => n + p.text.replace(/\s+/g, '').length, 0)
  return chars / pages.length
}
