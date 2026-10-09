// Deterministic (rules-based) extraction of candidate scheduling requirements from contract and
// specification passages: maximum activity duration, update frequency, float ownership, notice to
// proceed, completion periods, liquidated damages and similar. Each candidate carries the sentence
// it came from and a citation. Candidates are suggestions for a person to confirm or dismiss; they
// are never applied to a schedule or its quality rules automatically.

import { createHash } from 'crypto'
import { citationFor } from './citations'

export type RequirementKind =
  | 'max_activity_duration' | 'update_frequency' | 'float_ownership' | 'notice_to_proceed'
  | 'substantial_completion' | 'final_completion' | 'liquidated_damages' | 'baseline_submittal'
  | 'schedule_software' | 'constraints_restricted' | 'negative_lag' | 'cost_loading' | 'weather_days' | 'max_float_or_lag'

export const REQUIREMENT_LABELS: Record<RequirementKind, string> = {
  max_activity_duration: 'Maximum activity duration',
  update_frequency: 'Schedule update frequency',
  float_ownership: 'Float ownership',
  notice_to_proceed: 'Notice to proceed',
  substantial_completion: 'Substantial completion',
  final_completion: 'Final completion',
  liquidated_damages: 'Liquidated damages',
  baseline_submittal: 'Baseline schedule submittal',
  schedule_software: 'Scheduling software / format',
  constraints_restricted: 'Constraints restricted',
  negative_lag: 'Negative lags (leads)',
  cost_loading: 'Cost / resource loading',
  weather_days: 'Weather days',
  max_float_or_lag: 'Lag limits',
}

export interface CandidateRequirement {
  key: string
  kind: RequirementKind
  label: string
  /** One-line reading of the requirement, e.g. "20 working days" */
  value: string
  /** The sentence it was found in (document text; shown to the user, never logged) */
  quote: string
  chunkId: string
  documentId: string
  documentTitle: string
  citation: string
  /** Found in a passage flagged for instruction-like content */
  fromFlaggedPassage: boolean
}

export interface ExtractInput {
  chunkId: string; documentId: string; title: string; section: string | null; page: number | null; pageEnd: number | null
  ordinal: number; text: string; flagged: boolean
}

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, ninety: 90 }
const NUM = String.raw`(\d{1,4}(?:,\d{3})*|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty(?:-five)?|sixty|ninety)(?:\s*\(\d{1,4}\))?`
const num = (s: string) => NUM_WORDS[s.toLowerCase()] ?? Number(s.replace(/,/g, ''))
const DAYS = String.raw`(working|work|business|calendar|consecutive)?\s*days?`

const dayKind = (w?: string) => !w ? 'days' : /work|business/i.test(w) ? 'working days' : /calendar|consecutive/i.test(w) ? 'calendar days' : 'days'

type Rule = { kind: RequirementKind; test: (s: string) => string | null }

const RULES: Rule[] = [
  { kind: 'max_activity_duration', test: s => {
    if (!/\bdurations?\b/i.test(s) || !/\b(?:activit|task)/i.test(s)) return null
    const m = new RegExp(String.raw`(?:maximum|max\.?|not\s+(?:to\s+)?exceed|no\s+(?:more|longer)\s+than|shall\s+not\s+exceed|exceeding|greater\s+than|in\s+excess\s+of|limited\s+to)[^.;]{0,60}?\b${NUM}\s*${DAYS}`, 'i').exec(s)
    return m ? `${num(m[1])} ${dayKind(m[2])}` : null
  } },
  { kind: 'update_frequency', test: s => {
    if (!/\bupdat|\bprogress\s+(?:schedule|report)|\bstatus(?:ed)?\b/i.test(s) || !/\bschedul/i.test(s)) return null
    const m = /\b(monthly|weekly|bi-?weekly|semi-?monthly|every\s+(?:two|four|\d+)\s+weeks|(?:once\s+)?(?:each|every|per)\s+(?:calendar\s+)?month|with\s+each\s+(?:monthly\s+)?(?:pay(?:ment)?\s+(?:application|request)|application\s+for\s+payment))\b/i.exec(s)
    return m ? m[1].replace(/\s+/g, ' ').toLowerCase() : null
  } },
  { kind: 'float_ownership', test: s => {
    if (!/\bfloat\b/i.test(s)) return null
    if (/\b(?:shall\s+not|may\s+not|will\s+not|not)\s+(?:be\s+)?(?:sequester|suppress|consum|hid|manipulat)/i.test(s) || /\bsequester/i.test(s)) return 'float shall not be sequestered'
    if (/\bfloat\b[^.]{0,60}\b(?:is\s+)?(?:a\s+)?(?:shared|jointly\s+owned|project\s+resource|not\s+for\s+the\s+exclusive\s+use)/i.test(s) || /\b(?:shared|project)\s+float\b/i.test(s)) return 'float is a shared project resource'
    if (/\bfloat\b[^.]{0,40}\b(?:belongs|shall\s+belong)\s+to\s+the\s+(owner|contractor|project)/i.test(s)) return `float belongs to the ${/\bfloat\b[^.]{0,40}\b(?:belongs|shall\s+belong)\s+to\s+the\s+(owner|contractor|project)/i.exec(s)![1].toLowerCase()}`
    return null
  } },
  { kind: 'notice_to_proceed', test: s => {
    if (!/\bnotice\s+to\s+proceed\b|\bNTP\b/.test(s) && !/\bnotice to proceed\b/i.test(s)) return null
    const m = new RegExp(String.raw`within\s+${NUM}\s*${DAYS}\s+(?:after|of|from|following)\s+(?:the\s+)?(?:date\s+of\s+(?:the\s+)?)?(?:(?:issuance|receipt)\s+of\s+(?:the\s+)?)?(?:notice\s+to\s+proceed|NTP)`, 'i').exec(s)
    if (m && !/substantial|final\s+complet/i.test(s)) return `start within ${num(m[1])} ${dayKind(m[2])} of NTP`
    return /\b(?:commence|start|begin)/i.test(s) ? 'work starts at notice to proceed' : null
  } },
  { kind: 'substantial_completion', test: s => {
    if (!/\bsubstantial(?:ly)?\s+complet/i.test(s)) return null
    const m = new RegExp(String.raw`(?:within|not\s+later\s+than|no\s+later\s+than)\s+${NUM}\s*${DAYS}`, 'i').exec(s)
    if (m) return `${num(m[1])} ${dayKind(m[2])}${/notice\s+to\s+proceed|\bNTP\b/i.test(s) ? ' from NTP' : ''}`
    const d = /\b(?:on\s+or\s+before|by|no\s+later\s+than)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(s)
    return d ? `by ${d[1]}` : null
  } },
  { kind: 'final_completion', test: s => {
    if (!/\bfinal\s+complet/i.test(s)) return null
    const m = new RegExp(String.raw`(?:within|not\s+later\s+than|no\s+later\s+than)\s+${NUM}\s*${DAYS}`, 'i').exec(s)
    return m ? `${num(m[1])} ${dayKind(m[2])}${/substantial/i.test(s) ? ' after substantial completion' : ''}` : null
  } },
  { kind: 'liquidated_damages', test: s => {
    if (!/\bliquidated\s+damages\b/i.test(s)) return null
    const m = /(\$\s?\d[\d,]*(?:\.\d{2})?)\s*(?:\([^)]*\)\s*)?(?:per|for\s+each|each|a)\s+(calendar\s+|working\s+)?day/i.exec(s)
    return m ? `${m[1].replace(/\s/g, '')} per ${m[2] ? m[2].trim().toLowerCase() + ' ' : ''}day` : 'liquidated damages apply'
  } },
  { kind: 'baseline_submittal', test: s => {
    if (!/\b(?:baseline|initial|preliminary)\s+(?:cpm\s+|progress\s+|construction\s+)?schedule\b/i.test(s)) return null
    const m = new RegExp(String.raw`within\s+${NUM}\s*${DAYS}`, 'i').exec(s)
    return m ? `submit within ${num(m[1])} ${dayKind(m[2])}${/notice\s+to\s+proceed|\bNTP\b/i.test(s) ? ' of NTP' : ''}` : null
  } },
  { kind: 'schedule_software', test: s => {
    const m = /\b(Primavera\s+P6(?:\s+EPPM)?|Oracle\s+Primavera|P6|Microsoft\s+Project|MS\s+Project)\b/.exec(s)
    if (!m || !/\b(?:shall|must|required|use|prepare|submit)/i.test(s)) return null
    const xer = /\.xer\b|\bXER\b/i.test(s) ? ' (native .xer)' : ''
    return `${m[1].replace(/\s+/g, ' ')}${xer}`
  } },
  { kind: 'constraints_restricted', test: s => {
    if (!/\bconstraints?\b/i.test(s) || !/\b(?:date|schedule|activit|imposed|mandatory|finish|start)/i.test(s)) return null
    return /\b(?:shall\s+not|not\s+(?:be\s+)?(?:used|permitted|allowed)|prohibited|without\s+(?:the\s+)?(?:prior\s+)?(?:written\s+)?(?:approval|consent)|only\s+(?:with|where|when))/i.test(s) ? 'date constraints restricted' : null
  } },
  { kind: 'negative_lag', test: s => /\b(?:negative\s+lags?|leads)\b[^.]{0,60}\b(?:shall\s+not|not\s+(?:be\s+)?(?:used|permitted|allowed)|prohibited)/i.test(s) || /\b(?:shall\s+not|not\s+permitted|prohibited)[^.]{0,40}\bnegative\s+lags?/i.test(s) ? 'negative lags not permitted' : null },
  { kind: 'max_float_or_lag', test: s => {
    if (!/\blags?\b/i.test(s)) return null
    const m = new RegExp(String.raw`lags?[^.;]{0,50}(?:shall\s+not\s+exceed|not\s+(?:to\s+)?exceed|no\s+(?:more|greater)\s+than|maximum\s+of)\s+${NUM}\s*${DAYS}`, 'i').exec(s)
    return m ? `lags ≤ ${num(m[1])} ${dayKind(m[2])}` : null
  } },
  { kind: 'cost_loading', test: s => {
    const m = /\b(cost|resource|labor|manpower)[- ]loaded\b|\bload(?:ed)?\s+with\s+(?:cost|resources)/i.exec(s)
    return m && /\bschedul|activit/i.test(s) ? `${(m[1] || 'cost').toLowerCase()}-loaded schedule` : null
  } },
  { kind: 'weather_days', test: s => {
    const m = new RegExp(String.raw`${NUM}\s*(?:\w+\s+)?(?:adverse\s+)?(?:weather|rain)\s+days?`, 'i').exec(s)
    return m ? `${num(m[1])} weather days` : (/\b(?:adverse|anticipated|normal)\s+weather\b/i.test(s) && /\bschedul|days?\b/i.test(s) ? 'anticipated weather days to be included' : null)
  } },
]

/** Sentences of a passage (keeps clause numbering with its sentence). */
export function sentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').split(/(?<=[.;!?])\s+(?=[A-Z0-9(“"])/).map(s => s.trim()).filter(s => s.length >= 12)
}

export const requirementKey = (kind: string, documentId: string, quote: string) =>
  createHash('sha256').update(`${kind}\u0000${documentId}\u0000${quote.toLowerCase().replace(/\s+/g, ' ')}`).digest('hex').slice(0, 24)

/** Candidate requirements found in the passages (one per kind per sentence; duplicates merged). */
export function extractRequirements(chunks: ExtractInput[]): CandidateRequirement[] {
  const out: CandidateRequirement[] = []
  const seen = new Set<string>()
  for (const c of chunks) {
    for (const s of sentences(c.text)) {
      for (const r of RULES) {
        const value = r.test(s)
        if (!value) continue
        const key = requirementKey(r.kind, c.documentId, s)
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          key, kind: r.kind, label: REQUIREMENT_LABELS[r.kind], value, quote: s.length > 400 ? s.slice(0, 397) + '…' : s,
          chunkId: c.chunkId, documentId: c.documentId, documentTitle: c.title, citation: citationFor(c), fromFlaggedPassage: c.flagged,
        })
      }
    }
  }
  return out
}
