// The project's documents read against its schedule, by rules (no AI model):
//  - contract watch: notice periods, liquidated damages and update duties, quoted from the contract and
//    the scheduling specification, and what they mean today;
//  - documents against the schedule: systems the drawings and specifications name that no activity covers;
//  - the field against the schedule: work the daily reports describe that the schedule shows differently.
// Every finding carries the sentence it rests on and where that sentence is. Pure.

import { BUILDING_SCOPE, DATA_CENTER_SCOPE } from './daily-brief'
import { CIVIL_PROJECT_TYPES } from '@/lib/planning/types'

export interface WatchChunk { documentId: string; title: string; docType: string; citation: string; text: string }
export interface WatchActivity { id: string; code: string; name: string; wbs?: string | null; started: boolean; done: boolean }
interface Source { quote: string; title: string; citation: string; documentId: string }

export interface ContractItem extends Source {
  kind: 'notice' | 'damages' | 'update' | 'float'
  /** What the clause means for the project today, in one sentence */
  text: string
  /** True when something on the project today triggers the clause */
  active: boolean
  days?: number | null
  /** Liquidated damages per calendar day, and the exposure at the current forecast */
  perDay?: number | null
  exposure?: number | null
}
export interface ScopeGap extends Source { label: string }
export interface FieldMismatch extends Source { activity: { id: string; code: string; name: string }; reported: 'working' | 'finished'; schedule: 'not started' | 'in progress'; text: string }
export interface ProjectWatch { contract: ContractItem[]; notInSchedule: ScopeGap[]; field: FieldMismatch[]; read: { contract: number; design: number; field: number } }

export const CONTRACT_DOC_TYPES: readonly string[] = ['contract', 'scheduling_spec', 'owner_requirement', 'change_order']
export const DESIGN_DOC_TYPES: readonly string[] = ['drawing', 'specification', 'owner_requirement', 'contract']
export const FIELD_DOC_TYPES: readonly string[] = ['daily_report']
const MAX = 8

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, fourteen: 14, fifteen: 15, twenty: 20, 'twenty-one': 21, thirty: 30, sixty: 60 }
const WITHIN = /\b(?:within|no later than|not later than)\s+(?:\(?(\d{1,3})\)?|([a-z-]+)(?:\s*\((\d{1,3})\))?)\s+(?:calendar\s+|working\s+|business\s+|work\s+)?days?\b/i
const NOTICE = /\b(notice|notif(?:y|ication)|claim)\b/i
const DELAY_WORD = /\b(delay|time extension|extension of time|impact|change|differing)\b/i
const LD = /liquidated damages|\bLDs\b/i
const MONEY = /\$\s?([\d,]+(?:\.\d+)?)\s*(k|thousand|million|m)?\b/i
const PER_DAY = /\b(?:per|each|for each|for every|a)\s+(?:calendar\s+|working\s+|business\s+)?day\b/i
/** The amount written right before "per day": a contract sentence often names the contract value first. */
const AMOUNT_PER_DAY = /\$\s?([\d,]+(?:\.\d+)?)\s*(k|thousand|million|m)?\s*\)?\s*(?:\([^)]{0,60}\)\s*)?(?:per|each|for each|for every|a)\s+(?:calendar\s+|working\s+|business\s+)?day\b/i
/** A ceiling on the damages ("not to exceed $500,000"): never the daily amount. */
const CAP = /\b(?:not to exceed|up to|maximum(?: of)?|capped at|cap of|limit(?:ed to| of)|aggregate(?: of)?|in no event (?:more|greater) than)\s+(?:an?\s+)?(?:total\s+(?:of\s+)?|aggregate\s+(?:of\s+)?)?\$\s?[\d,]+(?:\.\d+)?\s*(?:k|thousand|million|m)?\b/gi
const UPDATE = /\b(?:update|updated|updates|submit|submittal of)\b.{0,60}\bschedule\b|\bschedule\b.{0,60}\b(?:update|updated|updates)\b/i
const PERIOD = /\b(monthly|each month|every month|weekly|each week|every week|bi-?weekly|every two weeks)\b/i
const FLOAT = /\bfloat\b.{0,80}\b(belongs?|owned|ownership|exclusive|shared|jointly|project)\b/i
const WORKING = /\b(continued|continu(?:es|ing)|started|began|commenced|underway|under way|in progress|installing|pouring|pulling|setting|erecting|placing|crew (?:is|was) on)\b/i
const FINISHED = /\b(completed?|finished|wrapped up|signed off|100\s?%)\b/i
/** Part done: a percentage under 100, or "nearly", "partially". */
const PARTIAL = /\b\d{1,2}(?:\.\d+)?\s?%|\b(?:partial(?:ly)?|nearly|almost|mostly|about half|halfway)\b/i
const NOT_DONE = /\b(not (?:yet )?(?:complete|completed|finished|started)|will (?:complete|finish|start)|to (?:be )?complet|remaining|behind)\b/i
/** Sentences that say work did not happen: never evidence that it did. */
const NO_WORK = /\bno (?:work|progress|activity|crew)\b|\b(?:did|could|was|were) not\b|\bnot (?:yet )?(?:started|begun|commenced)\b|\bunable to\b|\bcancell?ed\b|\brained out\b|\bwill (?:start|begin|commence)\b|\bscheduled to (?:start|begin)\b/i
const STOP = new Set(['the', 'and', 'for', 'with', 'level', 'area', 'install', 'installation', 'work', 'phase', 'building', 'complete', 'start', 'finish', 'new', 'all', 'set', 'data', 'hall', 'system', 'systems', 'units'])

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const stem = (w: string) => w.replace(/(ing|es|s)$/, '')
const words = (s: string) => norm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w)).map(stem)
// Lines first (reports are often one fact per line), then sentences.
const sentences = (text: string) => text.split(/[\r\n•]+/).flatMap(line => line.replace(/\s+/g, ' ').split(/(?<=[.!?;])\s+(?=[A-Z0-9"“(])/)).map(s => s.trim()).filter(s => s.length >= 20 && s.length <= 500)
const src = (c: WatchChunk, quote: string): Source => ({ quote: quote.slice(0, 320), title: c.title, citation: c.citation, documentId: c.documentId })
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function daysWithin(s: string): number | null {
  const m = WITHIN.exec(s)
  if (!m) return null
  const n = m[1] ? Number(m[1]) : m[3] ? Number(m[3]) : NUM[m[2]?.toLowerCase() ?? '']
  return n && n <= 365 ? n : null
}
function amount(s: string, re: RegExp = MONEY): number | null {
  const m = re.exec(s)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = (m[2] ?? '').toLowerCase()
  return unit === 'k' || unit === 'thousand' ? n * 1_000 : unit === 'm' || unit === 'million' ? n * 1_000_000 : n
}

export interface WatchContext {
  /** Calendar days the forecast is behind the required date (0 or less when on time) */
  daysBehind: number | null
  /** Delay or change sentences found in the correspondence, newest documents first */
  delaysReported: { title: string; activity: string | null }[]
  /** Open change items in the register without a decision */
  openChangeItems: number
  /** Days since the schedule's data date */
  staleDays: number | null
  projectType?: string | null
}

export function projectWatch(chunks: WatchChunk[], activities: WatchActivity[], ctx: WatchContext): ProjectWatch {
  const contractChunks = chunks.filter(c => CONTRACT_DOC_TYPES.includes(c.docType))
  const designChunks = chunks.filter(c => DESIGN_DOC_TYPES.includes(c.docType))
  const fieldChunks = chunks.filter(c => FIELD_DOC_TYPES.includes(c.docType))

  /* Contract watch */
  const contract: ContractItem[] = []
  const have = new Set<string>()
  const push = (key: string, item: ContractItem) => { if (!have.has(key)) { have.add(key); contract.push(item) } }
  for (const c of contractChunks) for (const s of sentences(c.text)) {
    const n = daysWithin(s)
    if (n != null && NOTICE.test(s) && DELAY_WORD.test(s)) {
      const hit = ctx.delaysReported[0]
      const active = ctx.delaysReported.length > 0 || ctx.openChangeItems > 0
      push(`notice:${n}`, { ...src(c, s), kind: 'notice', days: n, active,
        text: hit ? `Written notice is due within ${n} days of a delay or change. A delay is reported in ${hit.title}${hit.activity ? ` (about ${hit.activity})` : ''}: confirm the notice has gone out, then add it to the register to clear this reminder.`
          : ctx.openChangeItems > 0 ? `Written notice is due within ${n} days of a delay or change. ${ctx.openChangeItems} change item${ctx.openChangeItems === 1 ? ' is' : 's are'} open in the register: confirm notice was given for each.`
          : `Written notice is due within ${n} days of a delay or change. Nothing new on the project triggers it today.` })
    }
    if (LD.test(s)) {
      // The exposure multiplies the daily amount by the days behind the required finish. A clause can tie damages to
      // another milestone ("Ready for Service of Data Hall 1"), so the sentence says what it assumed and points at the quote.
      // The daily amount is the figure tied to "per day"; failing that, the first figure after the words "liquidated damages".
      const rate = s.replace(CAP, ' ')
      const perDay = amount(rate, AMOUNT_PER_DAY) ?? (PER_DAY.test(rate) ? amount(rate.slice(LD.exec(rate)?.index ?? 0)) ?? amount(rate) : null)
      const behind = Math.max(0, ctx.daysBehind ?? 0)
      const exposure = perDay && behind ? perDay * behind : null
      push(`ld:${perDay ?? 'x'}`, { ...src(c, s), kind: 'damages', perDay, exposure, active: behind > 0,
        text: perDay ? (behind ? `Liquidated damages are ${money(perDay)} per day. If they run from the required finish, ${behind} day${behind === 1 ? '' : 's'} behind is about ${money(exposure!)}. Check the quoted clause for the milestone it names.` : `Liquidated damages are ${money(perDay)} per day. The forecast meets the required date today, so there is no exposure.`)
          : `The contract carries liquidated damages${behind ? `; the forecast is ${behind} day${behind === 1 ? '' : 's'} behind the required date` : ''}. The daily amount could not be read from this sentence.` })
    }
    if (UPDATE.test(s) && PERIOD.test(s) && !/look[- ]?ahead/i.test(s)) {
      const weekly = /week/i.test(PERIOD.exec(s)![1]) && !/bi-?weekly|two weeks/i.test(s)
      const limit = weekly ? 7 : /bi-?weekly|two weeks/i.test(s) ? 14 : 31
      const late = ctx.staleDays != null && ctx.staleDays > limit
      push('update', { ...src(c, s), kind: 'update', days: limit, active: late,
        text: late ? `Schedule updates are due ${weekly ? 'weekly' : limit === 14 ? 'every two weeks' : 'monthly'}. The schedule's data date is ${ctx.staleDays} days old: an update is overdue.`
          : `Schedule updates are due ${weekly ? 'weekly' : limit === 14 ? 'every two weeks' : 'monthly'}.${ctx.staleDays != null ? ` The data date is ${ctx.staleDays} day${ctx.staleDays === 1 ? '' : 's'} old.` : ''}` })
    }
    if (FLOAT.test(s)) push('float', { ...src(c, s), kind: 'float', active: false, text: 'The contract says who owns float. Read it before spending float on a change or a delay.' })
  }
  contract.sort((a, b) => Number(b.active) - Number(a.active))

  /* Documents against the schedule: systems named in the drawings and specifications that no activity covers */
  const work = activities
  const scheduleText = work.map(a => `${a.name} ${a.wbs ?? ''}`).join('\n')
  const notInSchedule: ScopeGap[] = []
  if (work.length >= 10 && designChunks.length) {
    const dc = ctx.projectType === 'data_center' || /data ?(center|hall)|\bUPS\b|CRAH|\bIST\b/i.test(scheduleText)
    const civil = (CIVIL_PROJECT_TYPES as readonly string[]).includes(ctx.projectType ?? '')
    for (const check of [...(civil ? [] : BUILDING_SCOPE), ...(dc ? DATA_CENTER_SCOPE : [])]) {
      if (check.words.test(scheduleText)) continue
      let found: ScopeGap | null = null
      for (const c of designChunks) {
        const s = sentences(c.text).find(x => check.words.test(x)) ?? (check.words.test(c.text) ? c.text.replace(/\s+/g, ' ').slice(0, 240) : null)
        if (s) { found = { ...src(c, s), label: check.label }; break }
      }
      if (found) notInSchedule.push(found)
    }
  }

  /* The field against the schedule */
  const acts = activities.map(a => ({ a, w: new Set(words(a.name)) })).filter(x => x.w.size >= 2)
  const codes = new Map(activities.map(a => [a.code.toLowerCase(), a]))
  const field: FieldMismatch[] = []
  const seen = new Set<string>()
  for (const c of fieldChunks) for (const s of sentences(c.text)) {
    if (NO_WORK.test(s)) continue
    const partial = PARTIAL.test(s) && !/\b100\s?%/.test(s)
    const finished = FINISHED.test(s) && !NOT_DONE.test(s) && !partial
    const working = WORKING.test(s) || partial
    if (!finished && !working) continue
    let a: WatchActivity | null = null
    for (const t of s.split(/[^A-Za-z0-9._-]+/)) { const x = codes.get(t.toLowerCase()); if (x && /\d/.test(t)) { a = x; break } }
    if (!a) {
      const sw = new Set(words(s))
      let best = 0
      for (const x of acts) { let n = 0; for (const w of x.w) if (sw.has(w)) n++; const share = n / x.w.size; if (n >= 2 && share >= 0.6 && share > best) { best = share; a = x.a } }
    }
    if (!a || a.done || seen.has(a.id)) continue
    const ref = { id: a.id, code: a.code, name: a.name }
    if (!a.started) { seen.add(a.id); field.push({ ...src(c, s), activity: ref, reported: finished ? 'finished' : 'working', schedule: 'not started', text: `The field report describes work on ${a.code} ${a.name}; the schedule shows it not started. Record the actual start.` }) }
    else if (finished) { seen.add(a.id); field.push({ ...src(c, s), activity: ref, reported: 'finished', schedule: 'in progress', text: `The field report reads as if ${a.code} ${a.name} is finished; the schedule shows it in progress. Confirm and record the actual finish.` }) }
  }

  return { contract: contract.slice(0, MAX), notInSchedule: notInSchedule.slice(0, MAX), field: field.slice(0, MAX), read: { contract: new Set(contractChunks.map(c => c.documentId)).size, design: new Set(designChunks.map(c => c.documentId)).size, field: new Set(fieldChunks.map(c => c.documentId)).size } }
}

export interface BriefAlert { level: 'act' | 'watch'; text: string; section: string }
