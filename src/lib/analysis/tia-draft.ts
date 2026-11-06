// Drafting a Time Impact Analysis fragnet from a change document (change order, RFI, directive,
// notice). The model only *proposes*: new activities with durations, and ties to existing activity
// codes, each with the exact sentence from the document it relies on. Everything it returns is
// checked here before a person sees it:
//   • every activity must quote its source verbatim, from a passage it cites with that passage's exact
//     citation string; an activity whose quote is not in the cited passage is dropped;
//   • ties may only reference the draft's own activities or activity codes that exist in the update;
//   • durations are whole work days 0–365; dates are ISO days;
//   • the result is validated by the same fragnet validator the TIA engine uses (loops, open ends,
//     completed activities, data date).
// Without a model (offline, CUI/classified with a cloud model, a failure), a rules-based draft finds a
// stated number of days and the existing activities the document names, and says it is a starting point.
// Nothing here is saved: the scheduler reviews the draft and creates the delay event.

import { matchCitation } from '@/lib/rag/citations'
import { sentences } from '@/lib/rag/requirements'
import type { RetrievedChunk } from '@/lib/rag/types'
import type { Activity } from '@/lib/db'
import { validateFragnet, type Fragnet, type FragnetActivity, type FragnetLink, type TiaNetwork, type EvidenceRef } from './tia'

export const MAX_DRAFT_ACTIVITIES = 25
export const MAX_DRAFT_TIES = 60
const MAX_PICK = 120
const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const

/** What the model must return (validated by parseModelDraft). */
export interface ModelDraft {
  title: string
  summary: string
  eventStart: string | null
  activities: { ref: string; name: string; durationDays: number; basis: 'stated' | 'estimated'; quote: string; citation: string }[]
  ties: { from: string; to: string; type: typeof LINK_TYPES[number]; lagDays: number; reason: string }[]
}

export interface DraftSource { code: string; name: string; duration: number; basis: 'stated' | 'estimated'; quote: string; citation: string }
export interface DraftTie { from: string; to: string; type: string; lag: number; reason: string }

export interface FragnetDraft {
  method: 'model' | 'rules'
  /** Why the rules-based draft was used (offline, restricted data, model failure) */
  reason: string | null
  title: string
  description: string
  eventStart: string | null
  fragnet: Fragnet
  /** One per fragnet activity: the sentence it relies on and its citation */
  sources: DraftSource[]
  ties: DraftTie[]
  evidence: EvidenceRef[]
  /** Existing activities the document appears to concern (name match), for the reviewer */
  related: { code: string; name: string }[]
  warnings: string[]
  validation: { errors: string[]; warnings: string[] }
}

const isoDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
const normText = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim()
const stripCite = (s: string) => s.trim().replace(/^\[/, '').replace(/\]$/, '')

/* ─── The model's JSON ─────────────────────────────── */

/** Validates the model's JSON shape (throws with a message the model can correct). */
export function parseModelDraft(v: unknown): ModelDraft {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Return one JSON object.')
  const o = v as Record<string, unknown>
  const title = String(o.title ?? '').trim().slice(0, 200)
  if (!title) throw new Error('title is required')
  const acts = Array.isArray(o.activities) ? o.activities : null
  if (!acts) throw new Error('activities must be an array')
  if (acts.length > MAX_DRAFT_ACTIVITIES) throw new Error(`at most ${MAX_DRAFT_ACTIVITIES} activities`)
  const activities = acts.map((x, i) => {
    const a = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const d = Number(a.durationDays)
    if (!Number.isFinite(d)) throw new Error(`activities[${i}].durationDays must be a number`)
    const quote = String(a.quote ?? '').trim()
    const citation = String(a.citation ?? '').trim()
    if (!quote || !citation) throw new Error(`activities[${i}] needs quote and citation`)
    return { ref: String(a.ref ?? `N${i + 1}`).trim().slice(0, 20) || `N${i + 1}`, name: String(a.name ?? '').trim().slice(0, 200), durationDays: d, basis: a.basis === 'stated' ? 'stated' as const : 'estimated' as const, quote: quote.slice(0, 600), citation: citation.slice(0, 300) }
  })
  const tiesRaw = Array.isArray(o.ties) ? o.ties : []
  const ties = tiesRaw.slice(0, MAX_DRAFT_TIES).map((x, i) => {
    const t = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const type = String(t.type ?? 'FS').toUpperCase()
    if (!(LINK_TYPES as readonly string[]).includes(type)) throw new Error(`ties[${i}].type must be FS, SS, FF or SF`)
    const lag = Number(t.lagDays ?? 0)
    if (!Number.isFinite(lag)) throw new Error(`ties[${i}].lagDays must be a number`)
    return { from: String(t.from ?? '').trim(), to: String(t.to ?? '').trim(), type: type as ModelDraft['ties'][number]['type'], lagDays: lag, reason: String(t.reason ?? '').trim().slice(0, 300) }
  })
  return { title, summary: String(o.summary ?? '').trim().slice(0, 2000), eventStart: isoDay(o.eventStart) ? o.eventStart : null, activities, ties }
}

/* ─── Context for the model ────────────────────────── */

const WORDS = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter(w => !STOP.has(w)))
const STOP = new Set(['shall', 'with', 'from', 'that', 'this', 'will', 'work', 'works', 'into', 'have', 'been', 'such', 'other', 'their', 'there', 'which', 'contractor', 'owner', 'change', 'order', 'days', 'date', 'dated', 'project', 'within', 'per', 'item', 'items', 'install', 'installation', 'provide'])

/** Existing scheduled activities ranked by how many of their name words the document uses. */
export function relatedActivities(activities: Activity[], text: string, max = 8): { code: string; name: string; score: number }[] {
  const doc = WORDS(text)
  return activities
    .filter(a => a.activityType === 'task' || a.activityType === 'milestone')
    .map(a => ({ code: a.activityId, name: a.name, score: [...WORDS(a.name)].filter(w => doc.has(w)).length }))
    .filter(x => x.score > 0)
    .sort((x, y) => y.score - x.score || x.code.localeCompare(y.code))
    .slice(0, max)
}

/** The activity list the model may tie to: name matches first, then open critical work, then the rest by start. */
export function pickListForModel(activities: Activity[], text: string): string {
  const work = activities.filter(a => (a.activityType === 'task' || a.activityType === 'milestone'))
  const related = new Set(relatedActivities(work, text, 60).map(x => x.code))
  const critical = work.filter(a => a.status !== 'complete' && (a.totalFloat ?? 1) <= 0).map(a => a.activityId)
  const order = [...related, ...critical, ...work.map(a => a.activityId)]
  const seen = new Set<string>(); const out: string[] = []
  const byCode = new Map(work.map(a => [a.activityId, a]))
  for (const c of order) {
    if (seen.has(c) || out.length >= MAX_PICK) continue
    seen.add(c)
    const a = byCode.get(c)!
    out.push(`${a.activityId} | ${a.name.replace(/\|/g, '/')} | ${a.actualStart || a.earlyStart || '—'} → ${a.actualFinish || a.earlyFinish || '—'} | TF ${a.totalFloat ?? '—'} | ${a.status}`)
  }
  return out.join('\n')
}

export const FRAGNET_TASK = `TASK: From the change document passages, draft a Time Impact Analysis fragnet for the schedule update.
- Propose only the NEW work or waiting time the document describes (e.g. redesign, approval, fabrication, added installation, suspension). Do not re-list existing activities.
- Each new activity needs: ref (N1, N2, …), name (imperative, under 80 characters), durationDays (whole work days; basis "stated" only when the document states the duration, otherwise "estimated"), quote (copied EXACTLY, character for character, from one passage) and citation (that passage's exact "cite as" string).
- ties: link new activities to each other and to EXISTING activity codes from the SCHEDULE list only (never invent a code). Tie the first new activity in from the existing work it follows, and the last one out to the existing work it delays. type FS/SS/FF/SF, lagDays whole days, a one-line reason.
- eventStart: the date the event began if the document states it (YYYY-MM-DD), else null.
- Never decide responsibility, entitlement or whether delay is excusable.
Reply with ONLY JSON: {"title": "...", "summary": "...", "eventStart": null, "activities": [{"ref": "N1", "name": "...", "durationDays": 10, "basis": "stated", "quote": "...", "citation": "[...]"}], "ties": [{"from": "A1030", "to": "N1", "type": "FS", "lagDays": 0, "reason": "..."}]}`

/* ─── Turning a proposal into a checked draft ──────── */

const nextCodes = (existing: Set<string>, n: number, prefix = 'CO') => {
  const out: string[] = []
  for (let i = 1; out.length < n && i < 10_000; i++) {
    const c = `${prefix}-${String(i).padStart(2, '0')}`
    if (!existing.has(c.toLowerCase())) out.push(c)
  }
  return out
}

/** Checks a model proposal against the passages and the update, and validates the fragnet. */
export function finalizeModelDraft(p: ModelDraft, chunks: RetrievedChunk[], net: Pick<TiaNetwork, 'scheduleId' | 'activities' | 'relationships' | 'calendars' | 'defaultCalendarId' | 'dataDate'>, docTitle: string): FragnetDraft {
  const warnings: string[] = []
  const existing = new Map(net.activities.map(a => [a.activityId.toLowerCase(), a]))
  const kept: (ModelDraft['activities'][number] & { chunk: RetrievedChunk })[] = []
  for (const a of p.activities) {
    const chunk = matchCitation(stripCite(a.citation), chunks) as RetrievedChunk | null
    if (!chunk) { warnings.push(`Left out "${a.name || a.ref}": its citation ${a.citation} is not one of the document's passages.`); continue }
    const q = normText(a.quote)
    if (q.length < 12 || !normText(chunk.text).includes(q)) { warnings.push(`Left out "${a.name || a.ref}": its quote is not in ${chunk.citation}.`); continue }
    if (!a.name) { warnings.push(`Left out ${a.ref}: no activity name.`); continue }
    kept.push({ ...a, chunk })
  }
  const codes = nextCodes(new Set(existing.keys()), kept.length)
  const refToCode = new Map(kept.map((a, i) => [a.ref.toLowerCase(), codes[i]]))
  const activities: FragnetActivity[] = kept.map((a, i) => {
    const duration = Math.max(0, Math.min(365, Math.round(a.durationDays)))
    if (duration !== a.durationDays) warnings.push(`${codes[i]}: duration ${a.durationDays} rounded to ${duration} work days.`)
    return { code: codes[i], name: a.name, duration, calendarId: null, startNoEarlierThan: p.eventStart }
  })
  const resolve = (ref: string): string | null => {
    const r = ref.trim().toLowerCase()
    if (refToCode.has(r)) return refToCode.get(r)!
    const ex = existing.get(r)
    return ex ? ex.activityId : null
  }
  const ties: DraftTie[] = []
  const relationships: FragnetLink[] = []
  const seen = new Set<string>()
  for (const t of p.ties) {
    const from = resolve(t.from), to = resolve(t.to)
    if (!from || !to) { warnings.push(`Left out the tie ${t.from} → ${t.to}: ${!from ? t.from : t.to} is not a draft activity or an activity in this update.`); continue }
    if (from === to) continue
    const fromNew = codes.includes(from), toNew = codes.includes(to)
    if (!fromNew && !toNew) { warnings.push(`Left out the tie ${from} → ${to}: it links two existing activities; a fragnet only adds ties to its own activities.`); continue }
    const key = `${from}>${to}`
    if (seen.has(key)) continue
    seen.add(key)
    const lag = Math.round(t.lagDays)
    relationships.push({ from, to, type: t.type, lag })
    ties.push({ from, to, type: t.type, lag, reason: t.reason })
  }
  const fragnet: Fragnet = { activities, relationships }
  const v = validateFragnet(fragnet, net)
  const sources = kept.map((a, i) => ({ code: codes[i], name: a.name, duration: activities[i].duration, basis: a.basis, quote: a.quote, citation: a.chunk.citation }))
  const text = chunks.map(c => c.text).join('\n')
  return {
    method: 'model', reason: null, title: p.title, description: p.summary, eventStart: p.eventStart, fragnet, sources, ties,
    evidence: [...new Set(sources.map(s => s.citation))].map(c => ({ label: `${docTitle} ${c}`.slice(0, 300) })),
    related: relatedActivities(net.activities, text).map(({ code, name }) => ({ code, name })),
    warnings, validation: { errors: v.errors, warnings: v.warnings },
  }
}

/* ─── Without a model ──────────────────────────────── */

const DAYS_RE = /\b(\d{1,3})\s*(?:\(\d{1,3}\)\s*)?(?:additional\s+|more\s+)?(working|work|business|calendar|consecutive)?\s*days?\b/i
const DELAY_WORDS = /\b(extension|extend|delay|additional|added|suspend|suspension|stop work|stoppage|impact|redesign|revis\w*|resubmi\w*|re-?fabricat\w*|re-?work|waiting|approval|lead time|time|within)\b/i

/**
 * A starting point without AI: one fragnet activity for the change, sized from the first sentence that
 * states a number of days in a delay context, tied to the existing activity the document names most.
 */
export function rulesDraft(chunks: RetrievedChunk[], net: Pick<TiaNetwork, 'scheduleId' | 'activities' | 'relationships' | 'calendars' | 'defaultCalendarId' | 'dataDate'>, docTitle: string, reason: string): FragnetDraft {
  const warnings = ['Drafted without AI: check the duration and add the ties the change needs.']
  let found: { days: number; quote: string; citation: string } | null = null
  for (const c of chunks) {
    for (const s of sentences(c.text)) {
      const m = DAYS_RE.exec(s)
      if (m && DELAY_WORDS.test(s)) { found = { days: Math.min(365, Number(m[1])), quote: s.length > 400 ? s.slice(0, 397) + '…' : s, citation: c.citation }; break }
    }
    if (found) break
  }
  const text = chunks.map(c => c.text).join('\n')
  const related = relatedActivities(net.activities, text).map(({ code, name }) => ({ code, name }))
  const existing = new Set(net.activities.map(a => a.activityId.toLowerCase()))
  const activities: FragnetActivity[] = []
  const relationships: FragnetLink[] = []
  const ties: DraftTie[] = []
  const sources: DraftSource[] = []
  if (found) {
    const [code] = nextCodes(existing, 1)
    const name = `Change: ${docTitle}`.slice(0, 200)
    activities.push({ code, name, duration: found.days, calendarId: null, startNoEarlierThan: null })
    sources.push({ code, name, duration: found.days, basis: 'stated', quote: found.quote, citation: found.citation })
    const target = related.map(r => net.activities.find(a => a.activityId === r.code)).find(a => a && a.status !== 'complete')
    if (target) {
      // In from the work that precedes the named activity, out to the named activity: the change sits
      // between them. Both ties are guesses from names, and say so.
      const predRel = net.relationships.find(r => r.successorId === target.id)
      const pred = predRel ? net.activities.find(a => a.id === predRel.predecessorId) : undefined
      if (pred) {
        relationships.push({ from: pred.activityId, to: code, type: 'FS', lag: 0 })
        ties.push({ from: pred.activityId, to: code, type: 'FS', lag: 0, reason: `Precedes ${target.activityId} in the update; check it.` })
      }
      relationships.push({ from: code, to: target.activityId, type: 'FS', lag: 0 })
      ties.push({ from: code, to: target.activityId, type: 'FS', lag: 0, reason: 'The document names this activity (matched by name); check it.' })
    }
  } else {
    warnings.push('No duration stated in a delay context was found: add the change work yourself.')
  }
  const v = validateFragnet({ activities, relationships }, net)
  return {
    method: 'rules', reason, title: `Change: ${docTitle}`.slice(0, 200), description: '', eventStart: null, fragnet: { activities, relationships }, sources, ties,
    evidence: [...new Set(sources.map(s => s.citation))].map(c => ({ label: `${docTitle} ${c}`.slice(0, 300) })),
    related, warnings, validation: { errors: v.errors, warnings: v.warnings },
  }
}
