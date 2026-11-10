// Schedule signals in project correspondence: emails, meeting minutes / transcripts, daily field
// reports, RFIs and change documents kept with the project. Each signal is one sentence quoted from a
// document, with its citation, the activity it names (by ID or by the words of its name) and any
// number of days it states. Rules only: no model reads the correspondence here, so nothing is sent
// anywhere and the same documents always give the same signals. Pure.

import type { BriefSignal } from './daily-brief'

export interface CorrespondenceChunk { documentId: string; title: string; docType: string; citation: string; text: string }
export interface SignalActivity { id: string; code: string; name: string; open: boolean }

/** Document types read for signals. */
export const SIGNAL_DOC_TYPES: readonly string[] = ['email', 'meeting', 'daily_report', 'rfi', 'change_order']
export const MAX_SIGNALS = 20

const DELAY = /\b(delay(?:ed|s|ing)?|late|slip(?:ped|s|ping)?|push(?:ed|ing)? (?:out|back)|behind schedule|behind|won'?t make|will not make|not ready|on hold|hold[- ]up|stopp?ed|suspend(?:ed)?|back[- ]?order(?:ed)?|lead time|re-?sequence|stand[- ]?by|shortage|rework|failed (?:inspection|test)|rejected|weather day|no access)\b/i
const CHANGE = /\b(change order|\bPCO\b|\bCOR?\b #?\d|change request|directive|\bCCD\b|\bASI\b|bulletin|revised (?:drawing|design|scope)|added scope|additional scope|scope change|amendment|redesign)\b/i
const RISK = /\b(risk|concern(?:ed)?|may not|might not|at risk|unlikely|uncertain|pending approval|awaiting|waiting on|not yet (?:approved|released|issued)|unresolved)\b/i
const COMMIT = /\b(will (?:deliver|arrive|complete|finish|start|be (?:on site|ready|energized))|commit(?:ted|s)? to|confirmed (?:for|delivery)|expected (?:on|by)|scheduled for|ETA)\b/i
const DAYS = /\b(\d{1,3})\s*(?:work(?:ing)?\s*|calendar\s*|business\s*)?(day|week|month)s?\b/i
const STOP = new Set(['the', 'and', 'for', 'with', 'level', 'area', 'install', 'installation', 'work', 'phase', 'building', 'complete', 'start', 'finish', 'new', 'all'])

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const stem = (w: string) => w.replace(/(ing|es|s)$/, '')
const words = (s: string) => norm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w)).map(stem)

function daysIn(sentence: string): number | null {
  const m = DAYS.exec(sentence)
  if (!m) return null
  const n = Number(m[1])
  if (!n || n > 400) return null
  const unit = m[2].toLowerCase()
  return unit === 'week' ? n * 5 : unit === 'month' ? n * 21 : n
}

/** Split into sentences without breaking on abbreviations inside activity IDs or decimals. */
function sentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\s*[\n•]\s*/).map(s => s.trim()).filter(s => s.length >= 20 && s.length <= 400)
}

/** The activity a sentence is about: an activity ID in it, else the open activity whose name shares the most (at least two) significant words. */
function matchActivity(sentence: string, acts: { a: SignalActivity; w: Set<string> }[], codes: Map<string, SignalActivity>): SignalActivity | null {
  for (const t of sentence.split(/[^A-Za-z0-9._-]+/)) { const a = codes.get(t.toLowerCase()); if (a && /\d/.test(t)) return a }
  const sw = new Set(words(sentence))
  let best: { a: SignalActivity; n: number; share: number } | null = null
  for (const x of acts) {
    if (x.w.size < 2) continue
    let n = 0
    for (const w of x.w) if (sw.has(w)) n++
    const share = n / x.w.size
    if (n >= 2 && share >= 0.6 && (!best || share > best.share || (share === best.share && Number(x.a.open) > Number(best.a.open)))) best = { a: x.a, n, share }
  }
  return best?.a ?? null
}

export function extractSignals(chunks: CorrespondenceChunk[], activities: SignalActivity[]): BriefSignal[] {
  const acts = activities.map(a => ({ a, w: new Set(words(a.name)) }))
  const codes = new Map(activities.map(a => [a.code.toLowerCase(), a]))
  const out: (BriefSignal & { score: number })[] = []
  const seen = new Set<string>()
  for (const c of chunks) {
    if (!SIGNAL_DOC_TYPES.includes(c.docType)) continue
    for (const s of sentences(c.text)) {
      const kind: BriefSignal['kind'] | null = DELAY.test(s) ? 'delay' : CHANGE.test(s) ? 'change' : RISK.test(s) ? 'risk' : COMMIT.test(s) ? 'commitment' : null
      if (!kind) continue
      const key = norm(s).slice(0, 120)
      if (seen.has(key)) continue
      seen.add(key)
      const activity = matchActivity(s, acts, codes)
      const days = kind === 'commitment' ? null : daysIn(s)
      // Sentences with neither an activity nor a number of days are noise unless they announce a change.
      if (!activity && days == null && kind !== 'change' && kind !== 'delay') continue
      const score = (activity ? 4 : 0) + (days != null ? 3 : 0) + (kind === 'delay' ? 2 : kind === 'change' ? 2 : kind === 'risk' ? 1 : 0) + (activity?.open ? 1 : 0)
      out.push({ kind, quote: s.slice(0, 300), days, activity: activity ? { id: activity.id, code: activity.code, name: activity.name } : null, documentId: c.documentId, title: c.title, citation: c.citation, docType: c.docType, score })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_SIGNALS).map(({ score: _score, ...s }) => { void _score; return s })
}
