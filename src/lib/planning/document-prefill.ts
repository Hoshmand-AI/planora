// Interview answers proposed from a project document (RFP, scope of work, contract, specification,
// drawing set). Rules find what documents state in recognizable ways — gross area, stories, location,
// delivery method, notice to proceed, required completion, design stage, federal client, project type —
// and, when a model is allowed, the model may propose the remaining answers. Every proposal carries the
// sentence it came from and its page; a model proposal is kept only if its quote is in the document
// and its value is one the question accepts. Proposals are never applied: the scheduler picks which to
// use, and each saved answer records that it came from the document.

import { PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectType } from './types'
import { US_STATES } from '@/lib/knowledge/us-states'
import { sentences } from '@/lib/rag/requirements'
import type { PageText } from '@/lib/rag/chunk'

import { PREFILL_QUESTIONS, type PrefillQuestion, type Proposal } from './prefill-labels'
export { PREFILL_QUESTIONS, type PrefillQuestion, type Proposal } from './prefill-labels'

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DATE = String.raw`((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})`

/** "March 2, 2027" | "3/2/2027" | "2027-03-02" → "2027-03-02" (null if not a real date). */
export function isoFromText(s: string): string | null {
  let y: number, m: number, d: number
  const a = /^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s.trim())
  const b = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim())
  const c = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (a) { m = MONTHS.indexOf(a[1].toLowerCase()) + 1; d = +a[2]; y = +a[3] } else if (b) { m = +b[1]; d = +b[2]; y = +b[3] } else if (c) { y = +c[1]; m = +c[2]; d = +c[3] } else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (m < 1 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return null
  return dt.toISOString().slice(0, 10)
}

const fmtUs = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`

/** Project-type keywords, most specific first. */
const TYPE_RULES: [ProjectType, RegExp][] = [
  ['data_center', /\bdata\s*cent(?:er|re)s?\b|\bcolocation\b|\bserver\s+hall\b/i],
  ['healthcare', /\bhospital\b|\bmedical\s+(?:center|office\s+building|facility)\b|\bclinic\b|\bsurgery\s+center\b|\bhealthcare\s+facility\b/i],
  ['k12_school', /\b(?:elementary|middle|high|k-?12)\s+school\b|\bschool\s+district\b/i],
  ['lab_research', /\b(?:research\s+)?laborator(?:y|ies)\b|\bvivarium\b/i],
  ['interiors_ti', /\btenant\s+improvements?\b|\binterior\s+(?:fit-?out|build-?out)\b|\bTI\s+project\b/i],
  ['multifamily', /\bmulti-?family\b|\bapartments?\b|\bresidential\s+units\b|\bdwelling\s+units\b/i],
  ['warehouse_industrial', /\bwarehouse\b|\bdistribution\s+(?:center|facility)\b|\blogistics\s+(?:center|facility)\b/i],
  ['retail', /\bretail\b|\bshopping\s+center\b|\bstorefront\b/i],
  ['highway_bridge', /\bbridge\b|\bhighway\b|\binterchange\b|\broadway\s+widening\b/i],
  ['transit_rail', /\b(?:light\s+)?rail\b|\btransit\s+station\b|\bsubway\b/i],
  ['water_wastewater', /\bwastewater\b|\bwater\s+treatment\b|\bpump\s+station\b|\bwater\s+main\b/i],
  ['utility_power', /\bsubstation\b|\btransmission\s+line\b|\bsolar\s+(?:farm|project)\b|\bpower\s+plant\b/i],
  ['aviation', /\bairport\b|\bterminal\s+building\b|\brunway\b|\btaxiway\b|\bhangar\b/i],
  ['commercial_office', /\boffice\s+building\b|\bcorporate\s+(?:office|headquarters)\b|\bclass\s+a\s+office\b/i],
]
const FEDERAL = /\b(?:GSA|General\s+Services\s+Administration|USACE|U\.?\s?S\.?\s+Army\s+Corps\s+of\s+Engineers|NAVFAC|Department\s+of\s+(?:Defense|Veterans\s+Affairs|Energy|State)|VA\s+Medical\s+Center|federal\s+(?:government|agency|project|contract)|FAR\s+52\.\d)/i

function stateFrom(s: string): { code: string; name: string } | null {
  const zip = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(s)
  if (zip) { const st = US_STATES.find(x => x.code === zip[1]); if (st) return st }
  const named = /\b(?:State\s+of|located\s+in|in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/.exec(s)
  if (named) { const st = US_STATES.find(x => x.name.toLowerCase() === named[1].toLowerCase()); if (st) return st }
  return null
}

/** Rule-based proposals: the first sentence that clearly states each answer. */
export function rulesPrefill(pages: PageText[]): Proposal[] {
  const found = new Map<PrefillQuestion, Proposal>()
  const put = (q: PrefillQuestion, value: Proposal['value'], display: string, quote: string, page: number | null) => {
    if (!found.has(q)) found.set(q, { questionId: q, value, display, quote: quote.length > 400 ? quote.slice(0, 397) + '…' : quote, page, method: 'rules' })
  }
  const typeHits = new Map<ProjectType, { n: number; quote: string; page: number | null }>()
  for (const p of pages) {
    // Federal clients are matched on the page text: abbreviations like "U.S." split sentences.
    const fed = FEDERAL.exec(p.text.replace(/\s+/g, ' '))
    if (fed) {
      const t = p.text.replace(/\s+/g, ' ')
      const from = Math.max(0, t.lastIndexOf('.', Math.max(0, fed.index - 2)) + 1)
      const end = t.indexOf('. ', fed.index + fed[0].length)
      put('project.federal', true, 'Yes', t.slice(from, end < 0 ? undefined : end + 1).trim(), p.page)
    }
    for (const s of sentences(p.text)) {
      const sf = /(\d{1,3}(?:,\d{3})+|\d{4,7})\s*(?:gross\s+)?(?:square\s+feet|square\s+foot|sq\.?\s?ft\.?|gsf|g\.s\.f\.|sf)\b/i.exec(s)
      if (sf && /\b(?:building|gross|facility|area|approximately|total)\b/i.test(s)) { const n = Number(sf[1].replace(/,/g, '')); if (n >= 500 && n <= 20_000_000) put('project.gross_sqft', n, `${n.toLocaleString('en-US')} sf`, s, p.page) }
      const st = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)[- ](?:stor(?:y|ies|ey))\b/i.exec(s)
      if (st) { const n = WORD_NUM[st[1].toLowerCase()] ?? Number(st[1]); if (n >= 1 && n <= 150) put('project.stories', n, `${n}`, s, p.page) }
      const state = stateFrom(s)
      if (state && /\b(?:located|site|project|address|city|county|street|avenue|road)\b/i.test(s)) put('project.state', state.code, state.name, s, p.page)
      const city = /\b(?:City|County|Town)\s+of\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})/.exec(s)
      if (city) { const c = city[0].replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim(); put('project.city', c, c, s, p.page) }
      if (/\boccupied\b/i.test(s) && /\brenovat|\bremodel/i.test(s)) put('project.scope', 'renovation_occupied', 'Renovation (occupied / phased)', s, p.page)
      else if (/\b(?:renovation|remodel(?:ing)?|rehabilitation)\s+of\b/i.test(s)) put('project.scope', 'renovation', 'Renovation', s, p.page)
      else if (/\baddition\s+to\s+the\s+existing\b/i.test(s)) put('project.scope', 'addition', 'Addition', s, p.page)
      else if (/\bnew\s+(?:construction|building|facility)\b/i.test(s) && /\bconstruct|\bproject\b|\bwork\b/i.test(s)) put('project.scope', 'new_construction', 'New construction', s, p.page)
      if (/\bdesign[- ]build\b/i.test(s) && !/\bdesign[- ]bid[- ]build\b/i.test(s)) put('project.delivery', 'db', 'Design-build', s, p.page)
      else if (/\bconstruction\s+manager\s+at[- ]risk\b|\bCM\s*@?\s*at[- ]risk\b|\bCMAR\b/i.test(s)) put('project.delivery', 'cmar', 'CM at risk', s, p.page)
      else if (/\bdesign[- ]bid[- ]build\b/i.test(s)) put('project.delivery', 'dbb', 'Design-bid-build', s, p.page)
      else if (/\bintegrated\s+project\s+delivery\b|\bIPD\b/.test(s)) put('project.delivery', 'ipd', 'IPD', s, p.page)
      const ntp = new RegExp(String.raw`notice\s+to\s+proceed[^.]{0,80}?\b(?:on|dated|issued|is|of|by|effective)\s+${DATE}`, 'i').exec(s)
      if (ntp) { const iso = isoFromText(ntp[1]); if (iso) put('project.target_start', iso, fmtUs(iso), s, p.page) }
      const sc = new RegExp(String.raw`substantial(?:ly)?\s+complet\w*[^.]{0,80}?\b(?:on\s+or\s+before|by|no\s+later\s+than|not\s+later\s+than)\s+${DATE}`, 'i').exec(s)
      if (sc) { const iso = isoFromText(sc[1]); if (iso) put('project.required_finish', iso, fmtUs(iso), s, p.page) }
      const val = /\b(?:contract\s+(?:sum|price|amount)|construction\s+(?:cost|budget|value)|estimated\s+(?:construction\s+)?cost|project\s+(?:budget|value))\b[^.$]{0,40}\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(million|M\b)?/i.exec(s)
      if (val) { const raw = Number(val[1].replace(/,/g, '')); const musd = val[2] ? raw : raw / 1_000_000; if (musd >= 0.05 && musd <= 100_000) put('project.value_musd', Math.round(musd * 100) / 100, `$${(Math.round(musd * 100) / 100).toLocaleString('en-US')}M`, s, p.page) }
      const pct = /\b(\d{2,3})\s*%\s*(?:complete\s+)?(?:construction\s+documents?|CDs?|design\s+development|DD|schematic\s+design|SD|design)\b/i.exec(s)
      if (pct) { const n = Number(pct[1]); if (n >= 10 && n <= 100) { put('design.percent', n, `${n}%`, s, p.page); put('design.drawings', true, 'Yes', s, p.page) } }
      else if (/\b(?:issued\s+for\s+construction|IFC\s+(?:set|drawings))\b/i.test(s)) { put('design.percent', 100, '100%', s, p.page); put('design.drawings', true, 'Yes', s, p.page) }
      else if (/\b(?:drawings?\s+(?:list|index)|sheet\s+index|list\s+of\s+drawings)\b/i.test(s)) put('design.drawings', true, 'Yes', s, p.page)
      for (const [t, re] of TYPE_RULES) if (re.test(s)) { const h = typeHits.get(t) ?? { n: 0, quote: s, page: p.page }; h.n++; typeHits.set(t, h) }
    }
  }
  const [best] = [...typeHits.entries()].sort((a, b) => b[1].n - a[1].n)
  if (best) put('project.type', best[0], PROJECT_TYPE_LABELS[best[0]], best[1].quote, best[1].page)
  return [...found.values()]
}

/* ─── Model proposals for what the rules did not find ── */

export const PREFILL_TASK = (missing: PrefillQuestion[]) => `TASK: From the project document passages, propose answers to these interview questions ONLY where a passage states the answer: ${missing.map(q => `${q} (${PREFILL_QUESTIONS[q]})`).join('; ')}.
Allowed values: project.type one of ${PROJECT_TYPES.join(', ')}; project.state a 2-letter US state code; project.scope one of new_construction, addition, renovation, renovation_occupied; project.delivery one of dbb, db, cmar, ipd; project.federal and design.drawings true/false; numbers as plain numbers (area in square feet, value in USD millions, design percent 0-100); dates YYYY-MM-DD; project.city text.
For each answer give "quote": the sentence copied EXACTLY from one passage, and "page" (the passage's page number or null). Skip any question the passages do not answer; do not guess.
Reply with ONLY JSON: {"answers": [{"questionId": "...", "value": ..., "quote": "...", "page": 3}]}`

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim()

/** A model value checked against what the question accepts; null when it isn't acceptable. */
export function checkValue(q: PrefillQuestion, v: unknown): { value: Proposal['value']; display: string } | null {
  switch (q) {
    case 'project.type': return typeof v === 'string' && (PROJECT_TYPES as readonly string[]).includes(v) ? { value: v, display: PROJECT_TYPE_LABELS[v as ProjectType] } : null
    case 'project.state': { const st = typeof v === 'string' ? US_STATES.find(x => x.code === v.toUpperCase()) : undefined; return st ? { value: st.code, display: st.name } : null }
    case 'project.scope': return ['new_construction', 'addition', 'renovation', 'renovation_occupied'].includes(String(v)) ? { value: String(v), display: String(v).replace(/_/g, ' ') } : null
    case 'project.delivery': return ['dbb', 'db', 'cmar', 'ipd'].includes(String(v)) ? { value: String(v), display: { dbb: 'Design-bid-build', db: 'Design-build', cmar: 'CM at risk', ipd: 'IPD' }[String(v)]! } : null
    case 'project.federal': case 'design.drawings': return typeof v === 'boolean' ? { value: v, display: v ? 'Yes' : 'No' } : null
    case 'project.target_start': case 'project.required_finish': { const iso = typeof v === 'string' ? isoFromText(v) : null; return iso ? { value: iso, display: fmtUs(iso) } : null }
    case 'project.city': return typeof v === 'string' && v.trim().length >= 2 && v.length <= 80 ? { value: v.trim(), display: v.trim() } : null
    case 'project.gross_sqft': return typeof v === 'number' && v >= 500 && v <= 20_000_000 ? { value: Math.round(v), display: `${Math.round(v).toLocaleString('en-US')} sf` } : null
    case 'project.stories': return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 150 ? { value: v, display: String(v) } : null
    case 'project.value_musd': return typeof v === 'number' && v > 0 && v <= 100_000 ? { value: v, display: `$${v}M` } : null
    case 'design.percent': return typeof v === 'number' && v >= 0 && v <= 100 ? { value: Math.round(v), display: `${Math.round(v)}%` } : null
  }
}

/** Validates the model's reply and keeps only answers whose quote is in the document and value is acceptable. */
export function finalizeModelPrefill(v: unknown, pages: PageText[], allowed: PrefillQuestion[]): { proposals: Proposal[]; dropped: number } {
  const list = v && typeof v === 'object' && Array.isArray((v as { answers?: unknown }).answers) ? (v as { answers: unknown[] }).answers : null
  if (!list) throw new Error('Return {"answers": [...]}')
  const text = pages.map(p => ({ page: p.page, t: norm(p.text) }))
  const proposals: Proposal[] = []
  let dropped = 0
  for (const x of list) {
    const a = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const q = String(a.questionId ?? '') as PrefillQuestion
    const quote = String(a.quote ?? '').trim()
    const ok = allowed.includes(q) ? checkValue(q, a.value) : null
    const hit = quote.length >= 12 ? text.find(p => p.t.includes(norm(quote))) : undefined
    if (!ok || !hit || proposals.some(p => p.questionId === q)) { dropped++; continue }
    proposals.push({ questionId: q, ...ok, quote: quote.slice(0, 400), page: hit.page, method: 'model' })
  }
  return { proposals, dropped }
}
