// Citations: every passage given to a model carries an exact citation string, and every citation in
// the model's answer is checked against the passages that were actually retrieved. A citation that
// does not match one of them (an invented clause, a wrong page, a document that was never retrieved)
// is removed from the answer and counted, so a reader never sees a reference Planora can't back.

export interface Citable {
  chunkId: string
  documentId: string
  title: string
  section: string | null
  page: number | null
  pageEnd: number | null
  ordinal: number
}

const clean = (s: string) => s.replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')')).replace(/\s+/g, ' ').trim()

/** "[Title §1.3.4 p.3]", "[Title §Article 8 pp.4–5]", or "[Title ¶7]" when the passage has no anchor or page. */
export function citationFor(c: Pick<Citable, 'title' | 'section' | 'page' | 'pageEnd' | 'ordinal'>): string {
  const parts = [clean(c.title).slice(0, 120)]
  if (c.section) parts.push(`§${clean(c.section)}`)
  if (c.page != null) parts.push(c.pageEnd != null && c.pageEnd !== c.page ? `pp.${c.page}–${c.pageEnd}` : `p.${c.page}`)
  if (!c.section && c.page == null) parts.push(`¶${c.ordinal + 1}`)
  return `[${parts.join(' ')}]`
}

const norm = (s: string) => s.toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').replace(/\s*§\s*/g, ' §').trim()

interface ParsedCitation { title: string; section: string | null; page: number | null; para: number | null }

/** Splits "Title §1.3.4 p.3" into its parts (null when the text isn't citation-shaped). */
export function parseCitation(inner: string): ParsedCitation | null {
  const s = inner.replace(/\s+/g, ' ').trim()
  if (!/§|\bpp?\.\s*\d|¶\s*\d/.test(s)) return null
  const pageM = /\bpp?\.\s*(\d{1,5})(?:\s*[-–]\s*\d{1,5})?\s*$/.exec(s)
  let rest = pageM ? s.slice(0, pageM.index).trim() : s
  const paraM = /¶\s*(\d{1,5})\s*$/.exec(rest)
  if (paraM) rest = rest.slice(0, paraM.index).trim()
  const secIdx = rest.indexOf('§')
  const title = (secIdx >= 0 ? rest.slice(0, secIdx) : rest).replace(/[,;]\s*$/, '').trim()
  const section = secIdx >= 0 ? rest.slice(secIdx + 1).replace(/[,;]\s*$/, '').trim() || null : null
  if (!title) return null
  return { title, section, page: pageM ? Number(pageM[1]) : null, para: paraM ? Number(paraM[1]) : null }
}

/** The retrieved passage a citation refers to, or null when it refers to nothing that was retrieved. */
export function matchCitation(inner: string, retrieved: Citable[]): Citable | null {
  const exact = retrieved.find(r => norm(citationFor(r)) === norm(`[${inner}]`))
  if (exact) return exact
  const p = parseCitation(inner)
  if (!p) return null
  const title = norm(p.title)
  return retrieved.find(r => {
    if (norm(clean(r.title)) !== title) return false
    if (p.section && norm(clean(r.section || '')) !== norm(p.section)) return false
    if (p.page != null && (r.page == null || p.page < r.page || p.page > (r.pageEnd ?? r.page))) return false
    if (p.para != null && p.para !== r.ordinal + 1) return false
    // A bare title with nothing else is not specific enough to verify.
    return !!(p.section || p.page != null || p.para != null)
  }) ?? null
}

export interface CitationCheck {
  text: string
  /** Citations that matched a retrieved passage */
  valid: { citation: string; chunkId: string; documentId: string }[]
  /** Citations removed because they matched nothing retrieved */
  invalid: string[]
}

/**
 * Checks every bracketed citation in `answer` against the retrieved passages. Valid ones are kept
 * (rewritten to the canonical form); invalid ones are removed and listed, and a note is appended.
 */
export function validateCitations(answer: string, retrieved: Citable[]): CitationCheck {
  const valid: CitationCheck['valid'] = []
  const invalid: string[] = []
  const text = answer.replace(/\[([^[\]\n]{1,300})\]/g, (whole, inner: string) => {
    if (!parseCitation(inner)) return whole // not a citation (e.g. a markdown link label or a note)
    const hit = matchCitation(inner, retrieved)
    if (!hit) { invalid.push(whole); return '' }
    const canonical = citationFor(hit)
    if (!valid.some(v => v.chunkId === hit.chunkId)) valid.push({ citation: canonical, chunkId: hit.chunkId, documentId: hit.documentId })
    return canonical
  }).replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ')
  const note = invalid.length
    ? `\n\n_${invalid.length} citation${invalid.length === 1 ? ' was' : 's were'} removed because ${invalid.length === 1 ? 'it does' : 'they do'} not match any passage retrieved from the project documents. Treat the related statement${invalid.length === 1 ? '' : 's'} as unverified._`
    : ''
  return { text: text.trimEnd() + note, valid, invalid }
}
